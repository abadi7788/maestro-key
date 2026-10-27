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
