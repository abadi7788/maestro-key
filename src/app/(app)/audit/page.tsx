"use client";
import { useEffect, useState } from "react";
import { ScrollText, Trash2 } from "lucide-react";
import { api, fmtDateTime } from "@/lib/client";
import { Badge, Empty, Spinner } from "@/components/ui";

const LABELS: Record<string, [string, string]> = {
  SALE_CREATED: ["بيع جديد", "green"],
  MANUAL_SALE: ["بيع مباشر (عبر البروفايل)", "green"],
  RENEWAL: ["تجديد اشتراك", "blue"],
  ONDEMAND_ORDER: ["طلب تفعيل فوري", "amber"],
  LINK_ORDER: ["طلب رابط اشتراك", "blue"],
  RENTAL_ACTIVATED: ["تفعيل اشتراك", "green"],
  RENTAL_REFUNDED: ["إلغاء واسترداد طلب", "red"],
  RENTAL_CLOSED: ["إغلاق طلب", "slate"],
  WALLET_TOPUP: ["شحن محفظة موظف", "green"],
  WALLET_DEDUCT: ["خصم / تسوية محفظة", "amber"],
  PAYMENT_CONFIRMED: ["تأكيد سند", "green"],
  PAYMENT_REJECTED: ["رفض سند", "red"],
  CREDENTIALS_REVEALED: ["فتح بيانات لعميل", "gold"],
  ACTIVATION_REVEALED: ["عرض بيانات تفعيل", "gold"],
  LINK_REVEALED: ["عرض رابط اشتراك", "gold"],
  LICENSE_REVEALED: ["عرض كود ترخيص", "gold"],
  PASSWORD_REVEALED: ["عرض كلمة مرور مخزون", "amber"],
  PASSWORD_CHANGED: ["تغيير كلمة مرور", "gold"],
  PROFILE_FREED: ["تحرير بروفايل", "blue"],
  SOFT_DELETE: ["نقل للمحذوفات", "red"],
  EXPIRED_TO_TRASH: ["نقل منتهي للمحذوفات", "red"],
  EXPIRED_PERMANENT_DELETE: ["حذف حساب منتهي", "red"],
  RESTORE: ["استرجاع حساب", "green"],
  PERMANENT_DELETE: ["حذف نهائي", "red"],
  ACCOUNT_CREATED: ["إضافة حساب للمخزون", "blue"],
  ACCOUNT_UPDATED: ["تعديل حساب", "slate"],
  USER_CREATED: ["إضافة مستخدم", "blue"],
  USER_UPDATED: ["تعديل مستخدم / صلاحيات", "slate"],
  USER_DELETED: ["حذف مستخدم", "red"],
  PLATFORM_MANAGED: ["إدارة منصة", "blue"],
  PLATFORM_DELETED: ["حذف منصة", "red"],
  BANK_MANAGED: ["إدارة بنك", "blue"],
  CUSTOMER_CREATED: ["إضافة عميل", "blue"],
  CUSTOMER_UPDATED: ["تعديل عميل", "slate"],
  LOGIN: ["تسجيل دخول", "slate"],
  LOGIN_FAILED: ["محاولة دخول فاشلة", "red"],
  PASSWORD_RESET_OTP: ["استعادة كلمة مرور", "amber"],
  RECEIPT_VIEWED: ["عرض صورة سند", "amber"],
  WHATSAPP_SENT: ["إرسال واتساب", "green"],
  DAILY_JOB: ["مهمة يومية", "slate"],
  SETTINGS_UPDATED: ["تحديث إعدادات", "slate"],
};

export default function AuditPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api("/api/admin-data?view=audit").then((d) => setRows(d.audit));
  useEffect(() => { load(); }, []);

  async function delOne(id: number) {
    setBusy(true);
    try { await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "deleteAudit", id }) }); setRows((r) => (r || []).filter((x) => x.id !== id)); }
    finally { setBusy(false); }
  }
  async function clearAll() {
    if (!confirm("مسح سجل التدقيق بالكامل؟ لا يمكن التراجع عن هذا الإجراء.")) return;
    setBusy(true);
    try { await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "deleteAudit", all: true }) }); setRows([]); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">📜 سجل التدقيق الكامل</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">كل حركة حساسة مسجلة باسم المستخدم والتوقيت: المبيعات، شحن المحافظ، الصلاحيات، عرض كلمات المرور، وتأكيد السندات.</p>
        </div>
        {rows && rows.length > 0 && (
          <button disabled={busy} onClick={clearAll} className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/15 px-3.5 py-2 text-xs font-extrabold text-red-300 hover:bg-red-500/25">
            <Trash2 size={14} /> مسح السجل بالكامل
          </button>
        )}
      </div>

      {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<ScrollText size={44} />} title="لا توجد سجلات" /> : (
        <div className="card divide-y divide-white/10">
          {rows.map((l) => {
            const [label, tone] = LABELS[l.action] || [l.action, "slate"];
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={tone}>{label}</Badge>
                  <span className="font-extrabold text-white">{l.username}</span>
                  <span className="font-semibold text-slate-300">{l.details}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-400">{fmtDateTime(l.createdAt)}</span>
                  <button disabled={busy} onClick={() => delOne(l.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-300" title="حذف هذا السطر">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
