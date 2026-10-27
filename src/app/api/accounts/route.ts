import { db } from "@/db";
import { accounts, profiles, platforms, rentals, customers } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { encryptText } from "@/lib/crypto";
import { refreshAccountStatus, runDailyJob } from "@/lib/engine";
import { normalizeAccountDelivery, ACCOUNT_DELIVERY_LABELS } from "@/lib/delivery";
import { notifyAdmin } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    await requireAdmin();
    await runDailyJob({ sendAlerts: false });
    const trash = new URL(req.url).searchParams.get("trash") === "1";

    // قراءة الحسابات مع مطابقة حالة الأحرف بشكل غير حساس لضمان ظهور الـ 27 حساباً
    const rows = await db.select({
      id: accounts.id, platformId: accounts.platformId, type: accounts.type, maxProfiles: accounts.maxProfiles,
      deliveryKind: accounts.deliveryKind,
      email: accounts.email, pin: accounts.pin, expiryDate: accounts.expiryDate, status: accounts.status,
      inviteLink: accounts.inviteLink, maxUses: accounts.maxUses, usedCount: accounts.usedCount,
      hasLicenseKey: accounts.licenseKeyEncrypted,
      notes: accounts.notes, salePrice: accounts.salePrice,
      isDeleted: accounts.isDeleted, deletedAt: accounts.deletedAt, deletedReason: accounts.deletedReason,
      createdAt: accounts.createdAt, platformName: platforms.name, platformColor: platforms.color, platformShort: platforms.shortName, platformImage: platforms.imageUrl,
    }).from(accounts).innerJoin(platforms, eq(accounts.platformId, platforms.id))
      .where(
        and(
          eq(accounts.isDeleted, trash),
          // قراءة الحسابات سواء كانت الحالة مسجلة بحروف كبيرة أو صغيرة
          sql`LOWER(${accounts.status}) IN ('available', 'full', 'rented', 'needs_password_change')`
        )
      ).orderBy(desc(accounts.createdAt));

    const ids = rows.map((r) => r.id);
    const profs = ids.length ? await db.select().from(profiles).where(inArray(profiles.accountId, ids)).orderBy(profiles.profileNo) : [];
    const relRentals = ids.length ? await db.select({
      id: rentals.id, accountId: rentals.accountId, profileId: rentals.profileId, status: rentals.status,
      endDate: rentals.endDate, customerName: customers.name, customerPhone: customers.phone,
    }).from(rentals).innerJoin(customers, eq(rentals.customerId, customers.id))
      .where(and(inArray(rentals.accountId, ids), inArray(rentals.status, ["ACTIVE", "ENDED"]))) : [];
    const allRentalsCount = ids.length ? await db.select({ accountId: rentals.accountId, id: rentals.id }).from(rentals).where(inArray(rentals.accountId, ids)) : [];

    return Response.json({
      accounts: rows.map((r) => ({
        ...r,
        hasLicenseKey: !!r.hasLicenseKey,
        profiles: profs.filter((p) => p.accountId === r.id).map((p) => ({
          ...p, rental: relRentals.find((x) => x.profileId === p.id) || null,
        })),
        currentRentals: relRentals.filter((x) => x.accountId === r.id),
        totalRentals: allRentalsCount.filter((x) => x.accountId === r.id).length,
      })),
    });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const platformId = Number(b.platformId);
    if (!platformId) return jsonError("اختر المنصة أولاً");
    
    const deliveryKind = normalizeAccountDelivery(b.deliveryKind);
    const email = String(b.email || "").trim() || null;
    const password = String(b.password || "");
    const inviteLink = String(b.inviteLink || "").trim() || null;
    const licenseKey = String(b.licenseKey || "").trim();
    const maxUsesRaw = b.maxUses === "" || b.maxUses === null || b.maxUses === undefined ? null : Number(b.maxUses);
    const maxUses = maxUsesRaw === null ? null : (Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : null);
    
    const notes = String(b.notes || "").trim() || null;
    const salePrice = b.salePrice ? Number(b.salePrice) : null;
    const expiryRaw = String(b.expiryDate || "").trim();
    const expiryDate = expiryRaw ? new Date(expiryRaw) : null;
    if (expiryRaw && (!expiryDate || isNaN(expiryDate.getTime()))) return jsonError("تاريخ الانتهاء غير صالح — اتركه فارغاً للاشتراك الدائم");

    if (deliveryKind === "INVITE_LINK") {
      if (!inviteLink) return jsonError("أدخل رابط الدعوة / التفعيل");
    } else if (deliveryKind === "LICENSE_KEY") {
      if (!licenseKey) return jsonError("أدخل الكود / المفتاح الرقمي");
    } else {
      if (!email && !password && !inviteLink && !licenseKey) return jsonError("أدخل أي بيانات تسليم (إيميل أو كلمة مرور أو رابط أو كود)");
    }

    const type = deliveryKind === "CREDENTIALS" && b.type === "PROFILE" ? "PROFILE" : "FULL";
    
    // استخراج مصفوفة البروفايلات المدخلة ديناميكياً
    const incomingProfiles: Array<{ profileName?: string; pin?: string }> = Array.isArray(b.profiles) ? b.profiles : [];
    const maxProfiles = type === "PROFILE"
      ? (incomingProfiles.length > 0 ? incomingProfiles.length : (b.maxProfiles === "" || b.maxProfiles === null || b.maxProfiles === undefined ? 5 : Math.min(10, Math.max(1, Number(b.maxProfiles)))))
      : 1;

    // الحساب الكامل لا يحتاج PIN نهائياً
    const pin = (deliveryKind === "CREDENTIALS" && type === "PROFILE") ? (String(b.pin || "").trim() || null) : null;

    const [acc] = await db.insert(accounts).values({
      platformId, type, maxProfiles,
      deliveryKind,
      email, passwordEncrypted: password ? encryptText(password) : null,
      inviteLink: deliveryKind === "INVITE_LINK" ? inviteLink : (inviteLink || null),
      licenseKeyEncrypted: licenseKey ? encryptText(licenseKey) : null,
      maxUses: deliveryKind === "INVITE_LINK" ? maxUses : null,
      usedCount: 0,
      pin,
      expiryDate, notes,
      salePrice: salePrice && Number.isFinite(salePrice) ? salePrice : null,
      status: "AVAILABLE",
    }).returning();

    // حفظ البروفايلات التابعة بالاسم والـ PIN المخصص
    if (type === "PROFILE") {
      if (incomingProfiles.length > 0) {
        await db.insert(profiles).values(incomingProfiles.map((p, i) => ({
          accountId: acc.id,
          profileNo: i + 1,
          profileName: String(p.profileName || `بروفايل ${i + 1}`).trim(),
          pin: String(p.pin || "").trim() || null,
          status: "AVAILABLE",
          isOccupied: false,
        })));
      } else {
        await db.insert(profiles).values(Array.from({ length: maxProfiles }, (_, i) => ({
          accountId: acc.id, profileNo: i + 1, profileName: `بروفايل ${i + 1}`, pin: null,
          status: "AVAILABLE", isOccupied: false,
        })));
      }
    }

    const [plat] = await db.select({ name: platforms.name }).from(platforms).where(eq(platforms.id, platformId)).limit(1);
    await notifyAdmin({
      title: "إضافة حساب",
      body: `تم إضافة حساب ${plat?.name || "جديد"}`,
      kind: "ADDITION",
      href: "/accounts",
    });
    await audit(user, "ACCOUNT_CREATED", "accounts", acc.id, `إضافة ${ACCOUNT_DELIVERY_LABELS[deliveryKind]} ${email || inviteLink ? `(${email || "رابط"})` : ""} (${type})`);
    return Response.json({ ok: true, id: acc.id });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}

export async function PUT(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const id = Number(b.id);
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!acc) return jsonError("حساب غير موجود", 404);
    const patch: Partial<typeof accounts.$inferInsert> = { updatedAt: new Date() };
    if (b.email !== undefined) patch.email = String(b.email || "").trim() || null;
    if (b.password) patch.passwordEncrypted = encryptText(String(b.password));
    if (b.clearPassword === true) patch.passwordEncrypted = null;
    if (b.inviteLink !== undefined) patch.inviteLink = String(b.inviteLink || "").trim() || null;
    if (b.licenseKey) patch.licenseKeyEncrypted = encryptText(String(b.licenseKey));
    if (b.clearLicenseKey === true) patch.licenseKeyEncrypted = null;
    if (b.maxUses !== undefined) {
      const v = b.maxUses === "" || b.maxUses === null ? null : Number(b.maxUses);
      patch.maxUses = v === null ? null : (Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
    }
    if (b.usedCount !== undefined) patch.usedCount = Math.max(0, Number(b.usedCount) || 0);
    if (b.deliveryKind) patch.deliveryKind = normalizeAccountDelivery(b.deliveryKind);
    if (b.pin !== undefined) patch.pin = String(b.pin || "") || null;
    if (b.expiryDate !== undefined) patch.expiryDate = b.expiryDate ? new Date(String(b.expiryDate)) : null;
    if (b.notes !== undefined) patch.notes = String(b.notes || "") || null;
    if (b.salePrice !== undefined) patch.salePrice = b.salePrice ? Number(b.salePrice) : null;
    if (b.platformId) patch.platformId = Number(b.platformId);
    await db.update(accounts).set(patch).where(eq(accounts.id, id));
    await refreshAccountStatus(id);
    await audit(user, "ACCOUNT_UPDATED", "accounts", id, `تعديل حساب ${acc.email || `#${id}`}${b.password ? " (مع كلمة المرور)" : ""}`);
    return Response.json({ ok: true });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}