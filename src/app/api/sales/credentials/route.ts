import { db } from "@/db";
import { rentals, accounts, profiles, payments, customers, platforms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { decryptText } from "@/lib/crypto";
import { formatDate, renderTemplate } from "@/lib/constants";
import { getSetting } from "@/lib/engine";

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
    const isAdmin = user.role === "ADMIN";
    if (!isOwner && !isAdmin) return jsonError("غير مصرح لك", 403);

    const [cust] = await db.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
    const [plat] = await db.select().from(platforms).where(eq(platforms.id, rental.platformId)).limit(1);

    // ---------- طلبات "عند الطلب": بيانات التفعيل التي أدخلها المدير ----------
    // (التفعيل بحد ذاته هو تأكيد المدير، فلا نطلب تأكيد السند)
    if (rental.accountId === null || rental.accountId === undefined) {
      if (rental.activationStatus !== "ACTIVATED") {
        return jsonError("⏳ الطلب ما زال بانتظار تفعيل المدير. ستظهر البيانات فور ضغطه «تم التفعيل».", 409);
      }
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
        end_date: formatDate(new Date(rental.endDate)),
      });
      await audit(user, "ACTIVATION_REVEALED", "rentals", rental.id, `عرض بيانات التفعيل — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, onDemand: true,
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

    const password = decryptText(acc.passwordEncrypted);
    const profileLabel = prof ? `بروفايل ${prof.profileNo}${prof.pin ? ` — PIN: ${prof.pin}` : ""}` : (acc.pin ? `PIN: ${acc.pin}` : "حساب كامل");
    const tpl = await getSetting("whatsapp_sale_template", "");
    const message = renderTemplate(tpl, {
      name: cust?.name || "", platform: plat?.name || "", email: acc.email, password,
      profile: profileLabel, end_date: formatDate(new Date(rental.endDate)),
    });

    await audit(user, "PASSWORD_REVEALED", "accounts", acc.id, `عرض بيانات الحساب بعد تأكيد السند — عميل ${cust?.name || ""} — بواسطة ${user.username}`);

    return Response.json({
      ok: true, email: acc.email, password, profileLabel, pin: prof?.pin || acc.pin || "",
      accountType: acc.type, customerName: cust?.name || "", customerPhone: cust?.phone || "",
      platformName: plat?.name || "", whatsappMessage: message,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return jsonError("حدث خطأ", 500);
  }
}
