import { db } from "@/db";
import { rentals, customers, platforms, payments, paymentMethods, users, accounts, profiles } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const view = sp.get("view") || (isAdminRole(user.role) ? "all" : "mine");
    const status = sp.get("status") || "";
    const paymentStatus = sp.get("paymentStatus") || "";

    const conds = [];
    if (view === "mine") conds.push(eq(rentals.createdBy, user.id));
    if (view === "all" && !isAdminRole(user.role)) conds.push(eq(rentals.createdBy, user.id));
    if (status) conds.push(eq(rentals.status, status));

    const [, rows, plats] = await Promise.all([
      runDailyJob({ sendAlerts: false }),
      db.select({
        id: rentals.id, accountId: rentals.accountId, profileId: rentals.profileId, customerId: rentals.customerId,
        platformId: rentals.platformId, createdBy: rentals.createdBy, rentalType: rentals.rentalType,
        startDate: rentals.startDate, endDate: rentals.endDate, durationDays: rentals.durationDays,
        isLifetime: rentals.isLifetime,
        deliverySource: rentals.deliverySource,
        deliveryMode: platforms.deliveryMode,
        activatedLink: rentals.activatedLink,
        activatedNote: rentals.activatedNote,
        status: rentals.status, whatsappAlertSent: rentals.whatsappAlertSent, whatsappAlertSentAt: rentals.whatsappAlertSentAt,
        customerEmail: rentals.customerEmail, customerExtra: rentals.customerExtra,
        activationStatus: rentals.activationStatus, activatedAt: rentals.activatedAt,
        createdAt: rentals.createdAt,
        customerName: customers.name, customerPhone: customers.phone,
        platformName: platforms.name, platformColor: platforms.color, platformImage: platforms.imageUrl,
        sellerName: users.displayName, accountEmail: accounts.email, accountType: accounts.type,
        accountDeliveryKind: accounts.deliveryKind,
      }).from(rentals)
        .innerJoin(customers, eq(rentals.customerId, customers.id))
        .innerJoin(platforms, eq(rentals.platformId, platforms.id))
        .innerJoin(users, eq(rentals.createdBy, users.id))
        .leftJoin(accounts, eq(rentals.accountId, accounts.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(rentals.createdAt)).limit(300),
      db.select({ id: platforms.id, name: platforms.name }).from(platforms).orderBy(platforms.id),
    ]);

    const rentalIds = rows.map((r) => r.id);
    const profileIds = Array.from(new Set(rows.map((r) => r.profileId).filter((id): id is number => id != null)));

    const [pays, profs] = await Promise.all([
      rentalIds.length
        ? db.select({
            id: payments.id,
            rentalId: payments.rentalId,
            transactionRef: payments.transactionRef,
            amount: payments.amount,
            status: payments.status,
            isExtension: payments.isExtension,
            createdAt: payments.createdAt,
            rejectionReason: payments.rejectionReason,
            bankName: paymentMethods.name,
            hasReceipt: sql<boolean>`(${payments.receiptImageData} IS NOT NULL AND ${payments.receiptImageData} <> '')`,
            receiptArchived: sql<boolean>`(${payments.receiptImageData} = 'tg://archived')`,
          }).from(payments)
            .leftJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.id))
            .where(inArray(payments.rentalId, rentalIds))
            .orderBy(desc(payments.createdAt))
        : Promise.resolve([]),
      profileIds.length
        ? db.select({ id: profiles.id, profileNo: profiles.profileNo })
            .from(profiles)
            .where(inArray(profiles.id, profileIds))
        : Promise.resolve([]),
    ]);

    const profMap = new Map(profs.map((p) => [p.id, p.profileNo]));
    const paysByRental = new Map<number, any[]>();
    for (const p of pays) {
      const item = {
        ...p,
        bankName: p.bankName || (p.transactionRef?.startsWith("WALLET-") ? "المحفظة" : "غير محدد"),
        hasReceipt: Boolean(p.hasReceipt),
        receiptArchived: Boolean(p.receiptArchived),
      };
      const arr = paysByRental.get(p.rentalId);
      if (arr) arr.push(item);
      else paysByRental.set(p.rentalId, [item]);
    }

    const admin = isAdminRole(user.role);
    const enriched = rows.map((r) => ({
      ...r,
      accountEmail: admin ? r.accountEmail : null,
      profileNo: r.profileId ? profMap.get(r.profileId) ?? null : null,
      payments: paysByRental.get(r.id) || [],
    })).filter((r) => !paymentStatus || r.payments.some((p) => p.status === paymentStatus));

    if (view === "due") {
      const threeDays = Date.now() + 3 * 86400000;
      const due = enriched.filter((r) => !r.isLifetime && r.status !== "COMPLETED" && (
        (r.status === "ACTIVE" && new Date(r.endDate).getTime() <= threeDays) || r.status === "ENDED"));
      return Response.json({ rentals: due, platforms: plats });
    }
    return Response.json({ rentals: enriched, platforms: plats });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/rentals] failed:", e instanceof Error ? e.message : e);
    return jsonError("خطأ في الخادم", 500);
  }
}
