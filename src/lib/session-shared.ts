/**
 * سر الجلسات — نسخة آمنة لبيئة Edge (بدون node:crypto)
 * يستخدمها crypto.ts (الخادم) و middleware.ts (الحماية) من مصدر واحد
 * حتى لا يختلف السر بينهما أبداً.
 */
export const DEV_SESSION_SECRET = "maestro-key-dev-secret-change-in-production-2026";

export function getSessionSecret(): string {
  return (
    process.env.ACCOUNT_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    DEV_SESSION_SECRET
  );
}
