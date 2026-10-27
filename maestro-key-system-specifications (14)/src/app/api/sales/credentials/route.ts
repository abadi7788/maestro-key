import { db } from "@/db";
import { rentals, accounts, profiles, payments, customers, platforms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { decryptText } from "@/lib/crypto";
import { formatDate, buildDeliveryLines, buildDeliveryMessage, type DeliveryInfo, type DeliveryType } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * 🔒 Reveal delivery info (credentials / invite link / license key).
 * - Stock accounts (accountId set): only after the admin confirms the payment receipt.
 * - On-demand / manual (accountId null): available once ACTIVATED.
 * Owner (the employee who made the sale) or admin only.
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
    const endDateStr = formatDate(new Date(rental.endDate));

    // ---------- On-demand / manual (no stock account) ----------
    if (rental.accountId === null || rental.accountId === undefined) {
      if (rental.activationStatus !== "ACTIVATED") {
        return jsonError("⏳ الطلب ما زال بانتظار تفعيل المدير. ستظهر البيانات فور ضغطه «تم التفعيل».", 409);
      }
      const delivery: DeliveryInfo = {
        email: rental.activatedEmail,
        password: decryptText(rental.activatedPassword),
        pin: rental.activatedPin,
        link: rental.activatedLink,
        licenseKey: rental.activatedLicenseKey,
        note: rental.activatedNote,
      };
      const message = buildDeliveryMessage({
        name: cust?.name || "", platform: plat?.name || "", endDate: endDateStr, delivery,
      });
      await audit(user, "ACTIVATION_REVEALED", "rentals", rental.id, `عرض بيانات التسليم — عميل ${cust?.name || ""} — بواسطة ${user.username}`);
      return Response.json({
        ok: true, onDemand: true, deliveryType: "ON_DEMAND",
        delivery, deliveryLines: buildDeliveryLines(delivery), whatsappMessage: message,
        email: delivery.email || "", password: delivery.password || "", profileLabel: "",
        pin: delivery.pin || "", link: delivery.link || "", licenseKey: delivery.licenseKey || "",
        maxUses: null, note: delivery.note || "", accountType: "ON_DEMAND",
        customerName: cust?.name || "", customerPhone: cust?.phone || "", platformName: plat?.name || "",
      });
    }

    // ---------- Stock accounts: delivery depends on the account's delivery type ----------
    const pay = await db.select().from(payments)
      .where(and(eq(payments.rentalId, rentalId), eq(payments.status, "CONFIRMED"))).limit(1);
    if (!pay.length) {
      return jsonError("🔒 البيانات مقفلة — السند ما زال «بانتظار تأكيد المدير». ستظهر بعد تأكيده.", 409);
    }
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
    if (!acc) return jsonError("الحساب غير موجود", 404);
    const prof = rental.profileId ? (await db.select().from(profiles).where(eq(profiles.id, rental.profileId)).limit(1))[0] ?? null : null;

    const dtype: DeliveryType = (acc.deliveryType as DeliveryType) || "CREDENTIALS";
    let delivery: DeliveryInfo;
    let profileLabel = "";
    if (dtype === "INVITE_LINK") {
      delivery = { link: acc.inviteLink, maxUses: acc.inviteMaxUses };
    } else if (dtype === "LICENSE_KEY") {
      delivery = { licenseKey: acc.licenseKey };
    } else {
      const password = decryptText(acc.passwordEncrypted);
      profileLabel = prof ? `بروفايل ${prof.profileNo}${prof.pin ? ` — PIN: ${prof.pin}` : ""}` : (acc.pin ? `PIN: ${acc.pin}` : "حساب كامل");
      delivery = { email: acc.email, password, pin: prof?.pin || acc.pin, profile: profileLabel };
    }

    const message = buildDeliveryMessage({
      name: cust?.name || "", platform: plat?.name || "", endDate: endDateStr, delivery,
    });

    await audit(user, "PASSWORD_REVEALED", "accounts", acc.id, `عرض بيانات التسليم (${dtype}) — عميل ${cust?.name || ""} — بواسطة ${user.username}`);

    return Response.json({
      ok: true, deliveryType: dtype,
      delivery, deliveryLines: buildDeliveryLines(delivery), whatsappMessage: message,
      email: delivery.email || "", password: delivery.password || "", profileLabel,
      pin: delivery.pin || "", link: delivery.link || "", licenseKey: delivery.licenseKey || "",
      maxUses: delivery.maxUses ?? null, note: "",
      accountType: acc.type, customerName: cust?.name || "", customerPhone: cust?.phone || "", platformName: plat?.name || "",
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return jsonError("حدث خطأ", 500);
  }
}
