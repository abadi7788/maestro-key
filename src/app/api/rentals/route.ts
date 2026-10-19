import { db } from "@/db";
import { rentals, customers, platforms, payments, paymentMethods, users, accounts, profiles } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    await runDailyJob({ sendAlerts: false });
    const sp = new URL(req.url).searchParams;
    const view = sp.get("view") || (user.role === "ADMIN" ? "all" : "mine");
    const status = sp.get("status") || "";
    const paymentStatus = sp.get("paymentStatus") || "";

    const conds = [];
    if (view === "mine") conds.push(eq(rentals.createdBy, user.id));
    if (view === "all" && user.role !== "ADMIN") conds.push(eq(rentals.createdBy, user.id));
    if (status) conds.push(eq(rentals.status, status));

    const rows = await db.select({
      id: rentals.id, accountId: rentals.accountId, profileId: rentals.profileId, customerId: rentals.customerId,
      platformId: rentals.platformId, createdBy: rentals.createdBy, rentalType: rentals.rentalType,
      startDate: rentals.startDate, endDate: rentals.endDate, durationDays: rentals.durationDays,
      status: rentals.status, whatsappAlertSent: rentals.whatsappAlertSent, whatsappAlertSentAt: rentals.whatsappAlertSentAt,
      createdAt: rentals.createdAt,
      customerName: customers.name, customerPhone: customers.phone,
      platformName: platforms.name, platformColor: platforms.color, platformImage: platforms.imageUrl,
      sellerName: users.displayName, accountEmail: accounts.email, accountType: accounts.type,
    }).from(rentals)
      .innerJoin(customers, eq(rentals.customerId, customers.id))
      .innerJoin(platforms, eq(rentals.platformId, platforms.id))
      .innerJoin(users, eq(rentals.createdBy, users.id))
      .innerJoin(accounts, eq(rentals.accountId, accounts.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(rentals.createdAt)).limit(300);

    const rentalIds = rows.map((r) => r.id);
    const pays = rentalIds.length ? await db.select({
      id: payments.id, rentalId: payments.rentalId, transactionRef: payments.transactionRef, amount: payments.amount,
      status: payments.status, isExtension: payments.isExtension, createdAt: payments.createdAt,
      rejectionReason: payments.rejectionReason, bankName: paymentMethods.name,
      hasReceipt: payments.receiptImageData,
    }).from(payments).innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.id))
      .where(inArray(payments.rentalId, rentalIds)).orderBy(desc(payments.createdAt)) : [];

    const profs = await db.select().from(profiles);
    const profMap = new Map(profs.map((p) => [p.id, p]));

    const enriched = rows.map((r) => ({
      ...r,
      // Employees never see account emails in lists (only at moment of sale)
      accountEmail: user.role === "ADMIN" ? r.accountEmail : null,
      profileNo: r.profileId ? profMap.get(r.profileId)?.profileNo ?? null : null,
      payments: pays.filter((p) => p.rentalId === r.id).map((p) => ({ ...p, hasReceipt: !!p.hasReceipt })),
    })).filter((r) => !paymentStatus || r.payments.some((p) => p.status === paymentStatus));

    if (view === "due") {
      const now = Date.now();
      const threeDays = now + 3 * 86400000;
      const due = enriched.filter((r) =>
        (r.status === "ACTIVE" && new Date(r.endDate).getTime() <= threeDays) || r.status === "ENDED");
      return Response.json({ rentals: due });
    }
    return Response.json({ rentals: enriched });
  } catch (e) { if (e instanceof Response) return e; return jsonError("خطأ في الخادم", 500); }
}
