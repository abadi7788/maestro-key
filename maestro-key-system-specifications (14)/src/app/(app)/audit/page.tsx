"use client";
import { useEffect, useState } from "react";
import { ScrollText, Search, Trash2 } from "lucide-react";
import { api, fmtDateTime } from "@/lib/client";
import { Badge, Empty, Spinner } from "@/components/ui";

const LABELS: Record<string, { t: string; tone: string }> = {
  LOGIN: { t: "دخول", tone: "blue" }, LOGIN_FAILED: { t: "دخول فاشل", tone: "red" },
  SALE: { t: "بيع", tone: "green" }, RENEWAL: { t: "تجديد", tone: "green" }, NO_STOCK: { t: "لا مخزون", tone: "amber" },
  PASSWORD_REVEALED: { t: "عرض كلمة مرور", tone: "red" }, PASSWORD_CHANGED: { t: "تغيير كلمة مرور", tone: "gold" },
  PAYMENT_CONFIRMED: { t: "تأكيد سند", tone: "green" }, PAYMENT_REJECTED: { t: "رفض سند", tone: "red" },
  RECEIPT_VIEWED: { t: "عرض سند", tone: "amber" }, PROFILE_FREED: { t: "تحرير بروفايل", tone: "blue" },
  SOFT_DELETE: { t: "حذف ناعم", tone: "red" }, RESTORE: { t: "استرجاع", tone: "green" }, PERMANENT_DELETE: { t: "حذف نهائي", tone: "red" },
  ACCOUNT_CREATED: { t: "حساب جديد", tone: "blue" }, ACCOUNT_UPDATED: { t: "تعديل حساب", tone: "slate" },
  WHATSAPP_SENT: { t: "واتساب", tone: "green" }, DAILY_JOB: { t: "مهمة يومية", tone: "slate" },
};

export default function AuditPage() {
  const [rows, setRows] = useState<any[] | null>(null); const [q, setQ] = useState("");
  useEffect(() => { api("/api/admin-data?view=audit").then((d) => setRows(d.audit)).catch(() => setRows([])); }, []);
  const filtered = (rows || []).filter((r) => !q || `${r.action}${r.username || ""}${r.details || ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">📜 سجل التدقيق</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">يمكنك حذف سجل واحد أو مسح السجل كاملاً.</p>
        </div>
        <button onClick={async () => { if (!confirm("مسح سجل التدقيق بالكامل؟")) return; await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "deleteAudit", all: true }) }); setRows([]); }} className="btn-danger text-xs"><Trash2 size={14} /> مسح الكل</button>
      </div>
      <div className="card relative mb-4 p-4"><Search size={17} className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400" /><input className="field pr-10" placeholder="بحث بالمستخدم أو الإجراء أو التفاصيل…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<ScrollText size={44} />} title="لا سجلات مطابقة" /> : (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {filtered.map((r) => {
            const l = LABELS[r.action] || { t: r.action, tone: "slate" };
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
                <Badge tone={l.tone}>{l.t}</Badge>
                <span className="font-extrabold text-slate-700">{r.username || "النظام"}</span>
                <span className="min-w-[180px] flex-1 font-semibold text-slate-500">{r.details || "—"}</span>
                <span className="text-xs font-bold text-slate-400">{fmtDateTime(r.createdAt)}</span>
                <button onClick={async () => { await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "deleteAudit", id: r.id }) }); setRows((rows || []).filter((x) => x.id !== r.id)); }} className="btn-danger px-2 py-1 text-xs"><Trash2 size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
