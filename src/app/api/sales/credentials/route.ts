import { db } from "@/db";
import { rentals, accounts, profiles, payments, customers, platforms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { ensureSeeded } from "@/lib/seed";
import { decryptText } from "@/lib/crypto";
import { formatDate, renderTemplate } from "@/lib/constants";
import { getSetting } from "@/lib/engine";
import { normalizeDeliveryMode } from "@/lib/delivery";

export const dynamic = "force-dynamic";

/**
 * 🔒 عرض بيانات الحساب (إيميل + كلمة مرور + PIN) — متاح فقط بعد تأكيد المدير للسند.
 * المالك (الموظف الذي سجّل العملية) أو المدير فقط.
 */
export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const rentalId = Number(new URL(req.url).searchParams.get("rentalId"));
    if (!rentalId) return jsonError("طلب غير صالح");

    const [rental] = await db.select().from(rentals).where(eq(rentals.id, rentalId)).limit(1);
    if (!rental) return jsonError("اشتراك غير موجود", 404);

    const isOwner = rental.createdBy === user.id;
    const isAdmin = isAdminRole(user.role);
    if (!isOwner && !isAdmin) return jsonError("غير مصرح لك", 403);

    const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
    const [plat] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);

    // ---------- التسليم اليدوي الفوري: البيانات من الموظف نفسه — تُعرض فوراً ----------
    if (rental.deliverySource === "MANUAL") {
      const mPass = decryptText(rental.manualPasswordEncrypted);
      const mCode = decryptText(rental.manualCodeEncrypted);
      const lines = [
        rental.manualEmail && `📧 الإيميل: ${rental.manualEmail}`,
        mPass && `🔑 كلمة المرور: ${mPass}`,
        rental.manualLink && `🔗 الرابط: ${rental.manualLink}`,
        mCode && `🎟️ الكود: ${mCode}`,
        rental.manualNote && `📝 ${rental.manualNote}`,
      ].filter(Boolean).join("\n");
      const tpl = await getSetting("whatsapp_activation_template", "");
      const message = renderTemplate(tpl, {
        name: cust?.name || "", platform: plat?.name || "",
        email: rental.manualEmail || "", password: mPass || "",
        link: rental.manualLink || "", note: rental.manualNote || "",
        credentials: lines || "تم تسليم اشتراكك بنجاح ✓",
        end_date: rental.isLifetime ? "دائم ♾️" : formatDate(new Date(rental.endDate)),
      });
      await audit(user, "MANUAL_REVEALED", "rentals", rental.id, `عرض بيانات تسليم يدوي — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, manual: true, deliverySource: "MANUAL", isLifetime: !!rental.isLifetime,
        email: rental.manualEmail || "", password: mPass || "",
        profileLabel: "", pin: "", link: rental.manualLink || "", licenseKey: mCode || "",
        note: rental.manualNote || "", accountType: "MANUAL",
        customerName: cust?.name || "", customerPhone: cust?.phone || "",
        platformName: plat?.name || "", whatsappMessage: message,
      });
    }

    // ---------- طلبات "عند الطلب": بيانات التفعيل التي أدخلها المدير ----------
    // (التفعيل بحد ذاته هو تأكيد المدير، فلا نطلب تأكيد السند)
    if (rental.accountId === null || rental.accountId === undefined) {
      if (rental.activationStatus !== "ACTIVATED") {
        return jsonError("⏳ الطلب ما زال بانتظار تفعيل المدير. ستظهر البيانات فور ضغطه «تم التفعيل».", 409);
      }
      const mode = normalizeDeliveryMode(plat?.deliveryMode);
      const endLabel = rental.isLifetime ? "دائم ♾️" : formatDate(new Date(rental.endDate));
      // LINK_ONLY: رابط فقط — EMAIL: رسالة تفعيل على الإيميل بدون كلمات مرور
      if (mode === "LINK_ONLY") {
        const tpl = await getSetting("whatsapp_activation_template", "");
        const message = renderTemplate(tpl, {
          name: cust?.name || "", platform: plat?.name || "",
          email: "", password: "", link: rental.activatedLink || "", note: rental.activatedNote || "",
          credentials: `🔗 رابط التفعيل: ${rental.activatedLink || ""}${rental.activatedNote ? `\n📝 ${rental.activatedNote}` : ""}`,
          end_date: endLabel,
        });
        await audit(user, "ACTIVATION_REVEALED", "rentals", rental.id, `عرض رابط التفعيل — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
        return Response.json({
          ok: true, onDemand: true, deliveryMode: mode, isLifetime: !!rental.isLifetime,
          email: "", password: "", profileLabel: "", pin: "", link: rental.activatedLink || "",
          note: rental.activatedNote || "", accountType: "LINK_ONLY",
          customerName: cust?.name || "", customerPhone: cust?.phone || "",
          platformName: plat?.name || "", whatsappMessage: message,
        });
      }
      if (mode === "ON_DEMAND_EMAIL") {
        const tpl = await getSetting("whatsapp_activation_template", "");
        const activeLink = rental.activatedLink || rental.manualLink || "";
        const message = renderTemplate(tpl, {
          name: cust?.name || "", platform: plat?.name || "",
          email: rental.customerEmail || "", password: "", link: activeLink, note: rental.activatedNote || "",
          credentials: `تم التفعيل على إيميلك بنجاح ✓${activeLink ? `\n🔗 رابط التفعيل: ${activeLink}` : ""}${rental.activatedNote ? `\n📝 ${rental.activatedNote}` : ""}`,
          end_date: endLabel,
        });
        await audit(user, "ACTIVATION_REVEALED", "rentals", rental.id, `عرض تأكيد التفعيل على الإيميل — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
        return Response.json({
          ok: true, onDemand: true, deliveryMode: mode, isLifetime: !!rental.isLifetime,
          email: "", password: "", profileLabel: "", pin: "", link: activeLink,
          note: rental.activatedNote || "", accountType: "ON_DEMAND_EMAIL",
          activatedOnEmail: rental.customerEmail || "",
          customerName: cust?.name || "", customerPhone: cust?.phone || "",
          platformName: plat?.name || "", whatsappMessage: message,
        });
      }
      // وضع قديم/عام: أعرض أي بيانات تفعيل محفوظة
      const password = decryptText(rental.activatedPassword);
      const lines = [
        rental.activatedEmail && `📧 الإيميل: ${rental.activatedEmail}`,
        password && `🔑 كلمة المرور: ${password}`,
        rental.activatedPin && `🔒 PIN: ${rental.activatedPin}`,
        rental.activatedLink && `🔗 رابط التفعيل: ${rental.activatedLink}`,
        rental.activatedNote && `📝 ${rental.activatedNote}`,
      ].filter(Boolean).join("\n");
      const tpl = await getSetting("whatsapp_activation_template", "");
      const message = renderTemplate(tpl, {
        name: cust?.name || "", platform: plat?.name || "",
        email: rental.activatedEmail || "", password: password || "",
        link: rental.activatedLink || "", note: rental.activatedNote || "",
        credentials: lines || "تم تفعيل حسابك بنجاح ✓",
        end_date: endLabel,
      });
      await audit(user, "ACTIVATION_REVEALED", "rentals", rental.id, `عرض بيانات التفعيل — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, onDemand: true, deliveryMode: mode, isLifetime: !!rental.isLifetime,
        email: rental.activatedEmail || "", password: password || "",
        profileLabel: "", pin: rental.activatedPin || "", link: rental.activatedLink || "",
        note: rental.activatedNote || "", accountType: "ON_DEMAND",
        customerName: cust?.name || "", customerPhone: cust?.phone || "",
        platformName: plat?.name || "", whatsappMessage: message,
      });
    }

    // ---------- طلبات المخزون: بيانات الحساب ----------
    const pay = await db.select().from(payments)
      .where(and(eq(payments.rentalId, rentalId), eq(payments.status, "CONFIRMED"))).limit(1);
    if (!pay.length) {
      return jsonError("🔒 البيانات مقفلة — السند ما زال «بانتظار تأكيد المدير». ستظهر بعد تأكيده.", 409);
    }
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
    if (!acc) return jsonError("الحساب غير موجود", 404);
    const prof = rental.profileId ? (await db.select().from(profiles).where(eq(profiles.id, rental.profileId)).limit(1))[0] ?? null : null;
    const accKind = acc.deliveryKind === "INVITE_LINK" || acc.deliveryKind === "LICENSE_KEY" ? acc.deliveryKind : "CREDENTIALS";

    if (accKind === "INVITE_LINK") {
      const tpl = await getSetting("whatsapp_activation_template", "");
      const message = renderTemplate(tpl, {
        name: cust?.name || "", platform: plat?.name || "",
        email: "", password: "", link: acc.inviteLink || "", note: "",
        credentials: `🔗 رابط الدعوة: ${acc.inviteLink || ""}`,
        end_date: rental.isLifetime ? "دائم ♾️" : formatDate(new Date(rental.endDate)),
      });
      await audit(user, "LINK_REVEALED", "accounts", acc.id, `عرض رابط دعوة بعد تأكيد السند — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, deliveryMode: normalizeDeliveryMode(plat?.deliveryMode), isLifetime: !!rental.isLifetime,
        email: "", password: "", profileLabel: "🔗 رابط دعوة", pin: "", link: acc.inviteLink || "", licenseKey: "", note: "",
        accountType: acc.type, accountDeliveryKind: accKind,
        customerName: cust?.name || "", customerPhone: cust?.phone || "",
        platformName: plat?.name || "", whatsappMessage: message,
      });
    }
    if (accKind === "LICENSE_KEY") {
      const code = decryptText(acc.licenseKeyEncrypted);
      const tpl = await getSetting("whatsapp_activation_template", "");
      const message = renderTemplate(tpl, {
        name: cust?.name || "", platform: plat?.name || "",
        email: "", password: "", link: "", note: "",
        credentials: `🎟️ الكود: ${code}`,
        end_date: rental.isLifetime ? "دائم ♾️" : formatDate(new Date(rental.endDate)),
      });
      await audit(user, "LICENSE_REVEALED", "accounts", acc.id, `عرض كود ترخيص بعد تأكيد السند — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, deliveryMode: normalizeDeliveryMode(plat?.deliveryMode), isLifetime: !!rental.isLifetime,
        email: "", password: "", profileLabel: "🎟️ كود ترخيص", pin: "", link: "", licenseKey: code, note: "",
        accountType: acc.type, accountDeliveryKind: accKind,
        customerName: cust?.name || "", customerPhone: cust?.phone || "",
        platformName: plat?.name || "", whatsappMessage: message,
      });
    }

    const password = decryptText(acc.passwordEncrypted);
    const profileLabel = prof ? `بروفايل ${prof.profileNo}${prof.pin ? ` — PIN: ${prof.pin}` : ""}` : (acc.pin ? `PIN: ${acc.pin}` : "حساب كامل");
    const tpl = await getSetting("whatsapp_sale_template", "");
    const message = renderTemplate(tpl, {
      name: cust?.name || "", platform: plat?.name || "", email: acc.email || "", password,
      profile: profileLabel, end_date: rental.isLifetime ? "دائم ♾️" : formatDate(new Date(rental.endDate)),
    });

    await audit(user, "PASSWORD_REVEALED", "accounts", acc.id, `عرض بيانات الحساب بعد تأكيد السند — عميل ${cust?.name || ""} — بواسطة ${user.username}`);

    return Response.json({
      ok: true, deliveryMode: normalizeDeliveryMode(plat?.deliveryMode), isLifetime: !!rental.isLifetime,
      email: acc.email || "", password, profileLabel, pin: prof?.pin || acc.pin || "",
      link: "", licenseKey: "", note: "",
      accountType: acc.type, accountDeliveryKind: accKind,
      customerName: cust?.name || "", customerPhone: cust?.phone || "",
      platformName: plat?.name || "", whatsappMessage: message,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return jsonError("حدث خطأ", 500);
  }
}
