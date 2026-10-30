/**
 * نظام الأدوار الموحّد — Maestro Key
 * ملف نقي بدون أي اعتماديات (يعمل في المتصفح والخادم والـMiddleware).
 *
 * القاعدة الذهبية: كل مقارنة دور في التطبيق يجب أن تمر من هنا،
 * حتى لا تنكسر الصلاحيات بسبب اختلاف حالة الأحرف (ADMIN/admin)
 * أو أسماء بديلة (staff/employee).
 */

export type AppRole = "ADMIN" | "EMPLOYEE" | "USER";

const ADMIN_ALIASES = new Set([
  "ADMIN",
  "ADMINISTRATOR",
  "MANAGER",
  "OWNER",
  "SUPERADMIN",
  "SUPER_ADMIN",
  "SUPER-ADMIN",
]);

const EMPLOYEE_ALIASES = new Set([
  "EMPLOYEE",
  "STAFF",
  "SELLER",
]);

/** تطبيع أي قيمة دور إلى ADMIN أو EMPLOYEE أو USER */
export function normalizeRole(v: unknown): AppRole {
  const s = String(v ?? "").trim().toUpperCase();
  if (ADMIN_ALIASES.has(s)) return "ADMIN";
  if (EMPLOYEE_ALIASES.has(s)) return "EMPLOYEE";
  return "USER";
}

export function isAdminRole(v: unknown): boolean {
  return normalizeRole(v) === "ADMIN";
}

export function isEmployeeRole(v: unknown): boolean {
  return normalizeRole(v) === "EMPLOYEE";
}

export function isUserRole(v: unknown): boolean {
  return normalizeRole(v) === "USER";
}


/** صفحات المدير فقط — الموظف يُحوَّل عنها تلقائياً. */
export const ADMIN_ONLY_PATHS = [
  "/inbox",
  "/accounts",
  "/rentals",
  "/customers",
  "/trash",
  "/audit",
  "/settings",
] as const;

export function isAdminOnlyPath(pathname: string): boolean {
  const p = String(pathname || "");
  return ADMIN_ONLY_PATHS.some((base) => p === base || p.startsWith(base + "/"));
}

export const ADMIN_HOME = "/dashboard";
export const EMPLOYEE_HOME = "/sale";

/** الصفحة الرئيسية المناسبة لكل دور بعد تسجيل الدخول. */
export function homeForRole(v: unknown): string {
  return isAdminRole(v) ? ADMIN_HOME : EMPLOYEE_HOME;
}

/** التحقق من أن مسار العودة ?next= داخلي وآمن (يمنع open-redirect). */
export function safeNextPath(v: unknown): string | null {
  const s = String(v ?? "");
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return null;
  return s;
}
