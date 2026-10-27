import { db } from "@/db";
import { alerts } from "@/db/schema";
import { adminUserIds, employeeUserIds, sendPushToUsers } from "@/lib/push";

export type NotifyInput = {
  title: string;
  body: string;
  kind?: string;
  href?: string;
  forUserId?: number | null;
};

/**
 * دورة التنبيهات حسب الأدوار — Maestro Key
 *  • طلب بيع جديد من موظف → للمدير فقط (صف forUserId = null)
 *  • تأكيد/رفض سند → للموظف صاحب الطلب فقط (forUserId)
 *  • منصة جديدة أو مخزون جديد (kind = ADDITION) → بثّ للمديرين + كل الموظفين
 *
 * ملاحظة: نقاط الإطلاق في مسارات البيع والإدارة موجودة مسبقاً وتستدعي
 * هذه الدالة، لذلك لم نلمس تلك الملفات — التوجيه يتم هنا مركزياً.
 */

const ADMIN_PAGES = [
  "/settings",
  "/accounts",
  "/audit",
  "/trash",
  "/customers",
  "/rentals",
  "/inbox",
];

/** رابط آمن للموظف: صفحات الإدارة تُستبدل بنقطة البيع حتى لا يصل لرابط ممنوع. */
function employeeHref(href: string): string {
  if (ADMIN_PAGES.some((p) => href === p || href.startsWith(p + "/"))) {
    return "/sale";
  }
  return href;
}

/** هل هذا التنبيه إعلان عام للطاقم كله؟ (منصة/مخزون — وليس إضافة موظف). */
function isStaffBroadcast(input: NotifyInput): boolean {
  if (input.kind !== "ADDITION") return false;
  if (input.forUserId) return false;
  if (input.title.includes("موظف")) return false;
  return true;
}

async function insertAlert(input: Required<Pick<NotifyInput, "title" | "body">> & NotifyInput) {
  const [row] = await db
    .insert(alerts)
    .values({
      title: input.title,
      body: input.body,
      kind: input.kind || "INFO",
      href: input.href || "/inbox",
      forUserId: input.forUserId ?? null,
    })
    .returning({ id: alerts.id });
  return row;
}

export async function notifyAdmin(input: NotifyInput) {
  try {
    const kind = input.kind || "INFO";
    const href = input.href || "/inbox";

    // بثّ إعلانات المنصات والمخزون الجديد للمديرين + كل الموظفين
    if (isStaffBroadcast({ ...input, kind })) {
      const [admins, employees] = await Promise.all([
        adminUserIds(),
        employeeUserIds(),
      ]);
      await insertAlert({ ...input, kind, href, forUserId: null });
      const empHref = employeeHref(href);
      for (const id of employees) {
        await insertAlert({ ...input, kind, href: empHref, forUserId: id });
      }
      const tag = `${kind}-${Date.now()}`;
      await sendPushToUsers(admins, { title: input.title, body: input.body, href, tag });
      await sendPushToUsers(employees, {
        title: input.title,
        body: input.body,
        href: empHref,
        tag,
      });
      return;
    }

    // المسار الأصلي كما هو: موجَّه لشخص، أو للمديرين فقط
    await insertAlert({ ...input, kind, href });
    const ids = input.forUserId ? [input.forUserId] : await adminUserIds();
    await sendPushToUsers(ids, {
      title: input.title,
      body: input.body,
      href,
      tag: `${kind}-${Date.now()}`,
    });
  } catch (err) {
    console.error("notify failed", err);
  }
}

/** إشعار مباشر لمستخدم واحد (مثل: تأكيد سند لموظف معيّن). */
export async function notifyUser(
  userId: number,
  input: Omit<NotifyInput, "forUserId">,
) {
  return notifyAdmin({ ...input, forUserId: userId });
}

/** بثّ إجباري لكل الطاقم (مديرين + موظفين) بغض النظر عن النوع. */
export async function notifyAllStaff(input: Omit<NotifyInput, "forUserId">) {
  try {
    const [admins, employees] = await Promise.all([
      adminUserIds(),
      employeeUserIds(),
    ]);
    const kind = input.kind || "INFO";
    const href = input.href || "/inbox";
    const tag = `${kind}-${Date.now()}`;
    await insertAlert({ ...input, kind, href, forUserId: null });
    const empHref = employeeHref(href);
    for (const id of employees) {
      await insertAlert({ ...input, kind, href: empHref, forUserId: id });
    }
    await sendPushToUsers(admins, { title: input.title, body: input.body, href, tag });
    await sendPushToUsers(employees, {
      title: input.title,
      body: input.body,
      href: empHref,
      tag,
    });
  } catch (err) {
    console.error("notify all staff failed", err);
  }
}
