import { db } from "@/db";
import { accounts, rentals, payments, customers, platforms, users, auditLogs, whatsappLogs, settings, paymentMethods } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAdmin, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    await requireAdmin();
    const view = new URL(req.url).searchParams.get("view") || "dashboard";

    if (view === "dashboard") {
      const job = await runDailyJob({ sendAlerts: false });
      const accs = await db.select().from(accounts).where(eq(accounts.isDeleted, false));
      const allRentals = await db.select().from(rentals);
      const pays = await db.select().from(payments);
      const custs = await db.select({ id: customers.id }).from(customers);
      const now = Date.now();
      const revenueConfirmed = pays.filter((p) => p.status === "CONFIRMED").reduce((s, p) => s + (p.amount || 0), 0);
      const revenuePending = pays.filter((p) => p.status === "PENDING").reduce((s, p) => s + (p.amount || 0), 0);
      const todaySales = allRentals.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
      return Response.json({
        job,
        stats: {
          accountsTotal: accs.length,
          accountsAvailable: accs.filter((a) => a.status === "AVAILABLE").length,
          accountsRented: accs.filter((a) => a.status === "RENTED").length,
          needsPasswordChange: accs.filter((a) => a.status === "NEEDS_PASSWORD_CHANGE").length,
          accountsExpiringSoon: accs.filter((a) => a.expiryDate && new Date(a.expiryDate).getTime() - now < 30 * 86400000 && new Date(a.expiryDate).getTime() > now).length,
          activeRentals: allRentals.filter((r) => r.status === "ACTIVE").length,
          endedRentals: allRentals.filter((r) => r.status === "ENDED").length,
          endingIn2Days: allRentals.filter((r) => r.status === "ACTIVE" && new Date(r.endDate).getTime() - now <= 2 * 86400000 && new Date(r.endDate).getTime() >= now).length,
          pendingPayments: pays.filter((p) => p.status === "PENDING").length,
          revenueConfirmed, revenuePending, customers: custs.length, todaySales,
        },
      });
    }

    if (view === "customers") {
      const custs = await db.select().from(customers).orderBy(desc(customers.createdAt));
      const rel = await db.select({
        id: rentals.id, customerId: rentals.customerId, status: rentals.status, rentalType: rentals.rentalType,
        startDate: rentals.startDate, endDate: rentals.endDate, durationDays: rentals.durationDays,
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
      const rows = await db.select().from(settings);
      const allUsers = await db.select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users).orderBy(users.id);
      const plats = await db.select().from(platforms).orderBy(platforms.id);
      const banks = await db.select().from(paymentMethods).orderBy(paymentMethods.id);
      const logs = await db.select().from(whatsappLogs).orderBy(desc(whatsappLogs.createdAt)).limit(100);
      const map: Record<string, string> = {}; rows.forEach((r) => (map[r.key] = r.value));
      return Response.json({ settings: map, users: allUsers, platforms: plats, paymentMethods: banks, whatsappLogs: logs });
    }

    return jsonError("عرض غير معروف");
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}
