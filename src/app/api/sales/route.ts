import { db } from "@/db";
import { accounts, profiles, customers, rentals, payments, platforms } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { hashText } from "@/lib/crypto";
import { ALLOWED_DURATIONS, addDays, cleanPhone } from "@/lib/constants";
import { refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Customer lookup by phone (employee-safe: no account credentials). */
export async function GET(req: Request) {
  try {
    await ensureSeeded();
    await requireUser();
    const phone = cleanPhone(new URL(req.url).searchParams.get("phone") || "");
    if (phone.length < 7) return Response.json({ customer: null, rentals: [] });
    const [customer] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (!customer) return Response.json({ customer: null, rentals: [] });
    const rows = await db.select({
      id: rentals.id, platformId: rentals.platformId, status: rentals.status, rentalType: rentals.rentalType,
      startDate: rentals.startDate, endDate: rentals.endDate, durationDays: rentals.durationDays,
      platformName: platforms.name, profileId: rentals.profileId, accountType: accounts.type,
    }).from(rentals).innerJoin(platforms, eq(rentals.platformId, platforms.id)).innerJoin(accounts, eq(rentals.accountId, accounts.id))
      .where(eq(rentals.customerId, customer.id)).orderBy(desc(rentals.createdAt)).limit(20);
    return Response.json({ customer, rentals: rows });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    await runDailyJob({ sendAlerts: false });
    const b = await req.json().catch(() => ({}));
    const platformId = Number(b.platformId);
    const durationDays = Number(b.durationDays);
    const paymentMethodId = Number(b.paymentMethodId);
    const transactionRef = String(b.transactionRef || "").trim();
    const amount = Number(b.amount || 0);
    const receipt: string = String(b.receiptImageData || "");
    const customerName = String(b.customerName || "").trim();
    const customerPhone = cleanPhone(String(b.customerPhone || ""));
    const forceNew = b.mode === "NEW";
    // نوع الاشتراك المطلوب: FULL = حساب كامل، PROFILE = ملف/بروفايل، AUTO = أيهما متوفر (افتراضي)
    const rawType = b.accountType ?? b.saleType;
    const saleType = rawType === "FULL" || rawType === "FULL_PROFILE" ? "FULL" : rawType === "PROFILE" ? "PROFILE" : "AUTO";
    const accountTypeLabel = saleType === "FULL" ? "FULL" : "PROFILE";

    if (!platformId) return jsonError("اختر المنصة أولاً");
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) return jsonError("أدخل مدة الاشتراك بالأيام، من يوم واحد حتى 3650 يوماً");
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("أدخل سعر الاشتراك يدوياً");
    if (customerPhone.length < 7) return jsonError("أدخل رقم واتساب العميل بشكل صحيح");
    if (!paymentMethodId || !transactionRef) return jsonError("يجب اختيار البنك وإدخال رقم العملية لإتمام العملية");
    if (!receipt || !receipt.startsWith("data:image")) return jsonError("إرفاق صورة السند إلزامي — صوّر السند أو ارفعه من الألبوم");
    if (receipt.length > 2_200_000) return jsonError("صورة السند كبيرة جداً، أعد تصويرها");

    // Duplicate receipt guards
    const dupRef = await db.select({ id: payments.id }).from(payments)
      .where(and(eq(payments.paymentMethodId, paymentMethodId), eq(payments.transactionRef, transactionRef))).limit(1);
    if (dupRef.length) return jsonError("هذا السند مُستخدَم سابقاً — نفس البنك ورقم العملية مسجلان من قبل", 409);
    const receiptHash = hashText(receipt);
    const dupImg = await db.select({ id: payments.id }).from(payments).where(eq(payments.receiptHash, receiptHash)).limit(1);
    if (dupImg.length) return jsonError("صورة السند هذه مُستخدمة سابقاً في عملية أخرى", 409);

    const [platform] = await db.select().from(platforms).where(eq(platforms.id, platformId)).limit(1);
    if (!platform) return jsonError("منصة غير موجودة");

    // ---------- بيانات إضافية من العميل حسب إعدادات المنصة ----------
    const customerEmail = String(b.customerEmail || "").trim();
    const customerExtra = String(b.customerExtra || "").trim();
    if (platform.requiresCustomerEmail && !customerEmail) {
      return jsonError("هذا الاشتراك يتطلب إيميل العميل للتفعيل — اطلبه من العميل وأدخله أولاً");
    }

    // Customer upsert by phone
    let [customer] = await db.select().from(customers).where(eq(customers.phone, customerPhone)).limit(1);
    if (!customer) {
      if (!customerName) return jsonError("أدخل اسم العميل الجديد");
      [customer] = await db.insert(customers).values({ name: customerName, phone: customerPhone }).returning();
    }

    const now = new Date();

    // ---------- مسار "عند الطلب": بدون حساب مخزون — المدير يفعّل يدوياً ----------
    if (platform.deliveryMode === "ON_DEMAND") {
      const neededEnd = addDays(now, durationDays);
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const [rental] = await db.insert(rentals).values({
        accountId: null, profileId: null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays, status: "ACTIVE", activationStatus: "PENDING",
        customerEmail: customerEmail || null, customerExtra: customerExtra || null,
      }).returning();
      await db.insert(payments).values({
        rentalId: rental.id, paymentMethodId, transactionRef, amount, receiptImageData: receipt, receiptHash,
        status: "PENDING", durationDays, createdBy: user.id,
      });
      await notifyAdmin({
        title: "طلب جديد — بانتظار التفعيل",
        body: `فعّل اشتراك ${customer.name} (${platform.name}) ثم اضغط «تم التفعيل» لإشعار العميل`,
        kind: "ACTIVATION",
        href: "/inbox",
      });
      await audit(user, "ON_DEMAND_SALE", "rentals", rental.id, `طلب عند الطلب ${platform.name} — ${customer.name} (${customerPhone}) — بانتظار تفعيل المدير`);
      return Response.json({
        ok: true, rentalId: rental.id, onDemand: true, pendingActivation: true,
        message: "تم استلام الطلب والسند وإرساله للمدير. سيُفعَّل اشتراك العميل يدوياً، ويصله إشعار فور التفعيل.",
        customer: { name: customer.name, phone: customer.phone },
        platformName: platform.name, durationDays,
        endDate: neededEnd.toISOString(), paymentStatus: "PENDING",
      });
    }

    async function respondWithAccount(rentalId: number, acc: typeof accounts.$inferSelect, prof: typeof profiles.$inferSelect | null, endDate: Date, isRenewal: boolean) {
      // 🔒 الأمان: لا تُعرض بيانات الحساب (إيميل/كلمة مرور) للموظف إلا بعد تأكيد المدير للسند.
      const profileLabel = prof ? `بروفايل ${prof.profileNo}` : (acc.type === "FULL" ? "حساب كامل" : "بروفايل");
      await audit(user, isRenewal ? "RENEWAL_RECORDED" : "SALE_RECORDED", "rentals", rentalId,
        `${isRenewal ? "تسجيل تجديد" : "سحب اشتراك"} ${platform.name} — عميل ${customer.name} — بانتظار تأكيد المدير للسند (بيانات الحساب مقفلة)`);
      return Response.json({
        ok: true, rentalId, isRenewal,
        message: isRenewal
          ? "تم استلام طلب التجديد والسند — بانتظار مراجعة المدير وتأكيده."
          : "تم استلام طلب الاشتراك والسند — بانتظار مراجعة المدير. بعد التأكيد ستظهر بيانات الحساب في «مبيعاتي».",
        customer: { name: customer.name, phone: customer.phone },
        platformName: platform.name,
        accountType: acc.type === "FULL" ? "FULL" : "PROFILE",
        durationDays,
        pendingReview: true,
        accountLabel: profileLabel,
        endDate: endDate.toISOString(),
        paymentStatus: "PENDING",
      });
    }

    // ---------- Renewal path: extend ACTIVE or reactivate ENDED-not-yet-removed ----------
    if (!forceNew) {
      const candidates = await db.select().from(rentals)
        .where(and(eq(rentals.customerId, customer.id), eq(rentals.platformId, platformId)))
        .orderBy(desc(rentals.createdAt));
      const renewable = candidates.find((r) => r.status === "ACTIVE") || candidates.find((r) => r.status === "ENDED");
      if (renewable && renewable.accountId) {
        const [acc] = await db.select().from(accounts).where(eq(accounts.id, renewable.accountId)).limit(1);
        let prof: typeof profiles.$inferSelect | null = null;
        let stillHeld = false;
        if (acc && !acc.isDeleted) {
          if (acc.type === "PROFILE" && renewable.profileId) {
            const [p] = await db.select().from(profiles).where(eq(profiles.id, renewable.profileId)).limit(1);
            prof = p ?? null;
            stillHeld = !!p && p.isOccupied && p.currentRentalId === renewable.id;
          } else {
            stillHeld = renewable.status === "ACTIVE" || acc.status === "NEEDS_PASSWORD_CHANGE";
          }
        }
        if (acc && stillHeld) {
          const newEnd = renewable.status === "ACTIVE" ? addDays(new Date(renewable.endDate), durationDays) : addDays(now, durationDays);
          if (new Date(acc.expiryDate) < newEnd) {
            return jsonError("الحساب الحالي للعميل ينتهي قبل نهاية مدة التجديد. اختر «بيع جديد» لسحب حساب آخر يغطي المدة.", 409);
          }
          await db.update(rentals).set({
            status: "ACTIVE", startDate: renewable.status === "ACTIVE" ? renewable.startDate : now,
            endDate: newEnd, whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
          }).where(eq(rentals.id, renewable.id));
          await db.insert(payments).values({
            rentalId: renewable.id, paymentMethodId, transactionRef, amount, receiptImageData: receipt, receiptHash,
            status: "PENDING", isExtension: true, durationDays, previousEndDate: renewable.endDate,
            previousRentalStatus: renewable.status, createdBy: user.id,
          });
          await refreshAccountStatus(acc.id);
          // refresh may keep NEEDS_PASSWORD_CHANGE for FULL if no ended logic; active rental forces RENTED
          if (acc.type === "FULL") await db.update(accounts).set({ status: "RENTED" }).where(eq(accounts.id, acc.id));
          await notifyAdmin({
            title: "طلب تجديد",
            body: `يرجى الموافقة على الطلب — ${customer.name} / ${platform.name}`,
            kind: "REQUEST",
            href: "/inbox",
          });
          await audit(user, "RENEWAL", "rentals", renewable.id, `تجديد ${platform.name} للعميل ${customer.name} — ${durationDays} يوم — سند ${transactionRef}`);
          return respondWithAccount(renewable.id, acc, prof, newEnd, true);
        }
      }
    }

    // ---------- New sale path: atomic claim ----------
    const neededEnd = addDays(now, durationDays);
    const candidates = await db.select().from(accounts)
      .where(and(eq(accounts.platformId, platformId), eq(accounts.isDeleted, false)))
      .orderBy(asc(accounts.expiryDate));

    let claimedAcc: typeof accounts.$inferSelect | null = null;
    let claimedProfile: typeof profiles.$inferSelect | null = null;

    for (const acc of candidates) {
      if (acc.status === "NEEDS_PASSWORD_CHANGE") continue;
      if (new Date(acc.expiryDate) < neededEnd) continue;
      if (saleType === "FULL" && acc.type !== "FULL") continue;
      if (saleType === "PROFILE" && acc.type !== "PROFILE") continue;
      if (acc.type === "FULL") {
        if (acc.status !== "AVAILABLE") continue;
        const claimed = await db.update(accounts).set({ status: "RENTED", updatedAt: now })
          .where(and(eq(accounts.id, acc.id), eq(accounts.status, "AVAILABLE"))).returning();
        if (claimed.length) { claimedAcc = claimed[0]; break; }
      } else {
        const free = await db.select().from(profiles)
          .where(and(eq(profiles.accountId, acc.id), eq(profiles.isOccupied, false))).orderBy(asc(profiles.profileNo)).limit(1);
        if (!free.length) continue;
        const claimed = await db.update(profiles).set({ isOccupied: true })
          .where(and(eq(profiles.id, free[0].id), eq(profiles.isOccupied, false))).returning();
        if (claimed.length) { claimedAcc = acc; claimedProfile = claimed[0]; break; }
      }
    }

    if (!claimedAcc) {
      const typeLabel = saleType === "FULL" ? "حساب كامل" : saleType === "PROFILE" ? "ملف/بروفايل" : "حساب متاح";
      await audit(user, "NO_STOCK", "platforms", platformId, `محاولة بيع ${platform.name} (${typeLabel}) — لا يوجد متاح يغطي ${durationDays} يوم`);
      return jsonError(`عفواً، لا يوجد «${typeLabel}» متاح حالياً لهذه المنصة يغطي المدة المطلوبة. تم إشعار المدير في سجل النظام.`, 409);
    }

    try {
      const isRenewalType = candidates && false; // new rentals for returning customers flagged below
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const [rental] = await db.insert(rentals).values({
        accountId: claimedAcc.id, profileId: claimedProfile?.id ?? null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays, status: "ACTIVE", passwordUsedEncrypted: claimedAcc.passwordEncrypted,
        customerEmail: customerEmail || null, customerExtra: customerExtra || null,
        activationStatus: (platform.requiresCustomerEmail || platform.extraFieldLabel) ? "PENDING" : "NOT_REQUIRED",
      }).returning();
      void isRenewalType;
      if (claimedProfile) await db.update(profiles).set({ currentRentalId: rental.id }).where(eq(profiles.id, claimedProfile.id));
      await db.insert(payments).values({
        rentalId: rental.id, paymentMethodId, transactionRef, amount, receiptImageData: receipt, receiptHash,
        status: "PENDING", durationDays, createdBy: user.id,
      });
      await refreshAccountStatus(claimedAcc.id);
      if (claimedAcc.type === "FULL") await db.update(accounts).set({ status: "RENTED" }).where(eq(accounts.id, claimedAcc.id));
      await notifyAdmin({
        title: "طلب جديد",
        body: `يرجى الموافقة على الطلب — ${customer.name} / ${platform.name}`,
        kind: "REQUEST",
        href: "/inbox",
      });
      await audit(user, "SALE", "rentals", rental.id, `بيع ${platform.name} للعميل ${customer.name} (${customer.phone}) — ${durationDays} يوم — سند ${transactionRef}`);
      return respondWithAccount(rental.id, claimedAcc, claimedProfile, neededEnd, false);
    } catch (err) {
      // Release claim on failure
      if (claimedProfile) await db.update(profiles).set({ isOccupied: false, currentRentalId: null }).where(eq(profiles.id, claimedProfile.id));
      if (claimedAcc.type === "FULL") await db.update(accounts).set({ status: "AVAILABLE" }).where(eq(accounts.id, claimedAcc.id));
      throw err;
    }
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return jsonError("حدث خطأ أثناء حفظ العملية — حاول مرة أخرى", 500);
  }
}
