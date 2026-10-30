/**
 * الصلاحيات اليدوية — Maestro Key
 * تُخزَّن كـ JSON string في users.permissions وتُحلَّل عند الحاجة.
 *
 * صلاحيات افتراضية:
 *  - ADMIN: كل الصلاحيات
 *  - EMPLOYEE: الصلاحيات الافتراضية أدناه ما لم يخصصها المدير
 */
import type { CurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export const PERMISSIONS = {
  SALES_DIRECT: "SALES_DIRECT", // البيع المباشر من نقطة البيع
  CONFIRM_LINK_ACTIVATION: "CONFIRM_LINK_ACTIVATION", // تأكيد طلبات الروابط
  INVENTORY_MANAGE: "INVENTORY_MANAGE", // إدارة المخزون
  WALLET_CHARGE: "WALLET_CHARGE", // شحن المحفظة (المدير فقط)
  VIEW_REVENUE: "VIEW_REVENUE", // عرض أرباح المتجر
  VIEW_COST_PRICE: "VIEW_COST_PRICE", // عرض أسعار التكلفة
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_LABELS: Record<PermissionKey, { title: string; desc: string }> = {
  SALES_DIRECT: {
    title: "البيع المباشر من نقطة البيع",
    desc: "إنشاء مبيعات وتجديدات جديدة من شاشة نقطة البيع.",
  },
  CONFIRM_LINK_ACTIVATION: {
    title: "تأكيد طلبات الروابط والتفعيل",
    desc: "تأكيد إتمام طلبات التفعيل عند الطلب أو وضع روابط الدعوة.",
  },
  INVENTORY_MANAGE: {
    title: "إدارة المخزون والحسابات",
    desc: "إضافة وتعديل الحسابات والبروفايلات في المخزون.",
  },
  WALLET_CHARGE: {
    title: "شحن وتسوية المحافظ",
    desc: "شحن أرصدة الموظفين والموزعين وعرض كشف جميع الحركات.",
  },
  VIEW_REVENUE: {
    title: "عرض أرباح وإيرادات المتجر",
    desc: "الاطلاع على الإيرادات الإجمالية ومؤشرات الأداء المالي.",
  },
  VIEW_COST_PRICE: {
    title: "عرض الأسعار المقترحة",
    desc: "رؤية سعر البيع المقترح عند اختيار المنصة.",
  },
};

export const DEFAULT_EMPLOYEE_PERMISSIONS: Record<PermissionKey, boolean> = {
  SALES_DIRECT: true,
  CONFIRM_LINK_ACTIVATION: false,
  INVENTORY_MANAGE: false,
  WALLET_CHARGE: false,
  VIEW_REVENUE: false,
  VIEW_COST_PRICE: true,
};

export function parsePermissions(raw: unknown): Partial<Record<PermissionKey, boolean>> {
  if (!raw) return {};
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return obj && typeof obj === "object" ? (obj as Partial<Record<PermissionKey, boolean>>) : {};
  } catch {
    return {};
  }
}

export function getEffectivePermissions(user: { role?: unknown; permissions?: unknown } | null | undefined): Record<PermissionKey, boolean> {
  const keys = Object.keys(PERMISSIONS) as PermissionKey[];
  if (!user) {
    return Object.fromEntries(keys.map((k) => [k, false])) as Record<PermissionKey, boolean>;
  }
  if (isAdminRole(user.role)) {
    return Object.fromEntries(keys.map((k) => [k, true])) as Record<PermissionKey, boolean>;
  }
  const stored = parsePermissions(user.permissions);
  const out = {} as Record<PermissionKey, boolean>;
  for (const k of keys) {
    out[k] = k in stored ? stored[k] === true : DEFAULT_EMPLOYEE_PERMISSIONS[k];
  }
  return out;
}

export function sanitizePermissionsInput(raw: unknown): string {
  const parsed = parsePermissions(raw);
  const clean: Partial<Record<PermissionKey, boolean>> = {};
  for (const k of Object.keys(PERMISSIONS) as PermissionKey[]) {
    if (k in parsed) clean[k] = Boolean(parsed[k]);
  }
  return JSON.stringify(clean);
}

/**
 * التحقق من صلاحية للمستخدم.
 *  - ADMIN: يُسمح دائماً بكل الصلاحيات
 *  - EMPLOYEE: يعتمد على الحقل المخزن في قاعدة البيانات، مع fallback للقيم الافتراضية
 */
export function hasPermission(user: CurrentUser | { role?: unknown; permissions?: unknown } | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  const stored = parsePermissions(user.permissions);
  if (key in stored) return stored[key] === true;
  return DEFAULT_EMPLOYEE_PERMISSIONS[key] ?? false;
}

/**
 * تحقق سريع: هل المستخدم يملك صلاحية شحن/تسوية المحافظ؟
 */
export function canChargeWallet(user: CurrentUser | { role?: unknown; permissions?: unknown } | null | undefined): boolean {
  return Boolean(user && (isAdminRole(user.role) || hasPermission(user, "WALLET_CHARGE")));
}
