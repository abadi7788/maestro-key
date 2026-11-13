import { db } from "@/db";
import { accounts, profiles, rentals, customers, platforms, settings, whatsappLogs } from "@/db/schema";
import { and, eq, lt, inArray } from "drizzle-orm";
import { renderTemplate, formatDate, addDays } from "./constants";

export async function getSetting(key: string, fallback = "") {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? fallback;
}

export async function refreshAccountStatus(accountId: number) {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!acc || acc.isDeleted) return;
  // روابط الدعوة والأكواد: الحالة حسب مرات الاستخدام فقط (لا علاقة لها بالاشتراكات النشطة)
  if (acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY") {
    const exhausted = acc.maxUses != null && (acc.usedCount ?? 0) >= acc.maxUses;
    await db.update(accounts).set({ status: exhausted ? "RENTED" : "AVAILABLE", updatedAt: new Date() }).where(eq(accounts.id, accountId));
    return;
  }
  const activeRentals = await db.select({ id: rentals.id }).from(rentals)
    .where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ACTIVE")));
  const endedRentals = await db.select({ id: rentals.id }).from(rentals)
    .where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ENDED")));

  let status: string;
  if (acc.type === "FULL") {
    if (activeRentals.length) status = "RENTED";
    else if (endedRentals.length) status = "NEEDS_PASSWORD_CHANGE";
    else status = acc.status === "NEEDS_PASSWORD_CHANGE" ? "NEEDS_PASSWORD_CHANGE" : "AVAILABLE";
    // If ended rentals were closed by password-change action, caller sets AVAILABLE explicitly.
    if (!activeRentals.length && !endedRentals.length && acc.status !== "NEEDS_PASSWORD_CHANGE") status = "AVAILABLE";
  } else {
    // حساب بروفايلات: الحالة حسب عدد البروفايلات المتاحة فعلياً
    const freeCount = await db.select({ id: profiles.id }).from(profiles)
      .where(and(eq(profiles.accountId, accountId), eq(profiles.status, "AVAILABLE")));
    if (acc.status === "NEEDS_PASSWORD_CHANGE" && activeRentals.length === 0) status = "NEEDS_PASSWORD_CHANGE";
    else status = freeCount.length > 0 ? "AVAILABLE" : "RENTED";
  }
  await db.update(accounts).set({ status, updatedAt: new Date() }).where(eq(accounts.id, accountId));
}

let lastDailySilentRunAt = 0;

/** Daily job: mark ended rentals, queue expiry warnings (2 days before). Runs on demand / throttled on page load. */
export async function runDailyJob(opts: { sendAlerts?: boolean; force?: boolean } = {}) {
  const now = new Date();
  const sendAlerts = opts.sendAlerts !== false;
  const nowMs = now.getTime();

  // تخطي الفحص الصامت المتكرر خلال 60 ثانية لتسريع التنقل بين الصفحات
  if (!sendAlerts && !opts.force && nowMs - lastDailySilentRunAt < 60_000) {
    return { endedCount: 0, alertsSent: 0, ranAt: now.toISOString(), throttled: true };
  }
  if (!sendAlerts) lastDailySilentRunAt = nowMs;

  // A) Ended rentals (استعلام واحد فقط بدلاً من حلقة تحديث صفاً بصف)
  let endedCount = 0;
  try {
    const ended = await db
      .update(rentals)
      .set({ status: "ENDED", updatedAt: now })
      .where(and(eq(rentals.status, "ACTIVE"), eq(rentals.isLifetime, false), lt(rentals.endDate, now)))
      .returning({ id: rentals.id, accountId: rentals.accountId });

    endedCount = ended.length;
    if (ended.length > 0) {
      const uniqueAccountIds = Array.from(
        new Set(ended.map((r) => r.accountId).filter((id): id is number => typeof id === "number" && id > 0))
      );
      await Promise.all(uniqueAccountIds.map((accId) => refreshAccountStatus(accId).catch(() => {})));
    }
  } catch (e) {
    console.error("[daily-job] ended-mark section failed:", e instanceof Error ? e.message : e);
  }

  // B) Expiry warnings: within next 2 days, not sent
  let alertsSent = 0;
  if (sendAlerts) {
    try {
      const windowEnd = addDays(now, 2);
      const [soon, tpl] = await Promise.all([
        db.select().from(rentals).where(
          and(eq(rentals.status, "ACTIVE"), eq(rentals.isLifetime, false), eq(rentals.whatsappAlertSent, false))
        ),
        getSetting("whatsapp_expiry_template", "مرحباً {{name}}، اشتراكك في {{platform}} ينتهي {{end_date}}."),
      ]);

      const dueSoon = soon.filter((r) => {
        const endMs = new Date(r.endDate).getTime();
        return endMs <= windowEnd.getTime() && endMs >= now.getTime();
      });

      if (dueSoon.length > 0) {
        const custIds = Array.from(new Set(dueSoon.map((r) => r.customerId)));
        const platIds = Array.from(new Set(dueSoon.map((r) => r.platformId)));
        const [custRows, platRows] = await Promise.all([
          db.select().from(customers).where(inArray(customers.id, custIds)),
          db.select().from(platforms).where(inArray(platforms.id, platIds)),
        ]);
        const custMap = new Map(custRows.map((c) => [c.id, c]));
        const platMap = new Map(platRows.map((p) => [p.id, p]));

        for (const r of dueSoon) {
          const cust = custMap.get(r.customerId);
          const plat = platMap.get(r.platformId);
          if (!cust) continue;
          const days = String(Math.max(0, Math.ceil((new Date(r.endDate).getTime() - now.getTime()) / 86400000)));
          const message = renderTemplate(tpl, { name: cust.name, platform: plat?.name ?? "", end_date: formatDate(r.endDate), days });

          let status = "SIMULATED";
          const token = process.env.WHATSAPP_TOKEN;
          const phoneId = process.env.WHATSAPP_PHONE_ID;
          if (token && phoneId) {
            try {
              let to = cust.phone.replace(/\D/g, "");
              if (to.length === 9 && to.startsWith("7")) to = "967" + to;
              const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } }),
              });
              status = res.ok ? "SENT" : "FAILED";
            } catch {
              status = "FAILED";
            }
          }
          await db.insert(whatsappLogs).values({ rentalId: r.id, customerId: cust.id, phone: cust.phone, message, kind: "EXPIRY_WARNING", status });
          if (status !== "FAILED") {
            await db.update(rentals).set({ whatsappAlertSent: true, whatsappAlertSentAt: now }).where(eq(rentals.id, r.id));
            alertsSent++;
          }
        }
      }
    } catch (e) {
      console.error("[daily-job] expiry-warnings section failed:", e instanceof Error ? e.message : e);
    }
  }
  return { endedCount, alertsSent, ranAt: now.toISOString() };
}

export async function accountOccupancy(accountId: number) {
  const profs = await db.select().from(profiles).where(eq(profiles.accountId, accountId)).orderBy(profiles.profileNo);
  const active = await db.select({ id: rentals.id }).from(rentals)
    .where(and(eq(rentals.accountId, accountId), inArray(rentals.status, ["ACTIVE", "ENDED"])));
  return { profiles: profs, used: profs.filter((p) => p.isOccupied).length, activeOrEnded: active.length };
}
