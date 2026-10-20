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
    const profs = await db.select().from(profiles).where(eq(profiles.accountId, accountId));
    const free = profs.filter((p) => !p.isOccupied).length;
    if (acc.status === "NEEDS_PASSWORD_CHANGE" && activeRentals.length === 0) status = "NEEDS_PASSWORD_CHANGE";
    else status = free > 0 ? "AVAILABLE" : "RENTED";
  }
  await db.update(accounts).set({ status, updatedAt: new Date() }).where(eq(accounts.id, accountId));
}

/** Daily job: mark ended rentals, queue expiry warnings (2 days before). Runs on demand / dashboard load. */
export async function runDailyJob(opts: { sendAlerts?: boolean } = {}) {
  const now = new Date();
  const sendAlerts = opts.sendAlerts !== false;

  // A) Ended rentals (معزولة: فشلها لا يسقط المسار الذي استدعاها)
  let ended: (typeof rentals.$inferSelect)[] = [];
  try {
    ended = await db.select().from(rentals)
      .where(and(eq(rentals.status, "ACTIVE"), lt(rentals.endDate, now)));
    for (const r of ended) {
      try {
        await db.update(rentals).set({ status: "ENDED", updatedAt: now }).where(eq(rentals.id, r.id));
        if (r.accountId) await refreshAccountStatus(r.accountId);
      } catch (e) {
        console.error("[daily-job] ended-rental update skipped:", r.id, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error("[daily-job] ended-mark section failed:", e instanceof Error ? e.message : e);
  }

  // B) Expiry warnings: within next 2 days, not sent (معزولة كذلك)
  let alertsSent = 0;
  if (sendAlerts) {
    try {
      const windowEnd = addDays(now, 2);
      const soon = await db.select().from(rentals)
        .where(and(eq(rentals.status, "ACTIVE"), eq(rentals.isLifetime, false), eq(rentals.whatsappAlertSent, false)));
    const tpl = await getSetting("whatsapp_expiry_template", "مرحباً {{name}}، اشتراكك في {{platform}} ينتهي {{end_date}}.");
    for (const r of soon) {
      if (new Date(r.endDate) > windowEnd || new Date(r.endDate) < now) continue;
      const [cust] = await db.select().from(customers).where(eq(customers.id, r.customerId)).limit(1);
      const [plat] = await db.select().from(platforms).where(eq(platforms.id, r.platformId)).limit(1);
      if (!cust) continue;
      const days = String(Math.max(0, Math.ceil((new Date(r.endDate).getTime() - now.getTime()) / 86400000)));
      const message = renderTemplate(tpl, { name: cust.name, platform: plat?.name ?? "", end_date: formatDate(r.endDate), days });

      let status = "SIMULATED";
      // If Meta Cloud API credentials exist, send for real.
      const token = process.env.WHATSAPP_TOKEN; const phoneId = process.env.WHATSAPP_PHONE_ID;
      if (token && phoneId) {
        try {
          let to = cust.phone.replace(/\D/g, "");
          if (to.length === 9 && to.startsWith("7")) to = "967" + to;
          const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } }),
          });
          status = res.ok ? "SENT" : "FAILED";
        } catch { status = "FAILED"; }
      }
        await db.insert(whatsappLogs).values({ rentalId: r.id, customerId: cust.id, phone: cust.phone, message, kind: "EXPIRY_WARNING", status });
        if (status !== "FAILED") {
          await db.update(rentals).set({ whatsappAlertSent: true, whatsappAlertSentAt: now }).where(eq(rentals.id, r.id));
          alertsSent++;
        }
      }
    } catch (e) {
      console.error("[daily-job] expiry-warnings section failed:", e instanceof Error ? e.message : e);
    }
  }
  return { endedCount: ended.length, alertsSent, ranAt: now.toISOString() };
}

export async function accountOccupancy(accountId: number) {
  const profs = await db.select().from(profiles).where(eq(profiles.accountId, accountId)).orderBy(profiles.profileNo);
  const active = await db.select({ id: rentals.id }).from(rentals)
    .where(and(eq(rentals.accountId, accountId), inArray(rentals.status, ["ACTIVE", "ENDED"])));
  return { profiles: profs, used: profs.filter((p) => p.isOccupied).length, activeOrEnded: active.length };
}
