import { db } from "@/db";
import { accounts, profiles, platforms, rentals, customers } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
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
      .where(eq(accounts.isDeleted, trash)).orderBy(desc(accounts.createdAt));

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
    const expiryMode = b.expiryMode || (b.noExpiry ? "LIFETIME" : "DATE");
    let expiryDate: Date | null = null;
    if (expiryMode === "DATE") {
      const expiryRaw = String(b.expiryDate || "").trim();
      expiryDate = expiryRaw ? new Date(expiryRaw) : null;
      if (expiryRaw && (!expiryDate || isNaN(expiryDate.getTime()))) return jsonError("تاريخ الانتهاء غير صالح — اختر بدون انتهاء للاشتراك الدائم");
    }

    if (deliveryKind === "INVITE_LINK") {
      if (!inviteLink) return jsonError("أدخل رابط الدعوة / التفعيل");
    } else if (deliveryKind === "LICENSE_KEY") {
      if (!licenseKey) return jsonError("أدخل الكود / المفتاح الرقمي");
    } else {
      if (!email && !password && !inviteLink && !licenseKey) return jsonError("أدخل أي بيانات تسليم (إيميل أو كلمة مرور أو رابط أو كود)");
    }

    const type = deliveryKind === "CREDENTIALS" && b.type === "PROFILE" ? "PROFILE" : "FULL";

    // إذا كان حساب كامل يتم إلغاء الـ PIN نهائياً
    const pin = type === "FULL" ? null : (String(b.pin || "").trim() || null);

    // حساب عدد البروفايلات بناءً على القائمة المرسلة إن وجدت
    const customProfiles: Array<{ name: string; pin: string }> = Array.isArray(b.profilesList) && b.profilesList.length > 0 ? b.profilesList : [];
    
    const maxProfiles = type === "PROFILE"
      ? (customProfiles.length > 0 ? customProfiles.length : (b.maxProfiles === "" || b.maxProfiles === null || b.maxProfiles === undefined ? 5 : Math.min(10, Math.max(1, Number(b.maxProfiles)))))
      : 1;

    const [acc] = await db.insert(accounts).values({
      platformId, 
      type, 
      maxProfiles,
      deliveryKind,
      email, 
      passwordEncrypted: password ? encryptText(password) : null,
      inviteLink: deliveryKind === "INVITE_LINK" ? inviteLink : (inviteLink || null),
      licenseKeyEncrypted: licenseKey ? encryptText(licenseKey) : null,
      maxUses: deliveryKind === "INVITE_LINK" ? maxUses : null,
      usedCount: 0,
      pin: deliveryKind === "CREDENTIALS" ? pin : null,
      expiryDate, 
      notes,
      salePrice: salePrice && Number.isFinite(salePrice) ? salePrice : null,
      status: "AVAILABLE",
    }).returning();

    // إدراج البروفايلات ديناميكياً مع أسماء و PIN محدد لكل بروفايل
    if (type === "PROFILE") {
      if (customProfiles.length > 0) {
        await db.insert(profiles).values(customProfiles.map((p, i) => ({
          accountId: acc.id,
          profileNo: i + 1,
          profileName: String(p.name || `بروفايل ${i + 1}`).trim(),
          pin: String(p.pin || "").trim() || null,
        })));
      } else {
        await db.insert(profiles).values(Array.from({ length: maxProfiles }, (_, i) => ({
          accountId: acc.id, 
          profileNo: i + 1, 
          profileName: `بروفايل ${i + 1}`, 
          pin: null,
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
    if (b.pin !== undefined) patch.pin = acc.type === "FULL" ? null : (String(b.pin || "").trim() || null);
    if (b.expiryMode !== undefined || b.expiryDate !== undefined || b.noExpiry !== undefined) {
      const mode = b.expiryMode || (b.noExpiry ? "LIFETIME" : (b.expiryDate ? "DATE" : "LIFETIME"));
      if (mode === "DATE" && b.expiryDate) {
        patch.expiryDate = new Date(String(b.expiryDate));
      } else {
        patch.expiryDate = null;
      }
    }
    if (b.notes !== undefined) patch.notes = String(b.notes || "") || null;
    if (b.salePrice !== undefined) patch.salePrice = b.salePrice ? Number(b.salePrice) : null;
    if (b.platformId) patch.platformId = Number(b.platformId);
    await db.update(accounts).set(patch).where(eq(accounts.id, id));

    // تحديث أسماء و PIN البروفايلات الخاصة بالحساب في قاعدة البيانات
    if (Array.isArray(b.profilesList) && acc.type === "PROFILE") {
      for (let i = 0; i < b.profilesList.length; i++) {
        const prof = b.profilesList[i];
        const pPin = prof.pin !== undefined ? (String(prof.pin || "").trim() || null) : undefined;
        const pName = prof.name ? String(prof.name).trim() : `بروفايل ${i + 1}`;
        if (prof.id) {
          await db.update(profiles).set({
            pin: pPin,
            profileName: pName,
          }).where(and(eq(profiles.id, Number(prof.id)), eq(profiles.accountId, id)));
        } else {
          const pNo = prof.profileNo ? Number(prof.profileNo) : (i + 1);
          const [existing] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.accountId, id), eq(profiles.profileNo, pNo))).limit(1);
          if (existing) {
            await db.update(profiles).set({
              pin: pPin,
              profileName: pName,
            }).where(eq(profiles.id, existing.id));
          } else {
            await db.insert(profiles).values({
              accountId: id,
              profileNo: pNo,
              profileName: pName,
              pin: pPin ?? null,
              status: "AVAILABLE",
            });
          }
        }
      }
    }

    await refreshAccountStatus(id);
    await audit(user, "ACCOUNT_UPDATED", "accounts", id, `تعديل حساب ${acc.email || `#${id}`}${b.password ? " (مع كلمة المرور)" : ""}${Array.isArray(b.profilesList) ? " (تحديث البروفايلات والـ PIN)" : ""}`);
    return Response.json({ ok: true });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}
