import { db } from "@/db";
import { platforms, paymentMethods, accounts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { ALLOWED_DURATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Platforms + banks + durations + availability COUNTS only (safe for employees: no emails/passwords). */
export async function GET() {
  try {
    await ensureSeeded();
    await requireUser();
    const [plats, banks, accs, profCounts] = await Promise.all([
      db.select().from(platforms).where(eq(platforms.isActive, true)).orderBy(platforms.id),
      db.select().from(paymentMethods).where(eq(paymentMethods.isActive, true)).orderBy(paymentMethods.id),
      db.select().from(accounts).where(eq(accounts.isDeleted, false)),
      db.execute(sql`SELECT account_id, count(*)::int AS cnt FROM profiles WHERE status = 'AVAILABLE' GROUP BY account_id`),
    ]);

    const availProfMap = new Map<number, number>();
    for (const r of profCounts.rows as Array<{ account_id: number; cnt: number }>) {
      availProfMap.set(Number(r.account_id), Number(r.cnt));
    }

    type Slots = { slots: number; accounts: number };
    const availability: Record<number, Slots> = {};
    const availabilityByType: Record<number, { FULL: Slots; PROFILE: Slots }> = {};
    const priceByType: Record<number, { FULL: number | null; PROFILE: number | null }> = {};

    const ensure = (pid: number, type: "FULL" | "PROFILE") => {
      if (!availabilityByType[pid]) availabilityByType[pid] = { FULL: { slots: 0, accounts: 0 }, PROFILE: { slots: 0, accounts: 0 } };
      return availabilityByType[pid][type];
    };

    const now = new Date();
    for (const acc of accs) {
      if (acc.status === "NEEDS_PASSWORD_CHANGE") continue;
      if (acc.expiryDate && new Date(acc.expiryDate) <= now) continue;
      if (acc.maxUses != null && (acc.usedCount ?? 0) >= acc.maxUses) continue;
      let slots = 0;
      if (acc.type === "FULL") slots = acc.status === "AVAILABLE" ? 1 : 0;
      else slots = availProfMap.get(acc.id) ?? 0;

      if (slots > 0) {
        const key: "FULL" | "PROFILE" = acc.type === "FULL" ? "FULL" : "PROFILE";

        availability[acc.platformId] = availability[acc.platformId] || { slots: 0, accounts: 0 };
        availability[acc.platformId].slots += slots;
        availability[acc.platformId].accounts += 1;

        const bucket = ensure(acc.platformId, key);
        bucket.slots += slots;
        bucket.accounts += 1;
        if (!priceByType[acc.platformId]) priceByType[acc.platformId] = { FULL: null, PROFILE: null };
        if (acc.salePrice && !priceByType[acc.platformId][key]) priceByType[acc.platformId][key] = acc.salePrice;
      }
    }

    return Response.json({ platforms: plats, paymentMethods: banks, durations: ALLOWED_DURATIONS, availability, availabilityByType, priceByType });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api/meta] failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "خطأ في الخادم" }, { status: 500 });
  }
}
