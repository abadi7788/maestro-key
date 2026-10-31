import { db } from "@/db";
import { accounts, profiles, customers, rentals, payments, platforms } from "@/db/schema";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { deductFromWallet, refundToWallet } from "@/lib/wallet";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { encryptText, hashText } from "@/lib/crypto";
import { ALLOWED_DURATIONS, addDays, cleanPhone, formatDate, renderTemplate } from "@/lib/constants";
import { getSetting, refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { normalizeDeliveryMode, lifetimeEndDate, type DeliveryMode } from "@/lib/delivery";
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
    }).from(rentals).innerJoin(platforms, eq(rentals.platformId, platforms.id)).leftJoin(accounts, eq(rentals.accountId, accounts.id))
      .where(eq(rentals.customerId, customer.id)).orderBy(desc(rentals.createdAt)).limit(20);
    return Response.json({ customer, rentals: rows });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}

export async function POST(req: Request) {
  let walletDeducted = false;
  let chargedUserId: number | null = null;
  let chargedAmount = 0;

  try {
    await ensureSeeded();
    const user = await requireUser();
    await runDailyJob({ sendAlerts: false });
    const b = await req.json().catch(() => ({}));
    const platformId = Number(b.platformId);
    const durationDays = Number(b.durationDays);
    const paymentType = b.paymentType === "WALLET" ? "WALLET" : "RECEIPT";
    const paymentMethodId = paymentType === "WALLET" ? null : Number(b.paymentMethodId);
    const transactionRef = paymentType === "WALLET" ? (b.transactionRef || `WALLET-${Date.now().toString().slice(-6)}`) : String(b.transactionRef || "").trim();
    const amount = Number(b.amount || 0);
    const receipt: string = paymentType === "WALLET" ? "" : String(b.receiptImageData || "");
    const customerName = String(b.customerName || "").trim();
    const customerPhone = cleanPhone(String(b.customerPhone || ""));
    const forceNew = b.mode === "NEW";
    const deliverySource = b.deliverySource === "MANUAL" ? "MANUAL" : "AUTO";
    const manualEmail = String(b.manualEmail || "").trim();
    const manualPassword = String(b.manualPassword || "");
    const manualLink = String(b.manualLink || "").trim();
    const manualCode = String(b.manualCode || "").trim();
    const manualNote = String(b.manualNote || "").trim();
    const manualProfileName = String(b.manualProfileName || "").trim();
    const manualPin = String(b.manualPin || "").trim();

    const rawType = b.accountType ?? b.saleType;
    const saleType = rawType === "FULL" || rawType === "FULL_PROFILE" ? "FULL" : rawType === "PROFILE" ? "PROFILE" : "AUTO";

    if (!platformId) return jsonError("اختر المنصة أولاً");
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("أدخل سعر الاشتراك يدوياً");
    if (customerPhone.length < 7) return jsonError("أدخل رقم واتساب العميل بشكل صحيح");

    if (paymentType === "WALLET") {
      try {
        await deductFromWallet(user.id, amount, "شراء اشتراك عبر المحفظة");
        walletDeducted = true;
        chargedUserId = user.id;
        chargedAmount = amount;
      } catch (err: any) {
        return jsonError(err.message || "رصيد المحفظة غير كافٍ لإتمام العملية", 400);
      }
    } else {
      if (!paymentMethodId || !transactionRef) return jsonError("يجب اختيار البنك وإدخال رقم العملية لإتمام العملية");
      if (!receipt || !receipt.startsWith("data:image")) return jsonError("إرفاق صورة السند إلزامي — صوّر السند أو ارفعه من الألبوم");
      if (receipt.length > 2_200_000) return jsonError("صورة السند كبيرة جداً، أعد تصويرها");

      const dupRef = await db.select({ id: payments.id }).from(payments)
        .where(and(eq(payments.paymentMethodId, paymentMethodId), eq(payments.transactionRef, transactionRef))).limit(1);
      if (dupRef.length) return jsonError("هذا السند مُستخدَم سابقاً — نفس البنك ورقم العملية مسجلان من قبل", 409);
      const receiptHash = hashText(receipt);
      const dupImg = await db.select({ id: payments.id }).from(payments).where(eq(payments.receiptHash, receiptHash)).limit(1);
      if (dupImg.length) return jsonError("صورة السند هذه مُستخدمة سابقاً في عملية أخرى", 409);
    }

    let effectivePaymentMethodId = paymentMethodId ?? null;
    if (paymentType === "WALLET" && !effectivePaymentMethodId) {
      try {
        const [wMethod] = await db.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.name, "المحفظة")).limit(1);
        if (wMethod) {
          effectivePaymentMethodId = wMethod.id;
        } else {
          const [created] = await db.insert(paymentMethods).values({ name: "المحفظة" }).returning({ id: paymentMethods.id });
          if (created) effectivePaymentMethodId = created.id;
        }
      } catch (pmErr) {
        console.warn("[Wallet] Could not resolve paymentMethodId for wallet:", pmErr);
      }
    }

    const [platform] = await db.select().from(platforms).where(eq(platforms.id, platformId)).limit(1);
    if (!platform) {
      if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: منصة غير موجودة");
      return jsonError("منصة غير موجودة");
    }

    const mode: DeliveryMode = normalizeDeliveryMode(platform.deliveryMode);
    const isLinkMode = mode === "LINK_ONLY";
    const lifetime = !!platform.isLifetime || (isLinkMode && (!durationDays || durationDays <= 0));
    const days = lifetime ? 0 : (durationDays || 0);
    if (!lifetime && !isLinkMode && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: مدة اشتراك غير صالحة");
      return jsonError("أدخل مدة الاشتراك بالأيام، من يوم واحد حتى 3650 يوماً");
    }

    const customerEmail = String(b.customerEmail || "").trim();
    const customerExtra = String(b.customerExtra || "").trim();
    const emailRequired = mode === "ON_DEMAND_EMAIL" || (mode === "INSTANT_INVENTORY" && platform.requiresCustomerEmail);
    if (emailRequired && !customerEmail) {
      if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: مطلوب إيميل العميل");
      return jsonError("هذا الاشتراك يتطلب إيميل العميل للتفعيل — اطلبه من العميل وأدخله أولاً");
    }

    let [customer] = await db.select().from(customers).where(eq(customers.phone, customerPhone)).limit(1);
    if (!customer) {
      if (!customerName) {
        if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: اسم العميل مفقود");
        return jsonError("أدخل اسم العميل الجديد");
      }
      [customer] = await db.insert(customers).values({ name: customerName, phone: customerPhone }).returning();
    }

    const now = new Date();
    const paymentStatus = paymentType === "WALLET" ? "CONFIRMED" : "PENDING";

    // ---------- مسار التسليم اليدوي الفوري ----------
    if (deliverySource === "MANUAL") {
      if (!manualEmail && !manualPassword && !manualLink && !manualCode) {
        if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: لم يتم إدخال بيانات تسليم");
        return jsonError("أدخل بيانات التسليم اليدوي (إيميل أو كلمة مرور أو رابط أو كود)");
      }
      const neededEnd = lifetime ? lifetimeEndDate() : addDays(now, days);
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const [rental] = await db.insert(rentals).values({
        accountId: null, profileId: null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays: days, isLifetime: lifetime, status: "ACTIVE", activationStatus: "ACTIVATED",
        activatedAt: now, activatedBy: user.id,
        deliverySource: "MANUAL",
        manualEmail: manualEmail || null,
        manualPasswordEncrypted: manualPassword ? encryptText(manualPassword) : null,
        manualLink: manualLink || null,
        manualCodeEncrypted: manualCode ? encryptText(manualCode) : null,
        manualNote: manualNote || null,
      }).returning();

      await db.insert(payments).values({
        rentalId: rental.id, 
        paymentMethodId: effectivePaymentMethodId, 
        transactionRef, 
        amount, 
        receiptImageData: receipt || null, 
        receiptHash: receipt ? hashText(receipt) : null,
        status: paymentStatus, 
        reviewedBy: paymentType === "WALLET" ? user.id : null,
        reviewedAt: paymentType === "WALLET" ? now : null,
        durationDays: days, 
        createdBy: user.id,
      });

      const lines = [
        manualEmail && `📧 الإيميل: ${manualEmail}`,
        manualPassword && `🔑 كلمة المرور: ${manualPassword}`,
        saleType === "PROFILE" && manualProfileName && `👤 البروفايل: ${manualProfileName}`,
        saleType === "PROFILE" && manualPin && `🔒 PIN البروفايل: ${manualPin}`,
        manualLink && `🔗 الرابط: ${manualLink}`,
        manualCode && `🎟️ الكود: ${manualCode}`,
        manualNote && `📝 ${manualNote}`,
      ].filter(Boolean).join("\n");

      const tpl = await getSetting("whatsapp_activation_template",
        "مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n{{credentials}}\n⏳ صالح حتى: {{end_date}}");
      const message = renderTemplate(tpl, {
        name: customer.name, platform: platform.name,
        email: manualEmail, password: manualPassword, link: manualLink, note: manualNote,
        credentials: lines || "تم تسليم اشتراكك بنجاح ✓",
        end_date: lifetime ? "دائم ♾️" : formatDate(neededEnd),
      });

      await notifyAdmin({
        title: paymentType === "WALLET" ? "تسليم يدوي (مدفوع بالمحفظة)" : "تسليم يدوي فوري",
        body: `سلّم ${user.displayName || user.username} اشتراك ${customer.name} (${platform.name}) — ${paymentType === "WALLET" ? "خُصم من المحفظة" : "السند بانتظار المراجعة"}`,
        kind: "MANUAL_SALE",
        href: "/rentals",
      });

      await audit(user, "MANUAL_SALE", "rentals", rental.id, `تسليم يدوي ${platform.name} — ${customer.name} (${customerPhone}) — ${paymentType}`);

      return Response.json({
        ok: true, rentalId: rental.id, manual: true,
        deliveryMode: mode, deliverySource: "MANUAL", isLifetime: lifetime,
        accountType: saleType,
        message: paymentType === "WALLET" ? "تم الخصم من المحفظة والتسليم اليدوي بنجاح!" : "تم التسليم اليدوي بنجاح — انسخ البيانات وأرسلها للعميل الآن.",
        customer: { name: customer.name, phone: customer.phone },
        platformName: platform.name, durationDays: days,
        endDate: neededEnd.toISOString(), paymentStatus,
        delivered: { email: manualEmail, password: manualPassword, profileName: manualProfileName, pin: manualPin, link: manualLink, code: manualCode, note: manualNote },
        whatsappMessage: message,
      });
    }

    // ---------- مسار "عند الطلب" (إيميل / رابط) ----------
    if (mode !== "INSTANT_INVENTORY") {
      const neededEnd = lifetime ? lifetimeEndDate() : addDays(now, days);
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const [rental] = await db.insert(rentals).values({
        accountId: null, profileId: null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays: days, isLifetime: lifetime, status: "ACTIVE", activationStatus: "PENDING",
        customerEmail: customerEmail || null, customerExtra: customerExtra || null,
      }).returning();

      await db.insert(payments).values({
        rentalId: rental.id, 
        paymentMethodId: effectivePaymentMethodId, 
        transactionRef, 
        amount, 
        receiptImageData: receipt || null, 
        receiptHash: receipt ? hashText(receipt) : null,
        status: paymentStatus, 
        durationDays: days, 
        createdBy: user.id,
      });

      await notifyAdmin({
        title: mode === "LINK_ONLY" ? "طلب رابط — بانتظار الإرسال" : "طلب جديد — بانتظار التفعيل",
        body: `${customer.name} (${platform.name}) — ${paymentType === "WALLET" ? "تم الدفع بالمحفظة" : "بانتظار السند"}`,
        kind: "ACTIVATION",
        href: "/inbox",
      });

      return Response.json({
        ok: true, rentalId: rental.id, onDemand: true, pendingActivation: true,
        deliveryMode: mode, isLifetime: lifetime,
        message: paymentType === "WALLET" ? "تم استلام الطلب وخصم المبلغ من المحفظة بنجاح، بانتظار التفعيل." : "تم استلام الطلب والسند وإرساله للمدير.",
        customer: { name: customer.name, phone: customer.phone },
        platformName: platform.name, durationDays: days,
        endDate: neededEnd.toISOString(), paymentStatus,
      });
    }

    async function respondWithAccount(rentalId: number, acc: typeof accounts.$inferSelect, prof: typeof profiles.$inferSelect | null, endDate: Date, isRenewal: boolean) {
      const accKind = acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY" ? acc.deliveryKind : "CREDENTIALS";
      const profileLabel = accKind === "INVITE_LINK" ? "🔗 رابط دعوة" : accKind === "LICENSE_KEY" ? "🎟️ كود ترخيص" : (prof ? `بروفايل ${prof.profileNo}` : (acc.type === "FULL" ? "حساب كامل" : "بروفايل"));
      
      return Response.json({
        ok: true, rentalId, isRenewal,
        message: paymentType === "WALLET" 
          ? "تم الخصم من المحفظة واعتماد الاشتراك فوراً بنجاح!" 
          : (isRenewal ? "تم استلام طلب التجديد والسند — بانتظار مراجعة المدير." : "تم استلام طلب الاشتراك والسند — بانتظار مراجعة المدير."),
        customer: { name: customer.name, phone: customer.phone },
        platformName: platform.name,
        accountType: acc.type === "FULL" ? "FULL" : "PROFILE",
        accountDeliveryKind: accKind,
        durationDays: days, isLifetime: lifetime, deliveryMode: mode,
        pendingReview: paymentType !== "WALLET",
        accountLabel: profileLabel,
        endDate: endDate.toISOString(),
        paymentStatus,
      });
    }

    // ---------- Renewal path ----------
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
          const newEnd = lifetime ? lifetimeEndDate() : (renewable.status === "ACTIVE" ? addDays(new Date(renewable.endDate), days) : addDays(now, days));
          if (!lifetime && acc.expiryDate && new Date(acc.expiryDate) < newEnd) {
            if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: الحساب ينتهي قبل مدة التجديد");
            return jsonError("الحساب الحالي للعميل ينتهي قبل نهاية مدة التجديد. اختر «بيع جديد» لسحب حساب آخر يغطي المدة.", 409);
          }
          await db.update(rentals).set({
            status: "ACTIVE", startDate: renewable.status === "ACTIVE" ? renewable.startDate : now,
            endDate: newEnd, durationDays: lifetime ? 0 : days, isLifetime: lifetime,
            whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
          }).where(eq(rentals.id, renewable.id));

          await db.insert(payments).values({
            rentalId: renewable.id, 
            paymentMethodId: paymentMethodId ?? null, 
            transactionRef, 
            amount, 
            receiptImageData: receipt || null, 
            receiptHash: receipt ? hashText(receipt) : null,
            status: paymentStatus, 
            isExtension: true, 
            durationDays: days, 
            previousEndDate: renewable.endDate,
            previousRentalStatus: renewable.status, 
            createdBy: user.id,
          });

          await refreshAccountStatus(acc.id);
          const renKind = acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY" ? acc.deliveryKind : "CREDENTIALS";
          if (acc.type === "FULL" && renKind === "CREDENTIALS") await db.update(accounts).set({ status: "RENTED" }).where(eq(accounts.id, acc.id));
          return respondWithAccount(renewable.id, acc, prof, newEnd, true);
        }
      }
    }

    // ---------- New sale path ----------
    const neededEnd = lifetime ? lifetimeEndDate() : addDays(now, days);
    const accCandidates = await db.select().from(accounts)
      .where(and(eq(accounts.platformId, platformId), eq(accounts.isDeleted, false)))
      .orderBy(asc(accounts.expiryDate));

    let claimedAcc: typeof accounts.$inferSelect | null = null;
    let claimedProfile: typeof profiles.$inferSelect | null = null;

    for (const acc of accCandidates) {
      if (acc.status === "NEEDS_PASSWORD_CHANGE") continue;
      if (!lifetime && acc.expiryDate && new Date(acc.expiryDate) < neededEnd) continue;
      const accKind = acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY" ? acc.deliveryKind : "CREDENTIALS";
      if (accKind !== "CREDENTIALS") {
        if (acc.status !== "AVAILABLE") continue;
        const inc = await db.update(accounts).set({ usedCount: sql`${accounts.usedCount} + 1`, updatedAt: now })
          .where(and(eq(accounts.id, acc.id), eq(accounts.status, "AVAILABLE"), or(isNull(accounts.maxUses), lt(accounts.usedCount, accounts.maxUses))))
          .returning();
        if (!inc.length) continue;
        claimedAcc = inc[0]; claimedProfile = null; break;
      }

      if (acc.type === "FULL") {
        if (saleType === "PROFILE") continue;
        if (acc.status !== "AVAILABLE") continue;
        const claimed = await db.update(accounts).set({ status: "RENTED", updatedAt: now })
          .where(and(eq(accounts.id, acc.id), eq(accounts.status, "AVAILABLE"))).returning();
        if (claimed.length) { claimedAcc = claimed[0]; break; }
      } else {
        if (saleType === "FULL") continue;
        const claimed = await db.execute(sql`
          UPDATE profiles
          SET status = 'SOLD',
              sold_at = now(),
              sold_by = ${user.id},
              is_occupied = true,
              current_rental_id = NULL
          WHERE id = (
            SELECT id FROM profiles
            WHERE account_id = ${acc.id} AND status = 'AVAILABLE'
            ORDER BY id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING id, account_id, profile_no, profile_name, pin, status
        `);
        const rows = claimed.rows as Array<{ id: number; account_id: number; profile_no: number; profile_name: string | null; pin: string | null; status: string }>;
        if (rows.length) {
          claimedAcc = acc;
          claimedProfile = {
            id: rows[0].id,
            accountId: rows[0].account_id,
            profileNo: rows[0].profile_no,
            profileName: rows[0].profile_name,
            pin: rows[0].pin,
            isOccupied: true,
            currentRentalId: null,
            status: rows[0].status,
            soldAt: now,
            soldBy: user.id,
            createdAt: now,
          } as typeof profiles.$inferSelect;
          break;
        }
      }
    }

    if (!claimedAcc) {
      if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: لا يوجد مخزون كافٍ");
      const typeLabel = saleType === "FULL" ? "حساب كامل" : saleType === "PROFILE" ? "ملف/بروفايل" : "حساب متاح";
      return jsonError(`عفواً، لا يوجد «${typeLabel}» متاح حالياً لهذه المنصة يغطي المدة المطلوبة.`, 409);
    }

    try {
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const [rental] = await db.insert(rentals).values({
        accountId: claimedAcc.id, profileId: claimedProfile?.id ?? null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays: days, isLifetime: lifetime, status: "ACTIVE", passwordUsedEncrypted: claimedAcc.passwordEncrypted,
        customerEmail: customerEmail || null, customerExtra: customerExtra || null,
        activationStatus: (platform.requiresCustomerEmail || platform.extraFieldLabel) ? "PENDING" : "NOT_REQUIRED",
      }).returning();

      if (claimedProfile) await db.update(profiles).set({ currentRentalId: rental.id }).where(eq(profiles.id, claimedProfile.id));

      await db.insert(payments).values({
        rentalId: rental.id, 
        paymentMethodId: effectivePaymentMethodId, 
        transactionRef, 
        amount, 
        receiptImageData: receipt || null, 
        receiptHash: receipt ? hashText(receipt) : null,
        status: paymentStatus, 
        reviewedBy: paymentType === "WALLET" ? user.id : null,
        reviewedAt: paymentType === "WALLET" ? now : null,
        durationDays: days, 
        createdBy: user.id,
      });

      await refreshAccountStatus(claimedAcc.id);
      const claimedKind = claimedAcc.deliveryKind === "INVITE_LINK" || claimedAcc.deliveryKind === "LICENSE_KEY" ? claimedAcc.deliveryKind : "CREDENTIALS";
      if (claimedAcc.type === "FULL" && claimedKind === "CREDENTIALS") await db.update(accounts).set({ status: "RENTED" }).where(eq(accounts.id, claimedAcc.id));

      // Low Stock Alert
      try {
        const threshold = platform.lowStockThreshold || 3;
        const availableProfiles = await db.execute(sql`
          SELECT count(*)::int as count
          FROM profiles p
          JOIN accounts a ON p.account_id = a.id
          WHERE a.platform_id = ${platformId}
            AND a.is_deleted = false
            AND a.status != 'NEEDS_PASSWORD_CHANGE'
            AND p.status = 'AVAILABLE'
        `);
        const availableFull = await db.execute(sql`
          SELECT count(*)::int as count
          FROM accounts a
          WHERE a.platform_id = ${platformId}
            AND a.type = 'FULL'
            AND a.is_deleted = false
            AND a.status = 'AVAILABLE'
        `);
        const profCount = Number((availableProfiles.rows[0] as any)?.count || 0);
        const fullCount = Number((availableFull.rows[0] as any)?.count || 0);
        const totalRemaining = profCount + fullCount;
        if (totalRemaining <= threshold) {
          await notifyAdmin({
            title: "⚠️ تنبيه انخفاض المخزون",
            body: `انخفض عدد الحسابات/البروفايلات المتاحة لمنصة ${platform.name} إلى ${totalRemaining} فقط (الحد الأدنى: ${threshold})`,
            kind: "LOW_STOCK",
            href: "/accounts",
          });
        }
      } catch (stockErr) {
        console.error("Low stock check error:", stockErr);
      }

      await notifyAdmin({
        title: paymentType === "WALLET" ? "طلب جديد مدفوع بالمحفظة" : "طلب جديد",
        body: `${customer.name} / ${platform.name} — ${paymentType === "WALLET" ? "تم الاعتماد الفوري" : "بانتظار تأكيد السند"}`,
        kind: "REQUEST",
        href: "/inbox",
      });

      await audit(user, "SALE", "rentals", rental.id, `بيع ${platform.name} للعميل ${customer.name} — ${paymentType}`);
      return respondWithAccount(rental.id, claimedAcc, claimedProfile, neededEnd, false);
    } catch (err) {
      if (walletDeducted && chargedUserId) await refundToWallet(chargedUserId, chargedAmount, "استرجاع: فشل حفظ سجل البيع");
      if (claimedProfile) await db.update(profiles).set({ isOccupied: false, currentRentalId: null }).where(eq(profiles.id, claimedProfile.id));
      const ck = claimedAcc.deliveryKind === "INVITE_LINK" || claimedAcc.deliveryKind === "LICENSE_KEY" ? claimedAcc.deliveryKind : "CREDENTIALS";
      if (ck !== "CREDENTIALS") {
        await db.update(accounts).set({ usedCount: sql`GREATEST(${accounts.usedCount} - 1, 0)`, updatedAt: now }).where(eq(accounts.id, claimedAcc.id));
      } else if (claimedAcc.type === "FULL") {
        await db.update(accounts).set({ status: "AVAILABLE" }).where(eq(accounts.id, claimedAcc.id));
      }
      throw err;
    }
  } catch (e) {
    if (walletDeducted && chargedUserId && chargedAmount > 0) {
      try {
        await refundToWallet(chargedUserId, chargedAmount, "استرجاع تلقائي: تعذر إتمام الطلب");
        console.log(`[Wallet] Auto-refunded ${chargedAmount} to user ${chargedUserId}`);
      } catch (refundErr) {
        console.error("[Wallet] Auto-refund failed:", refundErr);
      }
    }
    if (e instanceof Response) return e;
    console.error(e);
    return jsonError("حدث خطأ أثناء حفظ العملية — حاول مرة أخرى", 500);
  }
}
