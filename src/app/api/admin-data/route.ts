import { db } from "@/db";
import { accounts, rentals, payments, customers, platforms, users, auditLogs, whatsappLogs, settings, paymentMethods, walletBalances } from "@/db/schema";
import { and, count, desc, eq, notInArray } from "drizzle-orm";
import { requireAdmin, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";
import { getLastTelegramBackupAt } from "@/lib/backup";
import { resolveTelegramArchiveConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    await requireAdmin();
    const view = new URL(req.url).searchParams.get("view") || "dashboard";

    if (view === "badge") {
      const [[pAct], [pPay], [nPw], [ended]] = await Promise.all([
        db.select({ c: count() }).from(rentals).where(
          and(eq(rentals.activationStatus, "PENDING"), notInArray(rentals.status, ["REJECTED", "CLOSED"]))
        ),
        db.select({ c: count() }).from(payments).where(eq(payments.status, "PENDING")),
        db.select({ c: count() }).from(accounts).where(
          and(eq(accounts.isDeleted, false), eq(accounts.status, "NEEDS_PASSWORD_CHANGE"))
        ),
        db.select({ c: count() }).from(rentals).where(eq(rentals.status, "ENDED")),
      ]);
      const pendingActivations = Number(pAct?.c || 0);
      const pendingPayments = Number(pPay?.c || 0);
      const needsPasswordChange = Number(nPw?.c || 0);
      const endedRentals = Number(ended?.c || 0);
      const inboxCount = pendingActivations + pendingPayments + needsPasswordChange + endedRentals;
      return Response.json({
        inboxCount,
        pendingActivations,
        pendingPayments,
        needsPasswordChange,
        endedRentals,
      });
    }

    if (view === "dashboard") {
      const [job, accs, allRentals, pays, [custCountRow], allUsers] = await Promise.all([
        runDailyJob({ sendAlerts: false }),
        db.select({
          id: accounts.id,
          status: accounts.status,
          expiryDate: accounts.expiryDate,
        }).from(accounts).where(eq(accounts.isDeleted, false)),
        db.select({
          id: rentals.id,
          status: rentals.status,
          isLifetime: rentals.isLifetime,
          endDate: rentals.endDate,
          createdAt: rentals.createdAt,
          createdBy: rentals.createdBy,
          activationStatus: rentals.activationStatus,
        }).from(rentals),
        db.select({
          id: payments.id,
          rentalId: payments.rentalId,
          amount: payments.amount,
          status: payments.status,
          createdAt: payments.createdAt,
          createdBy: payments.createdBy,
          paymentMethodId: payments.paymentMethodId,
          transactionRef: payments.transactionRef,
        }).from(payments),
        db.select({ c: count() }).from(customers),
        db.select({
          id: users.id,
          name: users.displayName,
          username: users.username,
          role: users.role,
        }).from(users),
      ]);

      const now = Date.now();
      const todayStr = new Date().toDateString();
      const isToday = (d: Date | string) => new Date(d).toDateString() === todayStr;

      let revenueConfirmed = 0;
      let revenuePending = 0;
      let pendingPaymentsCount = 0;
      let todayWalletTotal = 0;
      let todayReceiptTotal = 0;

      const isWalletPay = (p: { transactionRef: string | null; paymentMethodId: number | null }) =>
        Boolean(p.transactionRef?.startsWith("WALLET-") || !p.paymentMethodId);

      const todayPayments: typeof pays = [];
      for (const p of pays) {
        const amt = p.amount || 0;
        if (p.status === "CONFIRMED") revenueConfirmed += amt;
        else if (p.status === "PENDING") {
          revenuePending += amt;
          pendingPaymentsCount++;
        }
        if (p.status !== "REJECTED" && isToday(p.createdAt)) {
          todayPayments.push(p);
          if (isWalletPay(p)) todayWalletTotal += amt;
          else todayReceiptTotal += amt;
        }
      }
      const todayTotalAmount = todayWalletTotal + todayReceiptTotal;

      let accountsAvailable = 0;
      let accountsRented = 0;
      let needsPasswordCount = 0;
      let accountsExpiringSoon = 0;
      for (const a of accs) {
        if (a.status === "AVAILABLE") accountsAvailable++;
        else if (a.status === "RENTED") accountsRented++;
        else if (a.status === "NEEDS_PASSWORD_CHANGE") needsPasswordCount++;
        if (a.expiryDate) {
          const diff = new Date(a.expiryDate).getTime() - now;
          if (diff > 0 && diff < 30 * 86400000) accountsExpiringSoon++;
        }
      }

      let activeRentals = 0;
      let completedDigitalSales = 0;
      let endedRentalsCount = 0;
      let endingIn2Days = 0;
      let pendingActivations = 0;
      const todayRentals: typeof allRentals = [];
      const rentalOwnerMap = new Map<number, number>();

      for (const r of allRentals) {
        rentalOwnerMap.set(r.id, r.createdBy);
        if (r.status === "ACTIVE" && !r.isLifetime) {
          activeRentals++;
          const diff = new Date(r.endDate).getTime() - now;
          if (diff >= 0 && diff <= 2 * 86400000) endingIn2Days++;
        }
        if (r.status === "COMPLETED" || r.isLifetime) completedDigitalSales++;
        if (r.status === "ENDED") endedRentalsCount++;
        if (r.activationStatus === "PENDING" && r.status !== "REJECTED" && r.status !== "CLOSED") pendingActivations++;
        if (isToday(r.createdAt)) todayRentals.push(r);
      }

      const actionableInboxCount = pendingActivations + pendingPaymentsCount + needsPasswordCount + endedRentalsCount;

      const salesCountByUser = new Map<number, number>();
      for (const r of todayRentals) {
        salesCountByUser.set(r.createdBy, (salesCountByUser.get(r.createdBy) || 0) + 1);
      }
      const walletByUser = new Map<number, number>();
      const receiptByUser = new Map<number, number>();
      for (const p of todayPayments) {
        const uid = p.createdBy ?? rentalOwnerMap.get(p.rentalId);
        if (!uid) continue;
        const amt = p.amount || 0;
        if (isWalletPay(p)) walletByUser.set(uid, (walletByUser.get(uid) || 0) + amt);
        else receiptByUser.set(uid, (receiptByUser.get(uid) || 0) + amt);
      }

      const staffReconciliation = allUsers.map((u) => {
        const salesCount = salesCountByUser.get(u.id) || 0;
        const walletAmount = walletByUser.get(u.id) || 0;
        const receiptAmount = receiptByUser.get(u.id) || 0;
        return {
          userId: u.id,
          name: u.name,
          username: u.username,
          role: u.role,
          salesCount,
          walletAmount,
          receiptAmount,
          totalAmount: walletAmount + receiptAmount,
        };
      }).filter((s) => s.salesCount > 0 || s.totalAmount > 0 || s.role === "STAFF" || s.role === "EMPLOYEE");

      return Response.json({
        job,
        stats: {
          accountsTotal: accs.length,
          accountsAvailable,
          accountsRented,
          needsPasswordChange: needsPasswordCount,
          accountsExpiringSoon,
          activeRentals,
          completedDigitalSales,
          endedRentals: endedRentalsCount,
          endingIn2Days,
          pendingPayments: pendingPaymentsCount,
          pendingActivations,
          inboxCount: actionableInboxCount,
          actionableTotal: actionableInboxCount,
          revenueConfirmed,
          revenuePending,
          customers: Number(custCountRow?.c || 0),
          todaySales: todayRentals.length,
        },
        dailyReconciliation: {
          todayWalletTotal,
          todayReceiptTotal,
          todayTotalAmount,
          todaySalesCount: todayRentals.length,
          staffReconciliation,
        },
      });
    }

    if (view === "customers") {
      const [custs, rel, pays, logs] = await Promise.all([
        db.select().from(customers).orderBy(desc(customers.createdAt)),
        db.select({
          id: rentals.id,
          customerId: rentals.customerId,
          status: rentals.status,
          rentalType: rentals.rentalType,
          startDate: rentals.startDate,
          endDate: rentals.endDate,
          durationDays: rentals.durationDays,
          isLifetime: rentals.isLifetime,
          platformName: platforms.name,
          accountEmail: accounts.email,
          whatsappAlertSent: rentals.whatsappAlertSent,
          activationStatus: rentals.activationStatus,
        }).from(rentals)
          .innerJoin(platforms, eq(rentals.platformId, platforms.id))
          .leftJoin(accounts, eq(rentals.accountId, accounts.id))
          .orderBy(desc(rentals.createdAt)),
        db.select({
          rentalId: payments.rentalId,
          amount: payments.amount,
          status: payments.status,
        }).from(payments),
        db.select().from(whatsappLogs).orderBy(desc(whatsappLogs.createdAt)).limit(300),
      ]);

      const rentalsByCust = new Map<number, typeof rel>();
      const rentalToCust = new Map<number, number>();
      for (const r of rel) {
        rentalToCust.set(r.id, r.customerId);
        const list = rentalsByCust.get(r.customerId);
        if (list) list.push(r);
        else rentalsByCust.set(r.customerId, [r]);
      }

      const paidByCust = new Map<number, number>();
      for (const p of pays) {
        if (p.status === "REJECTED") continue;
        const cid = rentalToCust.get(p.rentalId);
        if (cid !== undefined) {
          paidByCust.set(cid, (paidByCust.get(cid) || 0) + (p.amount || 0));
        }
      }

      const waByCust = new Map<number, typeof logs>();
      for (const l of logs) {
        if (!l.customerId) continue;
        const list = waByCust.get(l.customerId);
        if (list) list.push(l);
        else waByCust.set(l.customerId, [l]);
      }

      return Response.json({
        customers: custs.map((c) => ({
          ...c,
          rentals: rentalsByCust.get(c.id) || [],
          totalPaid: paidByCust.get(c.id) || 0,
          whatsapp: waByCust.get(c.id) || [],
        })),
      });
    }

    if (view === "audit") {
      const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(300);
      return Response.json({ audit: rows });
    }

    if (view === "settings") {
      const [rows, allUsers, balances, plats, banks, logs, lastTelegramBackupAt, tgCfg] = await Promise.all([
        db.select({ key: settings.key, value: settings.value }).from(settings),
        db.select({
          id: users.id,
          username: users.username,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          permissions: users.permissions,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        }).from(users).orderBy(users.id),
        db.select({ userId: walletBalances.userId, balance: walletBalances.balance }).from(walletBalances),
        db.select().from(platforms).orderBy(platforms.id),
        db.select().from(paymentMethods).orderBy(paymentMethods.id),
        db.select().from(whatsappLogs).orderBy(desc(whatsappLogs.createdAt)).limit(100),
        getLastTelegramBackupAt(),
        resolveTelegramArchiveConfig(),
      ]);

      const balanceMap = new Map(balances.map((b) => [b.userId, b.balance]));
      const enrichedUsers = allUsers.map((u) => ({
        ...u,
        walletBalance: balanceMap.get(u.id) ?? 0,
      }));
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return Response.json({
        settings: map,
        users: enrichedUsers,
        platforms: plats,
        paymentMethods: banks,
        whatsappLogs: logs,
        backupStatus: {
          lastTelegramBackupAt,
          telegramConfigured: Boolean(tgCfg.token && tgCfg.archiveChatId),
        },
      });
    }

    return jsonError("عرض غير معروف");
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/admin-data] failed:", e instanceof Error ? e.message : e);
    return jsonError("خطأ في الخادم", 500);
  }
}
