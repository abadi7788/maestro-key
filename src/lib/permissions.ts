/**
 * الصلاحيات اليدوية — Maestro Key
 * تُخزَّن كـ JSON string في users.permissions وتُحلَّل عند الحاجة.
 *
 * صلاحيات افتراضية:
 *  - ADMIN: كل الصلاحيات (لا يُستخدم حقل permissions)
 *  - EMPLOYEE: فقط sales_direct = true (البيع المباشر)
 */
import type { CurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export const PERMISSIONS = {
  CONFIRM_LINK_ACTIVATION: "CONFIRM_LINK_ACTIVATION", // تأكيد طلبات الروابط
  SALES_DIRECT: "SALES_DIRECT", // البيع المباشر
  INVENTORY_MANAGE: "INVENTORY_MANAGE", // إدارة المخزون
  WALLET_CHARGE: "WALLET_CHARGE", // شحن المحفظة (المدير فقط)
  VIEW_REVENUE: "VIEW_REVENUE", // عرض أرباح المتجر
  VIEW_COST_PRICE: "VIEW_COST_PRICE", // عرض أسعار التكلفة
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  CONFIRM_LINK_ACTIVATION: "تأكيد طلبات الروابط",
  SALES_DIRECT: "البيع المباشر",
  INVENTORY_MANAGE: "إدارة المخزون",
  WALLET_CHARGE: "شحن المحفظة (المدير فقط)",
  VIEW_REVENUE: "عرض أرباح المتجر",
  VIEW_COST_PRICE: "عرض أسعار التكلفة الأصلية",
};

const DEFAULT_EMPLOYEE_PERMISSIONS: Record<PermissionKey, boolean> = {
  CONFIRM_LINK_ACTIVATION: true,
  SALES_DIRECT: true,
  INVENTORY_MANAGE: false,
  WALLET_CHARGE: false,
  VIEW_REVENUE: true,
  VIEW_COST_PRICE: true,
};

function parsePermissions(raw: unknown): Record<string, boolean> {
  if (!raw) return {};
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return obj && typeof obj === "object" ? (obj as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * التحقق من صلاحية للمستخدم.
 *  - ADMIN: يُسمح دائماً بكل الصلاحيات
 *  - EMPLOYEE: يعتمد على الحقل المخزن في قاعدة البيانات، مع fallback للقيم الافتراضية
 */
export function hasPermission(user: CurrentUser | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  const stored = parsePermissions(user.permissions);
  // إذا تم تمرير صلاحية محددة في القاعدة، نستخدمها
  if (key in stored) return stored[key] === true;
  // غير ذلك، نستخدم القيم الافتراضية لموظف
  return DEFAULT_EMPLOYEE_PERMISSIONS[key] ?? false;
}

/**
 * تحقق سريع: هل الموظف يحتاج شحن محفظة؟ (المدير فقط دائماً)
 */
export function canChargeWallet(user: CurrentUser | null | undefined): boolean {
  return user?.role === "ADMIN" || hasPermission(user, "WALLET_CHARGE");
}
