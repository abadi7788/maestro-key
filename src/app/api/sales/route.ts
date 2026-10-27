import { db } from "@/db";
import { accounts, profiles, rentals, platforms, customers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { decryptText } from "@/lib/crypto";
import { formatDate } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const rentalId = Number(new URL(req.url).searchParams.get("rentalId"));
    if (!rentalId) return jsonError("رقم الاشتراك مطلوب", 400);

    const [rental] = await db
      .select({
        id: rentals.id,
        accountId: rentals.accountId,
        profileId: rentals.profileId,
        startDate: rentals.startDate,
        endDate: rentals.endDate,
        durationDays: rentals.durationDays,
        isLifetime: rentals.isLifetime,
        status: rentals.status,
        deliverySource: rentals.deliverySource,
        manualEmail: rentals.manualEmail,
        manualPasswordEncrypted: rentals.manualPasswordEncrypted,
        manualLink: rentals.manualLink,
        manualCodeEncrypted: rentals.manualCodeEncrypted,
        manualNote: rentals.manualNote,
        platformName: platforms.name,
        customerName: customers.name,
        customerPhone: customers.phone,
      })
      .from(rentals)
      .innerJoin(platforms, eq(rentals.platformId, platforms.id))
      .innerJoin(customers, eq(rentals.customerId, customers.id))
      .where(eq(rentals.id, rentalId))
      .limit(1);

    if (!rental) return jsonError("الاشتراك غير موجود", 404);

    let email = rental.manualEmail || "";
    let password = rental.manualPasswordEncrypted ? decryptText(rental.manualPasswordEncrypted) : "";
    let link = rental.manualLink || "";
    let code = rental.manualCodeEncrypted ? decryptText(rental.manualCodeEncrypted) : "";
    let note = rental.manualNote || "";
    let isProfile = false;
    let profileName = "";
    let profilePin = "";

    if (rental.accountId) {
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, rental.accountId)).limit(1);
      if (acc) {
        email = acc.email || "";
        password = acc.passwordEncrypted ? decryptText(acc.passwordEncrypted) : "";
        link = acc.inviteLink || "";
        code = acc.licenseKeyEncrypted ? decryptText(acc.licenseKeyEncrypted) : "";
        note = acc.notes || "";
        isProfile = acc.type === "PROFILE";

        if (isProfile && rental.profileId) {
          const [prof] = await db.select().from(profiles).where(eq(profiles.id, rental.profileId)).limit(1);
          if (prof) {
            profileName = prof.profileName || `بروفايل ${prof.profileNo}`;
            profilePin = prof.pin || "";
          }
        }
      }
    }

    const lines = [
      `✨ *تفاصيل اشتراكك في ${rental.platformName}* ✨`,
      email ? `📧 *البريد الإلكتروني:* ${email}` : null,
      password ? `🔑 *كلمة المرور:* ${password}` : null,
      isProfile && profileName ? `👤 *اسم البروفايل:* ${profileName}` : null,
      isProfile && profilePin ? `🔒 *رمز القفل (PIN):* ${profilePin}` : null,
      link ? `🔗 *رابط التفعيل:* ${link}` : null,
      code ? `🎟️ *كود الترخيص:* ${code}` : null,
      `⏳ *المدة:* ${rental.isLifetime ? "دائم ♾️" : `${rental.durationDays} يوم`}`,
      `📅 *تاريخ الانتهاء:* ${rental.isLifetime ? "دائم ♾️" : formatDate(rental.endDate)}`,
      note ? `📝 *ملاحظات:* ${note}` : null,
    ].filter(Boolean).join("\n");

    return Response.json({
      ok: true,
      credentials: {
        email,
        password,
        link,
        code,
        isProfile,
        profileName,
        profilePin,
      },
      formattedMessage: lines,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError("خطأ في الخادم", 500);
  }
}