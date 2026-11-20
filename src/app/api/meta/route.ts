import { db } from "@/db";
import { platforms, paymentMethods, accounts, profiles } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { ALLOWED_DURATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export type SafeInventoryAccountOption = {
  id: number;
  slots: number;
  expiryDate: string | null;
  remainingDays: number | null;
  salePrice: number | null;
  deliveryKind: string;
};

/** Platforms + banks + durations + availability COUNTS & remaining days only (safe for employees: no emails/passwords). */
export async function GET() {
  try {
    await ensureSeeded();
    await requireUser();

    const [plats, banks, accs, availProfs] = await Promise.all([
      db.select().from(platforms).where(eq(platforms.isActive, true)).orderBy(platforms.id),
      db.select().from(paymentMethods).where(eq(paymentMethods.isActive, true)).orderBy(paymentMethods.id),
      db
        .select({
          id: accounts.id,
          platformId: accounts.platformId,
          type: accounts.type,
          deliveryKind: accounts.deliveryKind,
          status: accounts.status,
          expiryDate: accounts.expiryDate,
          maxUses: accounts.maxUses,
          usedCount: accounts.usedCount,
          salePrice: accounts.salePrice,
        })
        .from(accounts)
        .where(eq(accounts.isDeleted, false))
        .orderBy(asc(accounts.expiryDate), asc(accounts.id)),
      db.select({ accountId: profiles.accountId }).from(profiles).where(eq(profiles.status, "AVAILABLE")),
    ]);

    const availCountByAcc = new Map<number, number>();
    for (const p of availProfs) {
      availCountByAcc.set(p.accountId, (availCountByAcc.get(p.accountId) || 0) + 1);
    }

    type Slots = {
      slots: number;
      accounts: number;
      nextRemainingDays: number | null;
      nextExpiryDate: string | null;
      maxRemainingDays: number | null;
    };
    const availability: Record<number, { slots: number; accounts: number }> = {};
    const availabilityByType: Record<number, { FULL: Slots; PROFILE: Slots }> = {};
    const availableAccountsByType: Record<
      number,
      { FULL: SafeInventoryAccountOption[]; PROFILE: SafeInventoryAccountOption[] }
    > = {};
    const priceByType: Record<number, { FULL: number | null; PROFILE: number | null }> = {};
    const now = new Date();
    const nowMs = now.getTime();

    const ensure = (pid: number, type: "FULL" | "PROFILE") => {
      if (!availabilityByType[pid]) {
        availabilityByType[pid] = {
          FULL: { slots: 0, accounts: 0, nextRemainingDays: null, nextExpiryDate: null, maxRemainingDays: null },
          PROFILE: { slots: 0, accounts: 0, nextRemainingDays: null, nextExpiryDate: null, maxRemainingDays: null },
        };
      }
      if (!availableAccountsByType[pid]) {
        availableAccountsByType[pid] = { FULL: [], PROFILE: [] };
      }
      return availabilityByType[pid][type];
    };

    for (const acc of accs) {
      if (acc.status === "NEEDS_PASSWORD_CHANGE") continue;
      if (acc.expiryDate && new Date(acc.expiryDate).getTime() <= nowMs) continue;
      if (acc.maxUses != null && (acc.usedCount ?? 0) >= acc.maxUses) continue;

      const slots =
        acc.type === "FULL"
          ? acc.status === "AVAILABLE"
            ? 1
            : 0
          : availCountByAcc.get(acc.id) || 0;

      if (slots > 0) {
        const key: "FULL" | "PROFILE" = acc.type === "FULL" ? "FULL" : "PROFILE";
        const expDate = acc.expiryDate ? new Date(acc.expiryDate) : null;
        const remainingDays = expDate
          ? Math.max(0, Math.ceil((expDate.getTime() - nowMs) / 86400000))
          : null;

        availability[acc.platformId] = availability[acc.platformId] || { slots: 0, accounts: 0 };
        availability[acc.platformId].slots += slots;
        availability[acc.platformId].accounts += 1;

        const bucket = ensure(acc.platformId, key);
        bucket.slots += slots;
        bucket.accounts += 1;
        if (bucket.accounts === 1) {
          bucket.nextRemainingDays = remainingDays;
          bucket.nextExpiryDate = expDate ? expDate.toISOString() : null;
        }
        if (remainingDays !== null) {
          if (bucket.maxRemainingDays === null || remainingDays > bucket.maxRemainingDays) {
            bucket.maxRemainingDays = remainingDays;
          }
        }

        availableAccountsByType[acc.platformId][key].push({
          id: acc.id,
          slots,
          expiryDate: expDate ? expDate.toISOString() : null,
          remainingDays,
          salePrice: acc.salePrice ?? null,
          deliveryKind: acc.deliveryKind || "CREDENTIALS",
        });

        if (!priceByType[acc.platformId]) priceByType[acc.platformId] = { FULL: null, PROFILE: null };
        if (acc.salePrice && !priceByType[acc.platformId][key]) priceByType[acc.platformId][key] = acc.salePrice;
      }
    }

    return Response.json(
      {
        platforms: plats,
        paymentMethods: banks,
        durations: ALLOWED_DURATIONS,
        availability,
        availabilityByType,
        availableAccountsByType,
        priceByType,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/meta] failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "خطأ في الخادم" }, { status: 500 });
  }
}
