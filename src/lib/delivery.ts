/**
 * أنماط تسليم الاشتراكات (Delivery Modes) — Maestro Key
 * INSTANT_INVENTORY: تسليم فوري من المخزون (إيميل + باسورد + PIN)
 * ON_DEMAND_EMAIL:   تفعيل على إيميل العميل (يُطلب الإيميل، المدير يفعّل خارجياً ثم يؤكد)
 * LINK_ONLY:         تسليم برابط دعوة فقط (بدون إيميل/باسورد/PIN)
 *
 * القيم القديمة INVENTORY و ON_DEMAND ما زالت مدعومة للتوافق مع البيانات السابقة.
 */

export type DeliveryMode = "INSTANT_INVENTORY" | "ON_DEMAND_EMAIL" | "LINK_ONLY";

const LEGACY_MAP: Record<string, DeliveryMode> = {
  INVENTORY: "INSTANT_INVENTORY",
  ON_DEMAND: "ON_DEMAND_EMAIL",
};

export function normalizeDeliveryMode(v: unknown): DeliveryMode {
  const s = String(v || "").trim().toUpperCase();
  if (s === "INSTANT_INVENTORY" || s === "ON_DEMAND_EMAIL" || s === "LINK_ONLY") return s;
  return LEGACY_MAP[s] || "INSTANT_INVENTORY";
}

export const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  INSTANT_INVENTORY: "تسليم فوري من المخزون",
  ON_DEMAND_EMAIL: "تفعيل على إيميل العميل",
  LINK_ONLY: "تسليم برابط فقط",
};

export const DELIVERY_SHORT: Record<DeliveryMode, string> = {
  INSTANT_INVENTORY: "مخزون فوري",
  ON_DEMAND_EMAIL: "عند الطلب — بإيميل",
  LINK_ONLY: "برابط فقط",
};

/** تاريخ بعيد للاشتراكات الدائمة (تُعرض «دائم ♾️» في الواجهات) */
export function lifetimeEndDate(): Date {
  return new Date("2099-12-31T00:00:00Z");
}

export function isLifetimeEnd(d: string | Date | null | undefined): boolean {
  if (!d) return false;
  return new Date(d).getFullYear() >= 2099;
}
