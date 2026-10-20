import { db } from "@/db";
import { accounts, profiles, platforms, rentals, customers } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAdmin, audit, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { encryptText } from "@/lib/crypto";
import { refreshAccountStatus, runDailyJob } from "@/lib/engine";
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
      email: accounts.email, pin: accounts.pin, expiryDate: accounts.expiryDate, status: accounts.status,
      notes: accounts.notes, isDeleted: accounts.isDeleted, deletedAt: accounts.deletedAt, deletedReason: accounts.deletedReason,
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
    const platformId = Number(b.platformId); const type = b.type === "PROFILE" ? "PROFILE" : "FULL";
    const maxProfiles = type === "PROFILE" ? Math.min(10, Math.max(2, Number(b.maxProfiles || 5))) : 1;
    const email = String(b.email || "").trim(); const password = String(b.password || "");
    const expiryDate = new Date(String(b.expiryDate || ""));
    if (!platformId || !email || !password || isNaN(expiryDate.getTime())) return jsonError("المنصة والإيميل وكلمة المرور وتاريخ انتهاء الحساب إلزامية");
    const [acc] = await db.insert(accounts).values({
      platformId, type, maxProfiles, email, passwordEncrypted: encryptText(password),
      pin: String(b.pin || "") || null, expiryDate, notes: String(b.notes || "") || null,
      salePrice: b.salePrice ? Number(b.salePrice) : null, status: "AVAILABLE",
    }).returning();
    if (type === "PROFILE") {
      await db.insert(profiles).values(Array.from({ length: maxProfiles }, (_, i) => ({
        accountId: acc.id, profileNo: i + 1, profileName: `بروفايل ${i + 1}`, pin: `${1000 + i + 1}`,
      })));
    }
    const [plat] = await db.select({ name: platforms.name }).from(platforms).where(eq(platforms.id, platformId)).limit(1);
    await notifyAdmin({
      title: "إضافة حساب",
      body: `تم إضافة حساب ${plat?.name || "جديد"}`,
      kind: "ADDITION",
      href: "/accounts",
    });
    await audit(user, "ACCOUNT_CREATED", "accounts", acc.id, `إضافة حساب ${email} (${type})`);
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
    if (b.email) patch.email = String(b.email).trim();
    if (b.password) patch.passwordEncrypted = encryptText(String(b.password));
    if (b.pin !== undefined) patch.pin = String(b.pin || "") || null;
    if (b.expiryDate !== undefined) patch.expiryDate = b.expiryDate ? new Date(String(b.expiryDate)) : null;
    if (b.notes !== undefined) patch.notes = String(b.notes || "") || null;
    if (b.salePrice !== undefined) patch.salePrice = b.salePrice ? Number(b.salePrice) : null;
    if (b.platformId) patch.platformId = Number(b.platformId);
    await db.update(accounts).set(patch).where(eq(accounts.id, id));
    await refreshAccountStatus(id);
    await audit(user, "ACCOUNT_UPDATED", "accounts", id, `تعديل حساب ${acc.email}${b.password ? " (مع كلمة المرور)" : ""}`);
    return Response.json({ ok: true });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}
