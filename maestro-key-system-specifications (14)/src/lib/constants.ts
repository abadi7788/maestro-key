export const ALLOWED_DURATIONS = [
  { days: 30, label: "شهر — 30 يوم", priceHint: 3500 },
  { days: 60, label: "شهران — 60 يوم", priceHint: 6500 },
  { days: 90, label: "3 أشهر — 90 يوم", priceHint: 9000 },
  { days: 180, label: "6 أشهر — 180 يوم", priceHint: 16500 },
  { days: 365, label: "سنة — 365 يوم", priceHint: 30000 },
];

export const ACCOUNT_STATUS: Record<string, string> = {
  AVAILABLE: "متاح للبيع",
  RENTED: "مؤجَّر بالكامل",
  NEEDS_PASSWORD_CHANGE: "بانتظار تغيير كلمة المرور",
};

export const RENTAL_STATUS: Record<string, string> = {
  ACTIVE: "نشط",
  ENDED: "منتهي — بانتظار إجراء المدير",
  CLOSED: "مغلق",
  REJECTED: "ملغي (سند مرفوض)",
};

export const PAYMENT_STATUS: Record<string, string> = {
  PENDING: "بانتظار مراجعة المدير",
  CONFIRMED: "مؤكد",
  REJECTED: "مرفوض",
};

export function addDays(date: Date, days: number) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d;
}

export function formatDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-YE", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-YE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function daysLeft(end: string | Date) {
  const ms = new Date(end).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function cleanPhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").trim();
}

export function waLink(phone: string, message: string) {
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length === 9 && p.startsWith("7")) p = "967" + p; // Yemen default
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(v), tpl);
}

export type DeliveryType = "CREDENTIALS" | "INVITE_LINK" | "LICENSE_KEY";

export interface DeliveryInfo {
  email?: string | null;
  password?: string | null;
  pin?: string | null;
  profile?: string | null;
  link?: string | null;
  maxUses?: number | null;
  licenseKey?: string | null;
  note?: string | null;
}

/** Build ordered, human-readable delivery lines (only non-empty fields). */
export function buildDeliveryLines(d: DeliveryInfo): string[] {
  const lines: string[] = [];
  if (d.email) lines.push("📧 الإيميل: " + d.email);
  if (d.password) lines.push("🔑 كلمة المرور: " + d.password);
  if (d.pin) lines.push("🔒 PIN: " + d.pin);
  if (d.profile) lines.push("👤 " + d.profile);
  if (d.link) lines.push("🔗 رابط الدعوة: " + d.link);
  if (d.maxUses) lines.push("🔁 عدد مرات الاستخدام: " + d.maxUses);
  if (d.licenseKey) lines.push("🎫 الكود / المفتاح: " + d.licenseKey);
  if (d.note) lines.push("📝 " + d.note);
  return lines;
}

/** Build the ready-to-send WhatsApp message for a delivered subscription. */
export function buildDeliveryMessage(opts: { name: string; platform: string; endDate: string; delivery: DeliveryInfo }): string {
  const lines = buildDeliveryLines(opts.delivery).join("\n");
  return [
    "مرحباً " + opts.name + " 🎉",
    "تم استلام اشتراك " + opts.platform + " من متجر مايسترو كي 🔑",
    lines || "تم تفعيل حسابك بنجاح ✓",
    "⏳ صالح حتى: " + opts.endDate,
    "تمتعة سعيدة!",
  ].filter(Boolean).join("\n");
}
