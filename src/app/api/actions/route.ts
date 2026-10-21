import { db } from "@/db";
import { accounts, profiles, rentals, payments, customers, platforms, whatsappLogs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAdmin, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { decryptText, encryptText } from "@/lib/crypto";
import { formatDate, renderTemplate } from "@/lib/constants";
import { getSetting, refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { normalizeDeliveryMode, lifetimeEndDate } from "@/lib/delivery";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");
    const now = new Date();

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

    // ---------- Confirm payment ----------
    if (action === "confirmPayment") {
      const [pay] = await db.select().from(payments).where(eq(payments.id, Number(b.paymentId))).limit(1);
      if (!pay) return jsonError("سند غير موجود", 404);
      await db.update(payments).set({ status: "CONFIRMED", reviewedBy: user.id, reviewedAt: now, rejectionReason: null }).where(eq(payments.id, pay.id));

      // المدة تبدأ من لحظة تأكيد المدير (لا من لحظة سحب السند من الموظف)
      // الاشتراك الدائم: تُحفظ تواريخه كما هي دون إعادة حساب
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, pay.rentalId)).limit(1);
      if (rental && rental.isLifetime) {
        await db.update(rentals).set({
          status: "ACTIVE", whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
        }).where(eq(rentals.id, rental.id));
      } else if (rental) {
        const days = Math.max(1, Number(pay.durationDays || rental.durationDays || 30));
        const start = now;
        const end = new Date(now.getTime() + days * 86400000);
        await db.update(rentals).set({
          startDate: start, endDate: end, durationDays: days,
          status: "ACTIVE", whatsappAlertSent: false, whatsappAlertSentAt: null, updatedAt: now,
        }).where(eq(rentals.id, rental.id));
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

    // ---------- Free a profile (admin removed customer manually on platform) ----------
    if (action === "freeProfile") {
      const [rental] = await db.select().from(rentals).where(eq(rentals.id, Number(b.rentalId))).limit(1);
      if (!rental) return jsonError("اشتراك غير موجود", 404);
      await db.update(rentals).set({ status: "CLOSED", updatedAt: now }).where(eq(rentals.id, rental.id));
      if (rental.profileId) await db.update(profiles).set({ isOccupied: false, currentRentalId: null }).where(eq(profiles.id, rental.profileId));
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

      // رسالة الواتساب حسب النمط
      const endLabel = rental.isLifetime ? "دائم ♾️" : formatDate(patch.endDate ? new Date(String(patch.endDate)) : new Date(rental.endDate));
      let credentials: string;
      if (mode === "LINK_ONLY") {
        credentials = `🔗 رابط التفعيل: ${aLink}${aNote ? `\n📝 ${aNote}` : ""}`;
      } else if (mode === "ON_DEMAND_EMAIL") {
        credentials = `تم التفعيل على إيميلك بنجاح ✓${aNote ? `\n📝 ${aNote}` : ""}`;
      } else {
        credentials = [
          aEmail && `📧 الإيميل: ${aEmail}`,
          aPass && `🔑 كلمة المرور: ${aPass}`,
          aPin && `🔒 PIN: ${aPin}`,
          aLink && `🔗 رابط التفعيل: ${aLink}`,
          aNote && `📝 ${aNote}`,
        ].filter(Boolean).join("\n") || "تم تفعيل حسابك بنجاح ✓";
      }
      const tpl = await getSetting("whatsapp_activation_template",
        "مبروك {{name}} 🎉\nاشتراك {{platform}} تم تفعيله بنجاح من متجر مايسترو كي 🔑\n{{credentials}}\n⏳ صالح حتى: {{end_date}}");
      const message = renderTemplate(tpl, {
        name: cust?.name || "", platform: plat?.name || "",
        email: aEmail, password: aPass, link: aLink, note: aNote,
        credentials, end_date: endLabel,
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
      return Response.json({ ok: true, customerPhone: cust?.phone || "", whatsappMessage: message, deliveryMode: mode });
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

    return jsonError("إجراء غير معروف");
  } catch (e) { if (e instanceof Response) return e; console.error(e); return jsonError("خطأ في الخادم", 500); }
}
