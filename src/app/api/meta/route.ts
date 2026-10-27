import { db } from "@/db";
import { platforms, paymentMethods, accounts, profiles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { ALLOWED_DURATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Platforms + banks + durations + availability COUNTS only (safe for employees: no emails/passwords). */
export async function GET() {
  try {
    await ensureSeeded();
    await requireUser();
    const plats = await db.select().from(platforms).where(eq(platforms.isActive, true)).orderBy(platforms.id);
    const banks = await db.select().from(paymentMethods).where(eq(paymentMethods.isActive, true)).orderBy(paymentMethods.id);
    const accs = await db.select().from(accounts).where(eq(accounts.isDeleted, false));

    type Slots = { slots: number; accounts: number };
    const availability: Record<number, Slots> = {};
    const availabilityByType: Record<number, { FULL: Slots; PROFILE: Slots }> = {};
    const priceByType: Record<number, { FULL: number | null; PROFILE: number | null }> = {};

    const ensure = (pid: number, type: "FULL" | "PROFILE") => {
      if (!availabilityByType[pid]) availabilityByType[pid] = { FULL: { slots: 0, accounts: 0 }, PROFILE: { slots: 0, accounts: 0 } };
      return availabilityByType[pid][type];
    };

    for (const acc of accs) {
      if (acc.status === "NEEDS_PASSWORD_CHANGE") continue;
      if (acc.expiryDate && new Date(acc.expiryDate) <= new Date()) continue;
      // روابط/أكواد مستنفدة الاستخدامات لا تُحتسب متاحة
      if (acc.maxUses != null && (acc.usedCount ?? 0) >= acc.maxUses) continue;
      let slots = 0;
      if (acc.type === "FULL") slots = acc.status === "AVAILABLE" ? 1 : 0;
      else {
        const profs = await db.select().from(profiles).where(and(eq(profiles.accountId, acc.id), eq(profiles.isOccupied, false)));
        slots = profs.length;
      }
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
