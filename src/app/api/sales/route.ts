import { db } from "@/db";
import { accounts, profiles, customers, rentals, payments, platforms, walletBalances, paymentMethods } from "@/db/schema";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { deductFromWallet, refundToWallet } from "@/lib/wallet";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { encryptText, decryptText, hashText } from "@/lib/crypto";
import { ALLOWED_DURATIONS, addDays, cleanPhone, formatDate, renderTemplate } from "@/lib/constants";
import { getSetting, refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { normalizeDeliveryMode, lifetimeEndDate, type DeliveryMode } from "@/lib/delivery";
import { notifyAdmin } from "@/lib/notify";
import { buildWhatsAppMessage } from "@/lib/whatsapp";

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
    const orderCount = rows.length;
    const tag = orderCount >= 3 ? "VIP" : orderCount >= 1 ? "ACTIVE" : "NEW";
    return Response.json({ customer, rentals: rows, orderCount, tag });
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
      // التحقق المسبق من توفر رصيد كافٍ في المحفظة دون الخصم قبل الأوان
      const [balRow] = await db
        .select({ balance: walletBalances.balance })
        .from(walletBalances)
        .where(eq(walletBalances.userId, user.id))
        .limit(1);
      const currentBalance = balRow?.balance ?? 0;
      if (currentBalance < amount) {
        return jsonError(
          `رصيد المحفظة غير كافٍ لإتمام العملية — المتاح: ${currentBalance.toLocaleString()} ر.ي والمطلوب: ${amount.toLocaleString()} ر.ي`,
          400
        );
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
    if (paymentType === "WALLET") {
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
      if (!effectivePaymentMethodId) {
        try {
          const [first] = await db.select({ id: paymentMethods.id }).from(paymentMethods).limit(1);
          if (first) effectivePaymentMethodId = first.id;
        } catch {}
      }
    }

    async function processWalletDeduction(rentalId: number, noteText: string) {
      if (paymentType !== "WALLET") return;
      await deductFromWallet({
        userId: user.id,
        amount,
        note: noteText,
        rentalId,
        createdBy: user.id,
      });
      walletDeducted = true;
      chargedUserId = user.id;
      chargedAmount = amount;
    }

    const [platform] = await db.select().from(platforms).where(eq(platforms.id, platformId)).limit(1);
    if (!platform) {
      return jsonError("منصة غير موجودة");
    }

    const mode: DeliveryMode = normalizeDeliveryMode(platform.deliveryMode);
    const isLinkMode = mode === "LINK_ONLY" || (b.deliverySource === "MANUAL" && !!b.manualLink) || (b.deliveryKind === "INVITE_LINK");
    const lifetime = !!platform.isLifetime || (isLinkMode && (!durationDays || durationDays <= 0));
    const days = lifetime ? 0 : (durationDays || 0);
    if (!lifetime && !isLinkMode && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      if (walletDeducted && chargedUserId) await refundToWallet({ userId: chargedUserId, amount: chargedAmount, note: "استرجاع: مدة اشتراك غير صالحة" });
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
        return jsonError("أدخل بيانات التسليم اليدوي (إيميل أو كلمة مرور أو رابط أو كود)");
      }
      const neededEnd = lifetime ? lifetimeEndDate() : addDays(now, days);
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const isDirectOneTime = Boolean(lifetime || manualCode);
      const initialStatus = isDirectOneTime && paymentType === "WALLET" ? "COMPLETED" : "ACTIVE";
      const [rental] = await db.insert(rentals).values({
        accountId: null, profileId: null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays: days, isLifetime: lifetime, status: initialStatus, activationStatus: "ACTIVATED",
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

      await processWalletDeduction(rental.id, `تسليم يدوي: ${platform.name}`);

      const message = await buildWhatsAppMessage({
        customerName: customer.name,
        customerPhone: customer.phone,
        platformId: platform.id,
        platformName: platform.name,
        accountType: saleType,
        accountDeliveryKind: manualLink ? "INVITE_LINK" : (manualCode ? "LICENSE_KEY" : "CREDENTIALS"),
        email: manualEmail,
        password: manualPassword,
        profileName: manualProfileName,
        pin: manualPin,
        link: manualLink,
        licenseKey: manualCode,
        note: manualNote,
        endDate: neededEnd,
        isLifetime: lifetime,
        days,
        templateType: "SALE",
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

      await processWalletDeduction(rental.id, `طلب اشتراك: ${platform.name}`);

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
      const profileLabel = accKind === "INVITE_LINK" ? "🔗 رابط دعوة" : accKind === "LICENSE_KEY" ? "🎟️ كود ترخيص" : (prof ? (prof.profileName || `بروفايل ${prof.profileNo}`) : (acc.type === "FULL" ? "حساب كامل" : "بروفايل"));
      
      let deliveredData: any = null;
      let waMessage = "";
      if (paymentType === "WALLET") {
        const password = acc.passwordEncrypted ? decryptText(acc.passwordEncrypted) : "";
        const code = acc.licenseKeyEncrypted ? decryptText(acc.licenseKeyEncrypted) : "";
        const pin = prof?.pin || (acc.type === "FULL" ? "" : acc.pin) || "";
        waMessage = await buildWhatsAppMessage({
          customerName: customer.name,
          customerPhone: customer.phone,
          platformId: platform.id,
          platformName: platform.name,
          accountType: acc.type,
          accountDeliveryKind: accKind,
          email: acc.email || "",
          password,
          profileName: prof?.profileName || null,
          profileNo: prof?.profileNo || null,
          pin,
          link: acc.inviteLink || "",
          licenseKey: code,
          endDate,
          isLifetime: lifetime,
          days,
          templateType: isRenewal ? "RENEWAL" : "SALE",
        });
        deliveredData = {
          email: acc.email || "",
          password,
          profileName: prof?.profileName || (prof ? `بروفايل ${prof.profileNo}` : ""),
          pin,
          link: acc.inviteLink || "",
          code,
        };
      }

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
        delivered: deliveredData,
        whatsappMessage: waMessage,
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
            return jsonError("الحساب الحالي للعميل ينتهي قبل نهاية مدة التجديد. اختر «بيع جديد» لسحب حساب آخر يغطي المدة.", 409);
          }
          await db.update(rentals).set({
            status: "ACTIVE", startDate: renewable.status === "ACTIVE" ? renewable.startDate : now,
            endDate: newEnd, durationDays: lifetime ? 0 : days, isLifetime: lifetime,
            whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
          }).where(eq(rentals.id, renewable.id));

          await db.insert(payments).values({
            rentalId: renewable.id, 
            paymentMethodId: effectivePaymentMethodId, 
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

          await processWalletDeduction(renewable.id, `تجديد اشتراك: ${platform.name}`);

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
        let claimedProfileRow: any = null;
        try {
          const claimed = await db.execute(sql`
            UPDATE profiles
            SET status = 'SOLD',
                sold_at = now(),
                sold_by = ${user.id},
                is_occupied = true,
                current_rental_id = NULL
            WHERE id = (
              SELECT id FROM profiles
              WHERE account_id = ${acc.id} AND (status = 'AVAILABLE' OR status IS NULL)
              ORDER BY id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING id, account_id, profile_no, profile_name, pin, status
          `);
          const rows = claimed.rows as any[];
          if (rows.length) claimedProfileRow = rows[0];
        } catch (colErr) {
          console.warn("[Profiles] Falling back to standard occupancy update:", colErr);
          const fallback = await db.execute(sql`
            UPDATE profiles
            SET is_occupied = true,
                current_rental_id = NULL
            WHERE id = (
              SELECT id FROM profiles
              WHERE account_id = ${acc.id} AND is_occupied = false
              ORDER BY id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING id, account_id, profile_no, profile_name, pin
          `);
          const rows = fallback.rows as any[];
          if (rows.length) claimedProfileRow = { ...rows[0], status: "SOLD" };
        }

        if (claimedProfileRow) {
          claimedAcc = acc;
          claimedProfile = {
            id: claimedProfileRow.id,
            accountId: claimedProfileRow.account_id,
            profileNo: claimedProfileRow.profile_no,
            profileName: claimedProfileRow.profile_name,
            pin: claimedProfileRow.pin,
            isOccupied: true,
            currentRentalId: null,
            status: claimedProfileRow.status || "SOLD",
            soldAt: now,
            soldBy: user.id,
            createdAt: now,
          } as typeof profiles.$inferSelect;
          break;
        }
      }
    }

    if (!claimedAcc) {
      const typeLabel = saleType === "FULL" ? "حساب كامل" : saleType === "PROFILE" ? "ملف/بروفايل" : "حساب متاح";
      return jsonError(`عفواً، لا يوجد «${typeLabel}» متاح حالياً لهذه المنصة يغطي المدة المطلوبة.`, 409);
    }

    try {
      const prior = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.customerId, customer.id)).limit(1);
      const isDirectOneTime = Boolean(lifetime || accKind === "LICENSE_KEY");
      const initialStatus = isDirectOneTime && paymentType === "WALLET" ? "COMPLETED" : "ACTIVE";
      const [rental] = await db.insert(rentals).values({
        accountId: claimedAcc.id, profileId: claimedProfile?.id ?? null, customerId: customer.id, platformId,
        createdBy: user.id, rentalType: prior.length ? "RENEWAL" : "NEW", startDate: now, endDate: neededEnd,
        durationDays: days, isLifetime: lifetime, status: initialStatus, passwordUsedEncrypted: claimedAcc.passwordEncrypted,
        customerEmail: customerEmail || null, customerExtra: customerExtra || null,
        activationStatus: (platform.requiresCustomerEmail || platform.extraFieldLabel) ? "PENDING" : "NOT_REQUIRED",
      }).returning();

      if (claimedProfile) {
        try {
          await db.execute(sql`
            UPDATE profiles
            SET current_rental_id = ${rental.id},
                is_occupied = true,
                status = 'SOLD'
            WHERE id = ${claimedProfile.id}
          `);
        } catch {
          await db.update(profiles).set({ currentRentalId: rental.id, isOccupied: true }).where(eq(profiles.id, claimedProfile.id));
        }
      }

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

      await processWalletDeduction(rental.id, `شراء اشتراك: ${platform.name}`);

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
      if (claimedProfile) {
        try {
          await db.execute(sql`
            UPDATE profiles
            SET is_occupied = false,
                current_rental_id = NULL,
                status = 'AVAILABLE',
                sold_at = NULL,
                sold_by = NULL
            WHERE id = ${claimedProfile.id}
          `);
        } catch {
          await db.update(profiles).set({ isOccupied: false, currentRentalId: null }).where(eq(profiles.id, claimedProfile.id));
        }
      }
      const ck = claimedAcc.deliveryKind === "INVITE_LINK" || claimedAcc.deliveryKind === "LICENSE_KEY" ? claimedAcc.deliveryKind : "CREDENTIALS";
      if (ck !== "CREDENTIALS") {
        await db.update(accounts).set({ usedCount: sql`GREATEST(${accounts.usedCount} - 1, 0)`, updatedAt: now }).where(eq(accounts.id, claimedAcc.id));
      } else if (claimedAcc.type === "FULL") {
        await db.update(accounts).set({ status: "AVAILABLE" }).where(eq(accounts.id, claimedAcc.id));
      }
      throw err;
    }
  } catch (e: any) {
    if (walletDeducted && chargedUserId && chargedAmount > 0) {
      try {
        await refundToWallet({
          userId: chargedUserId,
          amount: chargedAmount,
          note: "استرجاع تلقائي: تعذر إتمام الطلب",
          createdBy: chargedUserId,
        });
        console.log(`[Wallet] Auto-refunded ${chargedAmount} to user ${chargedUserId}`);
      } catch (refundErr) {
        console.error("[Wallet] Auto-refund failed:", refundErr);
      }
    }
    if (e instanceof Response) return e;
    const errorMsg = e?.message || (typeof e === "string" ? e : "حدث خطأ غير متوقع أثناء حفظ العملية");
    console.error("[Sales Error Detailed]:", errorMsg, e);
    return jsonError(`خطأ أثناء حفظ العملية: ${errorMsg}`, 500);
  }
}
