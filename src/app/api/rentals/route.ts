import { db } from "@/db";
import { rentals, customers, platforms, payments, paymentMethods, users, accounts, profiles } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireUser, jsonError } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { ensureSeeded } from "@/lib/seed";
import { runDailyJob } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const user = await requireUser();
    await runDailyJob({ sendAlerts: false });
    const sp = new URL(req.url).searchParams;
    const view = sp.get("view") || (isAdminRole(user.role) ? "all" : "mine");
    const status = sp.get("status") || "";
    const paymentStatus = sp.get("paymentStatus") || "";

    const conds = [];
    if (view === "mine") conds.push(eq(rentals.createdBy, user.id));
    if (view === "all" && !isAdminRole(user.role)) conds.push(eq(rentals.createdBy, user.id));
    if (status) conds.push(eq(rentals.status, status));

    const rows = await db.select({
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
      refundedAt: rentals.refundedAt, refundReason: rentals.refundReason,
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
      .orderBy(desc(rentals.createdAt)).limit(300);

    const rentalIds = rows.map((r) => r.id);
    const pays = rentalIds.length ? await db.select({
      id: payments.id,
      rentalId: payments.rentalId,
      paymentMethodId: payments.paymentMethodId,
      transactionRef: payments.transactionRef,
      amount: payments.amount,
      status: payments.status,
      isExtension: payments.isExtension,
      createdAt: payments.createdAt,
      rejectionReason: payments.rejectionReason,
      bankName: paymentMethods.name,
      hasReceipt: payments.receiptImageData,
    }).from(payments)
      .leftJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.id))
      .where(inArray(payments.rentalId, rentalIds))
      .orderBy(desc(payments.createdAt)) : [];

    const profileIds = Array.from(new Set(rows.map((r) => r.profileId).filter((id): id is number => typeof id === "number")));
    const profs = profileIds.length
      ? await db.select().from(profiles).where(inArray(profiles.id, profileIds))
      : [];
    const profMap = new Map(profs.map((p) => [p.id, p]));

    const enriched = rows.map((r) => {
      const prof = r.profileId ? profMap.get(r.profileId) : undefined;
      return {
        ...r,
        // Employees never see account emails in lists
        accountEmail: isAdminRole(user.role) ? r.accountEmail : null,
        profileNo: prof?.profileNo ?? null,
        profileName: prof?.profileName ?? null,
        payments: pays
          .filter((p) => p.rentalId === r.id)
          .map((p) => ({
            ...p,
            bankName: p.bankName || "محفظة مايسترو كي",
            isWallet: !p.paymentMethodId,
            hasReceipt: !!p.hasReceipt,
          })),
      };
    }).filter((r) => !paymentStatus || r.payments.some((p) => p.status === paymentStatus));

    if (view === "due") {
      const now = Date.now();
      const threeDays = now + 3 * 86400000;
      const due = enriched.filter((r) => !r.isLifetime && (
        (r.status === "ACTIVE" && new Date(r.endDate).getTime() <= threeDays) || r.status === "ENDED"));
      return Response.json({ rentals: due });
    }
    return Response.json({ rentals: enriched });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/rentals] failed:", e instanceof Error ? e.message : e);
    return jsonError("خطأ في الخادم", 500);
  }
}
