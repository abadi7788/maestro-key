import { db } from "@/db";
import { accounts, profiles, rentals, payments, customers, platforms, whatsappLogs, settings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { decryptText, encryptText } from "@/lib/crypto";
import { formatDate, renderTemplate, cleanPhone } from "@/lib/constants";
import bcrypt from "bcryptjs";
import { getSetting, refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { normalizeDeliveryMode, lifetimeEndDate } from "@/lib/delivery";
import { notifyAdmin } from "@/lib/notify";
import { hasPermission } from "@/lib/permissions";
import { refundToWallet } from "@/lib/wallet";
import { isAdminRole } from "@/lib/roles";
import { buildWhatsAppMessage, buildReplacementMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");
    const canManageInventory = isAdminRole(user.role) || hasPermission(user, "INVENTORY_MANAGE");
    const canConfirmOrders = isAdminRole(user.role) || hasPermission(user, "CONFIRM_LINK_ACTIVATION");
    const now = new Date();

    if (["revealPassword", "receipt", "moveToTrash", "restore", "permanentDelete", "deleteExpired", "emptyTrash", "restoreProfile", "confirmPasswordChange", "freeProfile"].includes(action)) {
      if (!canManageInventory) return jsonError("هذه الصلاحية لإدارة المخزون فقط", 403);
    }

    if (["confirmPayment", "rejectPayment", "activateRental", "cancelAndRefundToWallet"].includes(action)) {
      if (!canConfirmOrders) return jsonError("لا تملك صلاحية مراجعة وتأكيد طلبات التفعيل", 403);
    }

    // ---------- Reveal password / license (audited) ----------
    if (action === "revealPassword") {
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, Number(b.accountId))).limit(1);
      if (!acc) return jsonError("حساب غير موجود", 404);
      await audit(user, "PASSWORD_REVEALED", "accounts", acc.id, `المدير عرض بيانات ${acc.email || `#${acc.id}`} من شاشة المخزون`);
      return Response.json({ password: decryptText(acc.passwordEncrypted), licenseKey: decryptText(acc.licenseKeyEncrypted) });
    }

    // ---------- Receipt image (admin only, served on demand) ----------
    if (action === "receipt") {
      const [pay] = await db.select().from(payments).where(eq(payments.id, Number(b.paymentId))).limit(1);
      if (!pay) return jsonError("سند غير موجود", 404);
      await audit(user, "RECEIPT_VIEWED", "payments", pay.id, "عرض صورة سند");
      return Response.json({ image: pay.receiptImageData });
    }

    // ---------- Mark all inbox as read & reset badge ----------
    if (action === "markAllInboxRead") {
      // 1. إغلاق الاشتراكات المنتهية التي لم تعد بحاجة لإجراء معلق
      const endedList = await db.select().from(rentals).where(eq(rentals.status, "ENDED"));
      for (const r of endedList) {
        await db.update(rentals).set({ status: "CLOSED", updatedAt: now }).where(eq(rentals.id, r.id));
        if (r.profileId) {
          await db.update(profiles).set({ isOccupied: false, currentRentalId: null, status: "AVAILABLE", soldAt: null, soldBy: null }).where(eq(profiles.id, r.profileId));
        }
        if (r.accountId) {
          await refreshAccountStatus(r.accountId);
        }
      }

      // 2. تحديث حالة تنبيهات الاقتراب من الانتهاء كمراجعة
      await db.update(rentals).set({ whatsappAlertSent: true, whatsappAlertSentAt: now }).where(
        and(eq(rentals.status, "ACTIVE"), eq(rentals.whatsappAlertSent, false))
      );

      // 3. حفظ تاريخ المراجعة في الإعدادات
      const [existingSetting] = await db.select().from(settings).where(eq(settings.key, "inbox_last_read_at")).limit(1);
      if (existingSetting) {
        await db.update(settings).set({ value: now.toISOString() }).where(eq(settings.key, "inbox_last_read_at"));
      } else {
        await db.insert(settings).values({ key: "inbox_last_read_at", value: now.toISOString() });
      }

      await audit(user, "INBOX_MARKED_READ", "inbox", 0, "تحديد كافة التنبيهات كمقروءة وتصفير عداد الشارة");
      return Response.json({ ok: true, clearedEnded: endedList.length });
    }

    // ---------- Confirm payment ----------
    if (action === "confirmPayment") {
      const [pay] = await db.select().from(payments).where(eq(payments.id, Number(b.paymentId))).limit(1);
      if (!pay) return jsonError("سند غير موجود", 404);
      await db.update(payments).set({ status: "CONFIRMED", reviewedBy: user.id, reviewedAt: now, rejectionReason: null }).where(eq(payments.id, pay.id));

      // المدة تبدأ من لحظة تأكيد المدير (لا من لحظة سحب السند من الموظف)
      // بيع مباشر / مدى الحياة: تكتمل دورته بمجرد التأكيد دون عدادات انتهاء
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, pay.rentalId)).limit(1);
      if (rental) {
        let isOneTime = rental.isLifetime;
        if (rental.accountId) {
          const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
          if (acc?.deliveryKind === "LICENSE_KEY") isOneTime = true;
        }
        if (isOneTime) {
          await db.update(rentals).set({
            status: "COMPLETED", whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
          }).where(eq(rentals.id, rental.id));
        } else {
          const days = Math.max(1, Number(pay.durationDays || rental.durationDays || 30));
          const start = now;
          const end = new Date(now.getTime() + days * 86400000);
          await db.update(rentals).set({
            startDate: start, endDate: end, durationDays: days,
            status: "ACTIVE", whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
          }).where(eq(rentals.id, rental.id));
        }
      }

      if (rental) {
        await notifyAdmin({
          title: "تم تأكيد الطلب",
          body: `وافق المدير على الطلب رقم ${pay.transactionRef}. يمكنك الآن عرض بيانات الحساب وإرسالها للعميل.`,
          kind: "CONFIRMED",
          href: "/my-sales",
          forUserId: rental.createdBy,
        });
      }
      await audit(user, "PAYMENT_CONFIRMED", "payments", pay.id, `تأكيد سند ${pay.transactionRef} — تبدأ مدة الاشتراك من اليوم`);
      return Response.json({ ok: true });
    }

    // ---------- Reject payment: rollback rental ----------
    if (action === "rejectPayment") {
      const reason = String(b.reason || "سند غير مقبول");
      const [pay] = await db.select().from(payments).where(eq(payments.id, Number(b.paymentId))).limit(1);
      if (!pay) return jsonError("سند غير موجود", 404);
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, pay.rentalId)).limit(1);
      await db.update(payments).set({ status: "REJECTED", reviewedBy: user.id, reviewedAt: now, rejectionReason: reason }).where(eq(payments.id, pay.id));
      if (rental) {
        if (pay.isExtension && pay.previousEndDate) {
          const prevStatus = pay.previousRentalStatus || "ACTIVE";
          await db.update(rentals).set({ endDate: pay.previousEndDate, status: prevStatus === "ENDED" ? "ENDED" : "ACTIVE", updatedAt: now }).where(eq(rentals.id, rental.id));
        } else {
          await db.update(rentals).set({ status: "REJECTED", updatedAt: now }).where(eq(rentals.id, rental.id));
          if (rental.profileId) await db.update(profiles).set({ isOccupied: false, currentRentalId: null }).where(eq(profiles.id, rental.profileId));
        }
        if (rental.accountId) {
          // روابط الدعوة والأكواد: إرجاع مرة الاستخدام المستهلكة
          const [rejAcc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
          if (rejAcc && (rejAcc.deliveryKind === "INVITE_LINK" || rejAcc.deliveryKind === "LICENSE_KEY")) {
            const { sql } = await import("drizzle-orm");
            await db.update(accounts)
              .set({ usedCount: sql`GREATEST(${accounts.usedCount} - 1, 0)`, status: "AVAILABLE", updatedAt: now })
              .where(eq(accounts.id, rental.accountId));
          }
          await refreshAccountStatus(rental.accountId);
          if (!pay.isExtension) {
            const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
            if (acc?.type === "FULL" && acc.deliveryKind !== "INVITE_LINK" && acc.deliveryKind !== "LICENSE_KEY") {
              const active = await db.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.accountId, acc.id), eq(rentals.status, "ACTIVE")));
              if (!active.length) await db.update(accounts).set({ status: "AVAILABLE" }).where(eq(accounts.id, acc.id));
            }
          }
        }
      }
      if (rental) {
        await notifyAdmin({
          title: "تم رفض الطلب",
          body: `رفض المدير الطلب. السبب: ${reason}`,
          kind: "REJECTED",
          href: "/my-sales",
          forUserId: rental.createdBy,
        });
      }
      await audit(user, "PAYMENT_REJECTED", "payments", pay.id, `رفض سند ${pay.transactionRef} — ${reason} — تم إلغاء/تراجع الاشتراك`);
      return Response.json({ ok: true });
    }

    // ---------- Edit rental details (admin only) ----------
    if (action === "editRental") {
      if (!isAdminRole(user.role)) return jsonError("هذه الصلاحية للمدير فقط", 403);
      const rentalId = Number(b.rentalId);
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("الاشتراك غير موجود", 404);

      const customerName = String(b.customerName || "").trim();
      const customerPhone = cleanPhone(String(b.customerPhone || ""));
      const platformId = b.platformId ? Number(b.platformId) : rental.platformId;
      const isLifetime = Boolean(b.isLifetime);
      const customerEmail = b.customerEmail !== undefined ? String(b.customerEmail).trim() : rental.customerEmail;
      const customerExtra = b.customerExtra !== undefined ? String(b.customerExtra).trim() : rental.customerExtra;

      // تحديث بيانات العميل
      if (customerName || customerPhone) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
        if (cust) {
          await db.update(customers).set({
            name: customerName || cust.name,
            phone: customerPhone || cust.phone,
          }).where(eq(customers.id, cust.id));
        }
      }

      const updateData: any = { updatedAt: now };
      if (platformId) updateData.platformId = platformId;
      updateData.isLifetime = isLifetime;
      if (isLifetime) {
        updateData.endDate = lifetimeEndDate();
        updateData.durationDays = 0;
        if (rental.status === "ACTIVE") updateData.status = "COMPLETED";
      } else if (b.endDate) {
        updateData.endDate = new Date(b.endDate);
        const diffMs = updateData.endDate.getTime() - new Date(rental.startDate).getTime();
        updateData.durationDays = Math.max(1, Math.round(diffMs / 86400000));
        if (rental.status === "COMPLETED") updateData.status = "ACTIVE";
      }
      if (b.customerEmail !== undefined) updateData.customerEmail = customerEmail || null;
      if (b.customerExtra !== undefined) updateData.customerExtra = customerExtra || null;

      await db.update(rentals).set(updateData).where(eq(rentals.id, rental.id));
      await audit(user, "RENTAL_EDITED", "rentals", rental.id, `تعديل بيانات الاشتراك #${rental.id} للعميل: ${customerName || rental.customerId}`);
      return Response.json({ ok: true, message: "تم حفظ التعديلات على الاشتراك بنجاح" });
    }

    // ---------- Rollback rental (admin only) ----------
    if (action === "rollbackRental") {
      if (!isAdminRole(user.role)) return jsonError("هذه الصلاحية للمدير فقط", 403);
      const rentalId = Number(b.rentalId);
      const reason = String(b.reason || "استرجاع وإلغاء تفعيل الاشتراك من قبل الإدارة").trim();
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("الاشتراك غير موجود", 404);

      // تحرير البروفايل فوراً ليعود متاحاً
      if (rental.profileId) {
        await db.update(profiles).set({
          isOccupied: false, currentRentalId: null, status: "AVAILABLE", soldAt: null, soldBy: null
        }).where(eq(profiles.id, rental.profileId));
      }

      // تحرير الحساب فوراً
      if (rental.accountId) {
        const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
        if (acc) {
          if (acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY") {
            const { sql } = await import("drizzle-orm");
            await db.update(accounts)
              .set({ usedCount: sql`GREATEST(${accounts.usedCount} - 1, 0)`, status: "AVAILABLE", updatedAt: now })
              .where(eq(accounts.id, acc.id));
          } else if (acc.type === "FULL") {
            await db.update(accounts).set({ status: "AVAILABLE", updatedAt: now }).where(eq(accounts.id, acc.id));
          }
          await refreshAccountStatus(acc.id);
        }
      }

      // تحديث حالة الاشتراك إلى REFUNDED
      await db.update(rentals).set({
        status: "REFUNDED",
        refundedAt: now,
        refundReason: reason,
        updatedAt: now,
      }).where(eq(rentals.id, rental.id));

      // تسوية السندات وإعادة رصيد المحفظة إن وجد
      const rentalPayments = await db.select().from(payments).where(eq(payments.rentalId, rental.id));
      for (const p of rentalPayments) {
        await db.update(payments).set({
          status: "REFUNDED",
          rejectionReason: `استرجاع: ${reason}`,
        }).where(eq(payments.id, p.id));

        if (p.transactionRef?.startsWith("WALLET-") || !p.paymentMethodId) {
          try {
            await refundToWallet({
              userId: rental.createdBy,
              amount: p.amount,
              rentalId: rental.id,
              note: `استرجاع اشتراك: ${reason}`,
              createdBy: user.id,
            });
          } catch (err) {
            console.warn("Wallet refund error during rollback:", err);
          }
        }
      }

      await audit(user, "RENTAL_ROLLBACK", "rentals", rental.id, `استرجاع الاشتراك #${rental.id} — السبب: ${reason} — تحرير الحساب وتسوية المبلغ`);
      return Response.json({ ok: true, message: "تم استرجاع الاشتراك وتحرير الحساب/البروفايل في المخزون وتسوية السجل المالي بنجاح" });
    }

    // ---------- Hard delete rental (admin only with password check) ----------
    if (action === "hardDeleteRental") {
      if (!isAdminRole(user.role)) return jsonError("هذه الصلاحية للمدير فقط", 403);
      const rentalId = Number(b.rentalId);
      const adminPassword = String(b.adminPassword || "");
      if (!adminPassword) return jsonError("يرجى إدخال كلمة مرور المدير لتأكيد الحذف النهائي");

      // التحقق من كلمة مرور المدير
      const validPw = await bcrypt.compare(adminPassword, user.passwordHash);
      if (!validPw) {
        await audit(user, "HARD_DELETE_REJECTED", "rentals", rentalId, "محاولة حذف اشتراك بكلمة مرور مدير خاطئة");
        return jsonError("كلمة مرور المدير غير صحيحة — تم رفض الحذف النهائي", 403);
      }

      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("الاشتراك غير موجود", 404);

      // تحرير البروفايل إن كان مرتبطاً
      if (rental.profileId) {
        await db.update(profiles).set({
          isOccupied: false, currentRentalId: null, status: "AVAILABLE", soldAt: null, soldBy: null
        }).where(eq(profiles.id, rental.profileId));
      }

      // تحرير الحساب إن كان مرتبطاً
      if (rental.accountId) {
        const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
        if (acc) {
          if (acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY") {
            const { sql } = await import("drizzle-orm");
            await db.update(accounts)
              .set({ usedCount: sql`GREATEST(${accounts.usedCount} - 1, 0)`, status: "AVAILABLE", updatedAt: now })
              .where(eq(accounts.id, acc.id));
          } else if (acc.type === "FULL") {
            await db.update(accounts).set({ status: "AVAILABLE", updatedAt: now }).where(eq(accounts.id, acc.id));
          }
          await refreshAccountStatus(acc.id);
        }
      }

      // حذف السجلات المرتبطة نهائياً
      await db.delete(payments).where(eq(payments.rentalId, rentalId));
      await db.delete(whatsappLogs).where(eq(whatsappLogs.rentalId, rentalId));
      await db.delete(rentals).where(eq(rentals.id, rentalId));

      await audit(user, "RENTAL_HARD_DELETED", "rentals", rentalId, `تم حذف الاشتراك #${rentalId} نهائياً بعد التحقق من كلمة مرور المدير`);
      return Response.json({ ok: true, message: "تم حذف الاشتراك وسجلاته نهائياً من قاعدة البيانات" });
    }

    // ---------- Free a profile (admin removed customer manually on platform) ----------
    if (action === "freeProfile") {
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, Number(b.rentalId))).limit(1);
      if (!rental) return jsonError("اشتراك غير موجود", 404);
      await db.update(rentals).set({ status: "CLOSED", updatedAt: now }).where(eq(rentals.id, rental.id));
      if (rental.profileId) await db.update(profiles).set({ isOccupied: false, currentRentalId: null, status: "AVAILABLE", soldAt: null, soldBy: null }).where(eq(profiles.id, rental.profileId));
      if (rental.accountId) {
        // If no active/ended rentals remain on a PROFILE account -> require password change before resale
        const remaining = await db.select({ id: rentals.id }).from(rentals)
          .where(and(eq(rentals.accountId, rental.accountId), eq(rentals.status, "ACTIVE")));
        const endedLeft = await db.select({ id: rentals.id }).from(rentals)
          .where(and(eq(rentals.accountId, rental.accountId), eq(rentals.status, "ENDED")));
        const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
        if (acc?.type === "PROFILE" && !remaining.length && !endedLeft.length) {
          await db.update(accounts).set({ status: "NEEDS_PASSWORD_CHANGE", updatedAt: now }).where(eq(accounts.id, acc.id));
        } else {
          await refreshAccountStatus(rental.accountId);
        }
        await audit(user, "PROFILE_FREED", "rentals", rental.id, "تأكيد إزالة العميل من البروفايل يدوياً وتحرير البروفايل");
        return Response.json({ ok: true, needsPasswordChange: !remaining.length && !endedLeft.length });
      }
      await audit(user, "RENTAL_CLOSED", "rentals", rental.id, "إغلاق طلب (عند الطلب)");
      return Response.json({ ok: true, needsPasswordChange: false });
    }

    // ---------- Confirm password changed ----------
    if (action === "confirmPasswordChange") {
      const accountId = Number(b.accountId); const newPassword = String(b.newPassword || "");
      if (!newPassword) return jsonError("أدخل كلمة المرور الجديدة التي وضعتها في المنصة");
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!acc) return jsonError("حساب غير موجود", 404);
      const active = await db.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ACTIVE")));
      if (active.length) return jsonError("لا يمكن تغيير كلمة المرور — توجد اشتراكات نشطة على الحساب ستتضرر", 409);
      if (acc.type === "PROFILE") {
        const ended = await db.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ENDED")));
        if (ended.length) return jsonError("أزل العملاء المنتهية فترتهم من البروفايلات أولاً، ثم غيّر كلمة المرور", 409);
      }
      await db.update(rentals).set({ status: "CLOSED", updatedAt: now }).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ENDED")));
      await db.update(accounts).set({ passwordEncrypted: encryptText(newPassword), status: "AVAILABLE", updatedAt: now }).where(eq(accounts.id, accountId));
      await audit(user, "PASSWORD_CHANGED", "accounts", accountId, `تأكيد تغيير كلمة مرور ${acc.email} وإعادته للمخزون`);
      return Response.json({ ok: true });
    }

    // ---------- Activate an order (mode-aware) ----------
    if (action === "activateRental") {
      const rentalId = Number(b.rentalId);
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("طلب غير موجود", 404);
      if (rental.activationStatus === "ACTIVATED") return jsonError("هذا الطلب مُفعّل مسبقاً", 409);
      const [platRow] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);
      const mode = normalizeDeliveryMode(platRow?.deliveryMode);

      const aLink = String(b.link || "").trim();
      const aNote = String(b.note || "").trim();
      // LINK_ONLY يتطلب الرابط فقط — لا إيميل ولا باسورد ولا PIN
      if (mode === "LINK_ONLY" && !aLink) {
        return jsonError("ضع رابط الاشتراك / الدعوة أولاً ثم أكّد الإرسال");
      }
      // بيانات اختيارية للأنماط الأخرى (تُحفظ فقط إن أُدخلت)
      const aEmail = mode === "LINK_ONLY" ? "" : String(b.email || "").trim();
      const aPass = mode === "LINK_ONLY" ? "" : String(b.password || "").trim();
      const aPin = mode === "LINK_ONLY" ? "" : String(b.pin || "").trim();

      // المدة تبدأ من لحظة التفعيل (الدائم يُحفظ كما هو)
      const patch: Record<string, unknown> = {
        activationStatus: "ACTIVATED",
        activatedEmail: aEmail || null,
        activatedPassword: aPass ? encryptText(aPass) : null,
        activatedLink: aLink || null,
        activatedPin: aPin || null,
        activatedNote: aNote || null,
        activatedAt: now,
        activatedBy: user.id,
        status: "ACTIVE",
        updatedAt: now,
      };
      if (!rental.isLifetime) {
        const days = Math.max(1, rental.durationDays || 30);
        patch.startDate = now;
        patch.endDate = new Date(now.getTime() + days * 86400000);
      }
      await db.update(rentals).set(patch).where(eq(rentals.id, rental.id));

      // التفعيل اعتماد ضمني: أكّد أي سندات معلقة على نفس الطلب
      await db.update(payments).set({ status: "CONFIRMED", reviewedBy: user.id, reviewedAt: now, rejectionReason: null })
        .where(and(eq(payments.rentalId, rental.id), eq(payments.status, "PENDING")));

      const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      const [plat] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);

      // رسالة الواتساب الذكية حسب نوع الاشتراك والمنصة
      const endLabel = rental.isLifetime ? "دائم ♾️" : formatDate(patch.endDate ? new Date(String(patch.endDate)) : new Date(rental.endDate));
      const message = await buildWhatsAppMessage({
        customerName: cust?.name || "",
        customerPhone: cust?.phone || "",
        platformId: plat?.id ?? rental.platformId,
        platformName: plat?.name || "",
        accountType: mode === "LINK_ONLY" ? "LINK_ONLY" : (aPin ? "PROFILE" : "FULL"),
        accountDeliveryKind: mode === "LINK_ONLY" ? "INVITE_LINK" : "CREDENTIALS",
        email: aEmail || "",
        password: aPass || "",
        pin: aPin || "",
        link: aLink || "",
        note: aNote || "",
        endDate: patch.endDate ? new Date(String(patch.endDate)) : new Date(rental.endDate),
        isLifetime: !!rental.isLifetime,
        days: rental.durationDays,
        templateType: "ACTIVATION",
      });

      const hasMeta = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
      await db.insert(whatsappLogs).values({
        rentalId: rental.id, customerId: cust?.id ?? null, phone: cust?.phone ?? "",
        message, kind: "ACTIVATION", status: hasMeta ? "QUEUED" : "SIMULATED",
      });

      // إشعار الموظف الذي سجّل الطلب
      await notifyAdmin({
        title: mode === "LINK_ONLY" ? "تم إرسال رابط التفعيل" : "تم تفعيل الطلب",
        body: mode === "LINK_ONLY"
          ? `أرسل المدير رابط اشتراك ${cust?.name || ""} (${plat?.name || ""}). اعرضه وأرسله للعميل.`
          : `فعّل المدير اشتراك ${cust?.name || ""} (${plat?.name || ""}). يمكنك الآن عرض البيانات وإرسالها للعميل.`,
        kind: "ACTIVATED",
        href: "/my-sales",
        forUserId: rental.createdBy,
      });

      await audit(user, "RENTAL_ACTIVATED", "rentals", rental.id, `تفعيل طلب ${plat?.name || ""} (${mode}) للعميل ${cust?.name || ""}`);
      return Response.json({ ok: true, rentalId: rental.id, link: aLink, customerPhone: cust?.phone || "", whatsappMessage: message, deliveryMode: mode });
    }

    // ---------- Trash ----------
    if (action === "moveToTrash") {
      const accountId = Number(b.accountId);
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!acc) return jsonError("حساب غير موجود", 404);
      const active = await db.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ACTIVE")));
      if (active.length && !b.force) return Response.json({ needsConfirmation: true, error: `للحساب ${active.length} اشتراك نشط. نقله للمحذوفات لن يوقف اشتراك العميل على المنصة لكنه سيخفي الحساب من المخزون. متابعة؟` }, { status: 409 });
      await db.update(accounts).set({ isDeleted: true, deletedAt: now, deletedReason: String(b.reason || "بدون سبب مذكور") }).where(eq(accounts.id, accountId));
      await audit(user, "SOFT_DELETE", "accounts", accountId, `نقل ${acc.email} للمحذوفات — ${String(b.reason || "")}`);
      return Response.json({ ok: true });
    }
    if (action === "restore") {
      const accountId = Number(b.accountId);
      await db.update(accounts).set({ isDeleted: false, deletedAt: null, deletedReason: null, updatedAt: now }).where(eq(accounts.id, accountId));
      await refreshAccountStatus(accountId);
      await audit(user, "RESTORE", "accounts", accountId, "استرجاع حساب من سلة المحذوفات");
      return Response.json({ ok: true });
    }
    if (action === "permanentDelete") {
      const accountId = Number(b.accountId);
      const hasRentals = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.accountId, accountId)).limit(1);
      if (hasRentals.length) return jsonError("لا يمكن الحذف النهائي لحساب له سجل إيجارات — يبقى في المحذوفات حفاظاً على السجل المالي", 409);
      await db.delete(accounts).where(eq(accounts.id, accountId));
      await audit(user, "PERMANENT_DELETE", "accounts", accountId, "حذف نهائي من قاعدة البيانات");
      return Response.json({ ok: true });
    }
    if (action === "emptyTrash") {
      const trashed = await db.select({ id: accounts.id, email: accounts.email }).from(accounts).where(eq(accounts.isDeleted, true));
      let deletedCount = 0;
      let keptCount = 0;
      for (const t of trashed) {
        const hasRentals = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.accountId, t.id)).limit(1);
        if (hasRentals.length) {
          keptCount++;
        } else {
          await db.delete(profiles).where(eq(profiles.accountId, t.id));
          await db.delete(accounts).where(eq(accounts.id, t.id));
          deletedCount++;
        }
      }
      await audit(user, "TRASH_EMPTIED", "accounts", null, `إفراغ السلة: مسح ${deletedCount} حساب نهائياً، وتم الإبقاء على ${keptCount} حساب لوجود سجل مالي`);
      return Response.json({
        ok: true,
        deletedCount,
        keptCount,
        message: keptCount > 0
          ? `تم حذف ${deletedCount} حساب نهائياً. تم الإبقاء على ${keptCount} حساب لوجود سجلات إيجار مالية سابقة لها.`
          : `تم إفراغ سلة المحذوفات بالكامل (حُذف ${deletedCount} حساب نهائياً).`
      });
    }
    if (action === "restoreProfile") {
      const profileId = Number(b.profileId);
      const reason = String(b.reason || "استرجاع يدوي للبيع").trim();
      const newPinRaw = b.newPin !== undefined ? String(b.newPin).trim() : undefined;
      const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
      if (!prof) return jsonError("البروفايل غير موجود", 404);

      // إذا كان مرتبطاً بطلب إيجار حالي، نغلق الاشتراك
      if (prof.currentRentalId) {
        await db.update(rentals).set({
          status: "CLOSED",
          updatedAt: now,
        }).where(eq(rentals.id, prof.currentRentalId));
      }

      const patch: Partial<typeof profiles.$inferInsert> = {
        status: "AVAILABLE",
        isOccupied: false,
        soldAt: null,
        soldBy: null,
        currentRentalId: null,
      };
      if (newPinRaw !== undefined) {
        patch.pin = newPinRaw || null;
      }

      await db.update(profiles).set(patch).where(eq(profiles.id, profileId));
      await refreshAccountStatus(prof.accountId);
      const auditNote = `استرجاع بروفايل #${prof.profileNo} (${prof.profileName || ""}) — السبب: ${reason}${newPinRaw !== undefined ? ` — PIN جديد: ${newPinRaw || "بدون"}` : ""}`;
      await audit(user, "PROFILE_RESTORED", "profiles", profileId, auditNote);
      return Response.json({ ok: true, message: "تم استرجاع البروفايل وتعيين حالته متاحاً للبيع بنجاح" });
    }

    if (action === "restoreAccount") {
      const accountId = Number(b.accountId);
      const reason = String(b.reason || "استرجاع الحساب يدprop للمخزون").trim();
      const newPassword = b.newPassword ? String(b.newPassword).trim() : undefined;
      const newPin = b.newPin !== undefined ? String(b.newPin).trim() : undefined;
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!acc) return jsonError("الحساب غير موجود", 404);

      // إغلاق أي اشتراكات نشطة على هذا الحساب
      await db.update(rentals).set({
        status: "CLOSED",
        updatedAt: now,
      }).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ACTIVE")));

      // إذا كان الحساب بروفايلات، تصفير حالة البروفايلات لتكون متاحة
      if (acc.type === "PROFILE") {
        await db.update(profiles).set({
          status: "AVAILABLE",
          isOccupied: false,
          soldAt: null,
          soldBy: null,
          currentRentalId: null,
        }).where(eq(profiles.accountId, accountId));
      }

      const patch: Partial<typeof accounts.$inferInsert> = {
        status: "AVAILABLE",
        updatedAt: now,
      };
      if (newPassword) patch.passwordEncrypted = encryptText(newPassword);
      if (newPin !== undefined) patch.pin = newPin || null;

      await db.update(accounts).set(patch).where(eq(accounts.id, accountId));
      await refreshAccountStatus(accountId);
      await audit(user, "ACCOUNT_RESTORED", "accounts", accountId, `استرجاع الحساب ${acc.email || `#${accountId}`} للمخزون — السبب: ${reason}${newPassword ? " (مع كلمة مرور جديدة)" : ""}`);
      return Response.json({ ok: true, message: "تم استرجاع الحساب للمخزون بنجاح" });
    }
    if (action === "cancelAndRefundToWallet") {
      const rentalId = Number(b.rentalId);
      const reason = String(b.reason || "تعذر توفير الرابط — تم إلغاء الطلب وإرجاع المبلغ للمحفظة");
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("طلب غير موجود", 404);
      if (rental.status === "REJECTED" || rental.refundedAt) {
        return jsonError("تم إلغاء هذا الطلب أو إرجاعه مسبقاً", 400);
      }
      const [pay] = await db.select().from(payments).where(eq(payments.rentalId, rental.id)).limit(1);
      const refundAmount = pay?.amount ?? 0;
      const targetUserId = rental.createdBy;

      if (refundAmount > 0) {
        await refundToWallet({
          userId: targetUserId,
          amount: refundAmount,
          rentalId: rental.id,
          note: `استرجاع رصيد لإلغاء طلب رقم #${rental.id} (${reason})`,
          createdBy: user.id,
        });
      }

      await db.update(rentals).set({
        status: "REJECTED",
        refundedAt: now,
        refundReason: reason,
        updatedAt: now,
      }).where(eq(rentals.id, rental.id));

      if (pay) {
        await db.update(payments).set({
          status: "REJECTED",
          reviewedBy: user.id,
          reviewedAt: now,
          rejectionReason: reason,
        }).where(eq(payments.id, pay.id));
      }

      if (rental.profileId) {
        await db.update(profiles).set({
          status: "AVAILABLE",
          isOccupied: false,
          currentRentalId: null,
          soldAt: null,
          soldBy: null,
        }).where(eq(profiles.id, rental.profileId));
      }
      if (rental.accountId) {
        await refreshAccountStatus(rental.accountId);
      }

      const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      await notifyAdmin({
        title: "إلغاء طلب وإرجاع الرصيد",
        body: `تم إلغاء طلب ${cust?.name || ""} وإرجاع ${refundAmount.toLocaleString()} ر.ي إلى محفظة الموظف.`,
        kind: "REFUND",
        href: "/inbox",
        forUserId: targetUserId,
      });

      await audit(user, "ORDER_CANCELLED_REFUNDED", "rentals", rental.id, `إلغاء الطلب #${rental.id} وإرجاع ${refundAmount} ر.ي للمحفظة — السبب: ${reason}`);
      return Response.json({ ok: true, refundAmount });
    }

    // ---------- Delete an EXPIRED account directly (expired master validity) ----------
    if (action === "deleteExpired") {
      const accountId = Number(b.accountId);
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!acc) return jsonError("حساب غير موجود", 404);
      if (!acc.expiryDate || new Date(acc.expiryDate) >= new Date()) return jsonError("هذا الحساب لم ينتهِ بعد — لا يمكن حذفه كمُنتهٍ", 409);
      const active = await db.select({ id: rentals.id }).from(rentals).where(and(eq(rentals.accountId, accountId), eq(rentals.status, "ACTIVE")));
      if (active.length) return jsonError("لا يمكن حذف حساب عليه اشتراكات نشطة — انتهِ أول", 409);
      const hasRentals = await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.accountId, accountId)).limit(1);
      if (hasRentals.length) {
        // Keep financial history: move to trash (soft delete)
        await db.update(accounts).set({ isDeleted: true, deletedAt: new Date(), deletedReason: "حساب منتهي الصلاحية — حذفه المدير" }).where(eq(accounts.id, accountId));
        await audit(user, "EXPIRED_TO_TRASH", "accounts", accountId, `نقل حساب منتهي (${acc.email}) للمحذوفات للحفاظ على سجله المالي`);
        return Response.json({ ok: true, movedToTrash: true });
      }
      await db.delete(profiles).where(eq(profiles.accountId, accountId));
      await db.delete(accounts).where(eq(accounts.id, accountId));
      await audit(user, "EXPIRED_PERMANENT_DELETE", "accounts", accountId, `حذف نهائي لحساب منتهي الصلاحية (${acc.email}) بدون سجل إيجارات`);
      return Response.json({ ok: true, deleted: true });
    }

    // ---------- Run daily job manually ----------
    if (action === "runDailyJob") {
      const result = await runDailyJob({ sendAlerts: true });
      await audit(user, "DAILY_JOB", "system", null, `تشغيل المهمة اليومية: انتهى ${result.endedCount}، تنبيهات ${result.alertsSent}`);
      return Response.json({ ok: true, ...result });
    }

    // ---------- Send expiry warning now for a rental (creates log + returns wa message) ----------
    if (action === "sendWhatsapp") {
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, Number(b.rentalId))).limit(1);
      if (!rental) return jsonError("اشتراك غير موجود", 404);
      const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      const [plat] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);
      const tpl = await getSetting("whatsapp_expiry_template", "");
      const days = String(Math.max(0, Math.ceil((new Date(rental.endDate).getTime() - Date.now()) / 86400000)));
      const message = renderTemplate(tpl, { name: cust?.name ?? "", platform: plat?.name ?? "", end_date: formatDate(rental.endDate), days });
      const hasMeta = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
      await db.insert(whatsappLogs).values({ rentalId: rental.id, customerId: cust?.id ?? null, phone: cust?.phone ?? "", message, kind: "EXPIRY_WARNING", status: hasMeta ? "QUEUED" : "SIMULATED" });
      await db.update(rentals).set({ whatsappAlertSent: true, whatsappAlertSentAt: now }).where(eq(rentals.id, rental.id));
      await audit(user, "WHATSAPP_SENT", "rentals", rental.id, `تنبيه انتهاء للعميل ${cust?.name}`);
      return Response.json({ ok: true, message, phone: cust?.phone });
    }

    // ---------- Compensate & Replace Profile / Account (One-click) ----------
    if (action === "compensateReplacement") {
      const rentalId = Number(b.rentalId);
      const reason = String(b.reason || "تعويض واستبدال بروفايل جديد للعميل");
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
      if (!rental) return jsonError("الطلب أو الاشتراك غير موجود", 404);

      const [plat] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);
      const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      if (!plat || !cust) return jsonError("بيانات المنصة أو العميل غير مكتملة", 400);

      const isProfile = !!rental.profileId;
      let newAccount: any = null;
      let newProfile: any = null;

      if (isProfile) {
        // البحث عن بروفايل متاح لنفس المنصة
        const availProfiles = await db
          .select({
            profile: profiles,
            account: accounts,
          })
          .from(profiles)
          .innerJoin(accounts, eq(profiles.accountId, accounts.id))
          .where(
            and(
              eq(accounts.platformId, plat.id),
              eq(accounts.isDeleted, false),
              eq(accounts.status, "AVAILABLE"),
              eq(profiles.status, "AVAILABLE"),
              eq(profiles.isOccupied, false)
            )
          )
          .limit(1);

        if (!availProfiles.length) {
          return jsonError(`لا يوجد بروفايل متاح حالياً لمنصة "${plat.name}" للتعويض الفوري. يرجى تزويد المخزون أولاً.`, 409);
        }

        newProfile = availProfiles[0].profile;
        newAccount = availProfiles[0].account;

        // إخلاء البروفايل القديم
        if (rental.profileId) {
          await db.update(profiles).set({
            isOccupied: false,
            currentRentalId: null,
            status: "AVAILABLE",
            soldAt: null,
            soldBy: null,
          }).where(eq(profiles.id, rental.profileId));
        }

        // تخصيص البروفايل الجديد للطلب
        await db.update(profiles).set({
          isOccupied: true,
          currentRentalId: rental.id,
          status: "SOLD",
          soldAt: now,
          soldBy: user.id,
        }).where(eq(profiles.id, newProfile.id));

        // تحديث بيانات الاشتراك
        await db.update(rentals).set({
          accountId: newAccount.id,
          profileId: newProfile.id,
          passwordUsedEncrypted: newAccount.passwordEncrypted,
          status: "ACTIVE",
          updatedAt: now,
        }).where(eq(rentals.id, rental.id));

        if (rental.accountId) await refreshAccountStatus(rental.accountId);
        if (newAccount.id !== rental.accountId) await refreshAccountStatus(newAccount.id);

      } else {
        // حساب كامل
        const availAccounts = await db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.platformId, plat.id),
              eq(accounts.type, "FULL"),
              eq(accounts.isDeleted, false),
              eq(accounts.status, "AVAILABLE")
            )
          )
          .limit(1);

        if (!availAccounts.length) {
          return jsonError(`لا يوجد حساب كامل متاح حالياً لمنصة "${plat.name}" للتعويض الفوري.`, 409);
        }

        newAccount = availAccounts[0];

        // تحرير الحساب القديم
        if (rental.accountId) {
          await db.update(accounts).set({ status: "AVAILABLE", updatedAt: now }).where(eq(accounts.id, rental.accountId));
        }

        // تخصيص الحساب الجديد
        await db.update(accounts).set({ status: "RENTED", updatedAt: now }).where(eq(accounts.id, newAccount.id));

        await db.update(rentals).set({
          accountId: newAccount.id,
          passwordUsedEncrypted: newAccount.passwordEncrypted,
          status: "ACTIVE",
          updatedAt: now,
        }).where(eq(rentals.id, rental.id));
      }

      const rawPassword = decryptText(newAccount.passwordEncrypted);
      const rawLicense = decryptText(newAccount.licenseKeyEncrypted);

      // تجهيز رسالة الواتساب الذكية للاعتذار والتعويض
      const replacementMessage = await buildReplacementMessage({
        customerName: cust.name,
        customerPhone: cust.phone,
        platformId: plat.id,
        platformName: plat.name,
        accountType: isProfile ? "PROFILE" : "FULL",
        accountDeliveryKind: newAccount.deliveryKind,
        email: newAccount.email,
        password: rawPassword,
        profileName: newProfile ? (newProfile.profileName || `بروفايل ${newProfile.profileNo}`) : null,
        profileNo: newProfile?.profileNo ?? null,
        pin: newProfile?.pin || (isProfile ? newAccount.pin : ""),
        link: newAccount.inviteLink,
        licenseKey: rawLicense,
        endDate: rental.endDate,
        isLifetime: rental.isLifetime,
        reason,
      });

      await audit(user, "RENTAL_REPLACEMENT", "rentals", rental.id, `تعويض العميل ${cust.name} ببيانات جديدة لمنصة ${plat.name} — السبب: ${reason}`);

      return Response.json({
        ok: true,
        message: "تم سحب الحساب/البروفايل الجديد بنجاح وتجهيز رسالة التعويض",
        whatsappMessage: replacementMessage,
        customerPhone: cust.phone,
        newCredentials: {
          email: newAccount.email,
          password: rawPassword,
          profileName: newProfile ? (newProfile.profileName || `بروفايل ${newProfile.profileNo}`) : null,
          profileNo: newProfile?.profileNo ?? null,
          pin: newProfile?.pin || (isProfile ? newAccount.pin : ""),
          link: newAccount.inviteLink,
          licenseKey: rawLicense,
        }
      });
    }

    return jsonError("إجراء غير معروف");
  } catch (e) { if (e instanceof Response) return e; console.error(e); return jsonError("خطأ في الخادم", 500); }
}
