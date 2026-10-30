import { db } from "@/db";
import { accounts, rentals, payments, customers, platforms, users, auditLogs, whatsappLogs, settings, paymentMethods, walletBalances } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdmin, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";
import { getEffectivePermissions } from "@/lib/permissions";
import { normalizeDeliveryMode } from "@/lib/delivery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    await requireAdmin();
    const view = new URL(req.url).searchParams.get("view") || "dashboard";

    if (view === "dashboard") {
      const job = await runDailyJob({ sendAlerts: false });
      const [accs, allRentals, pays, custs, plats, wals, profCounts] = await Promise.all([
        db.select().from(accounts).where(eq(accounts.isDeleted, false)),
        db.select().from(rentals),
        db.select().from(payments),
        db.select({ id: customers.id }).from(customers),
        db.select().from(platforms).where(eq(platforms.isActive, true)),
        db.select().from(walletBalances),
        db.execute(sql`SELECT account_id, count(*)::int AS cnt FROM profiles WHERE status = 'AVAILABLE' GROUP BY account_id`),
      ]);

      const availProfMap = new Map<number, number>();
      for (const r of profCounts.rows as Array<{ account_id: number; cnt: number }>) {
        availProfMap.set(Number(r.account_id), Number(r.cnt));
      }

      const now = Date.now();
      const slotsByPlatform = new Map<number, number>();
      for (const a of accs) {
        if (a.status === "NEEDS_PASSWORD_CHANGE") continue;
        if (a.expiryDate && new Date(a.expiryDate).getTime() <= now) continue;
        if (a.maxUses != null && (a.usedCount ?? 0) >= a.maxUses) continue;
        const slots = a.type === "FULL" ? (a.status === "AVAILABLE" ? 1 : 0) : (availProfMap.get(a.id) ?? 0);
        slotsByPlatform.set(a.platformId, (slotsByPlatform.get(a.platformId) ?? 0) + slots);
      }

      const lowStockPlatforms = plats
        .filter((p) => normalizeDeliveryMode(p.deliveryMode) === "INSTANT_INVENTORY")
        .map((p) => ({
          id: p.id,
          name: p.name,
          slots: slotsByPlatform.get(p.id) ?? 0,
          threshold: p.lowStockThreshold ?? 3,
        }))
        .filter((p) => p.slots <= p.threshold);

      const revenueConfirmed = pays.filter((p) => p.status === "CONFIRMED").reduce((s, p) => s + (p.amount || 0), 0);
      const revenuePending = pays.filter((p) => p.status === "PENDING").reduce((s, p) => s + (p.amount || 0), 0);
      const walletTotalBalance = wals.reduce((s, w) => s + (w.balance || 0), 0);
      const todaySales = allRentals.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
      const pendingActivations = allRentals.filter((r) => r.activationStatus === "PENDING" && r.status !== "REJECTED" && r.status !== "CLOSED").length;

      return Response.json({
        job,
        lowStockPlatforms,
        stats: {
          accountsTotal: accs.length,
          accountsAvailable: accs.filter((a) => a.status === "AVAILABLE").length,
          accountsRented: accs.filter((a) => a.status === "RENTED").length,
          needsPasswordChange: accs.filter((a) => a.status === "NEEDS_PASSWORD_CHANGE").length,
          accountsExpiringSoon: accs.filter((a) => a.expiryDate && new Date(a.expiryDate).getTime() - now < 30 * 86400000 && new Date(a.expiryDate).getTime() > now).length,
          activeRentals: allRentals.filter((r) => r.status === "ACTIVE").length,
          endedRentals: allRentals.filter((r) => r.status === "ENDED").length,
          endingIn2Days: allRentals.filter((r) => !r.isLifetime && r.status === "ACTIVE" && new Date(r.endDate).getTime() - now <= 2 * 86400000 && new Date(r.endDate).getTime() >= now).length,
          pendingPayments: pays.filter((p) => p.status === "PENDING").length,
          pendingActivations,
          walletTotalBalance,
          revenueConfirmed, revenuePending, customers: custs.length, todaySales,
        },
      });
    }

    if (view === "customers") {
      const custs = await db.select().from(customers).orderBy(desc(customers.createdAt));
      const rel = await db.select({
        id: rentals.id, customerId: rentals.customerId, status: rentals.status, rentalType: rentals.rentalType,
        startDate: rentals.startDate, endDate: rentals.endDate, durationDays: rentals.durationDays,
        isLifetime: rentals.isLifetime,
        platformName: platforms.name, accountEmail: accounts.email, whatsappAlertSent: rentals.whatsappAlertSent,
        activationStatus: rentals.activationStatus,
      }).from(rentals).innerJoin(platforms, eq(rentals.platformId, platforms.id))
        .leftJoin(accounts, eq(rentals.accountId, accounts.id)).orderBy(desc(rentals.createdAt));
      const pays = await db.select({ rentalId: payments.rentalId, amount: payments.amount, status: payments.status }).from(payments);
      const logs = await db.select().from(whatsappLogs).orderBy(desc(whatsappLogs.createdAt)).limit(300);
      return Response.json({
        customers: custs.map((c) => ({
          ...c,
          rentals: rel.filter((r) => r.customerId === c.id),
          totalPaid: pays.filter((p) => p.status !== "REJECTED" && rel.some((r) => r.customerId === c.id && r.id === p.rentalId)).reduce((s, p) => s + (p.amount || 0), 0),
          whatsapp: logs.filter((l) => l.customerId === c.id),
        })),
      });
    }

    if (view === "audit") {
      const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(300);
      return Response.json({ audit: rows });
    }

    if (view === "settings") {
      const [rows, allUsers, wals, plats, banks, logs] = await Promise.all([
        db.select().from(settings),
        db.select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          isActive: users.isActive,
          failedAttempts: users.failedAttempts,
          lockedUntil: users.lockedUntil,
          lastLoginAt: users.lastLoginAt,
          permissions: users.permissions,
          legacyWalletBalance: users.walletBalance,
          createdAt: users.createdAt,
        }).from(users).orderBy(users.id),
        db.select().from(walletBalances),
        db.select().from(platforms).orderBy(platforms.id),
        db.select().from(paymentMethods).orderBy(paymentMethods.id),
        db.select().from(whatsappLogs).orderBy(desc(whatsappLogs.createdAt)).limit(100),
      ]);

      const walMap = new Map(wals.map((w) => [w.userId, w.balance]));
      const map: Record<string, string> = {};
      rows.forEach((r) => (map[r.key] = r.value));

      const enrichedUsers = allUsers.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        failedAttempts: u.failedAttempts,
        lockedUntil: u.lockedUntil,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        walletBalance: walMap.has(u.id)
          ? (walMap.get(u.id) ?? 0)
          : Math.max(0, Math.floor(Number(u.legacyWalletBalance || 0))),
        permissions: getEffectivePermissions(u),
      }));

      return Response.json({ settings: map, users: enrichedUsers, platforms: plats, paymentMethods: banks, whatsappLogs: logs });
    }

    return jsonError("عرض غير معروف");
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/admin-data] failed:", e instanceof Error ? e.message : e);
    return jsonError("خطأ في الخادم", 500);
  }
}
