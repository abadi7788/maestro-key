"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { ChevronDown, MessageCircle, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { api, fmtDate, money, waLink } from "@/lib/client";
import { Badge, Empty, Modal, Spinner, rentalBadge } from "@/components/ui";

export default function CustomersPage() {
  const [rows, setRows] = useState<any[] | null>(null); const [q, setQ] = useState(""); const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [fName, setFName] = useState(""); const [fPhone, setFPhone] = useState(""); const [fNotes, setFNotes] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [ok, setOk] = useState("");

  const load = useCallback(() => { api("/api/admin-data?view=customers").then((d) => setRows(d.customers)).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 15000);
  const filtered = (rows || []).filter((c) => !q || `${c.name}${c.phone}`.toLowerCase().includes(q.toLowerCase()));

  function openAdd() { setEditing({}); setFName(""); setFPhone(""); setFNotes(""); setErr(""); setOk(""); }
  function openEdit(c: any) { setEditing(c); setFName(c.name); setFPhone(c.phone); setFNotes(c.notes || ""); setErr(""); setOk(""); }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "upsertCustomer", id: editing?.id || undefined, name: fName, phone: fPhone, notes: fNotes }) });
      setOk(editing?.id ? "تم تحديث بيانات العميل بنجاح ✓" : "تمت إضافة العميل بنجاح ✓");
      load();
    } catch (e: any) { setErr(e.message || "حدث خطأ"); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">👥 العملاء</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">ملف موحّد لكل عميل برقم واتسابه: كل اشتراكاته وتجديداته ومدفوعاته ورسائل التنبيه.</p>
        </div>
        <button onClick={openAdd} className="btn-gold"><Plus size={18} /> إضافة عميل</button>
      </div>
      <div className="card relative mb-4 p-4">
        <Search size={17} className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="field pr-10" placeholder="بحث بالاسم أو الرقم…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<Users size={44} />} title="لا يوجد عملاء بعد" hint="أضف عميلاً يدوياً بالزر أعلاه، أو يُضاف تلقائياً عند أول عملية بيع." /> : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const active = c.rentals.filter((r: any) => r.status === "ACTIVE");
            const isOpen = open === c.id;
            return (
              <article key={c.id} className="card overflow-hidden">
                <div className="flex items-center gap-1 pr-4">
                  <button onClick={() => setOpen(isOpen ? null : c.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-4 text-right">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#63a8ff]/30 bg-[#2f7bff]/15 font-black text-[#8ec0ff]">{c.name.slice(0, 1)}</span>
                    <span className="min-w-[150px]">
                      <span className="block truncate font-black text-white">{c.name}</span>
                      <span className="text-xs font-bold text-slate-400" dir="ltr">{c.phone}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {active.length ? active.map((r: any) => <Badge key={r.id} tone="green">{r.isLifetime ? `${r.platformName} — دائم ♾️` : `${r.platformName} حتى ${fmtDate(r.endDate)}`}</Badge>) : <Badge>لا اشتراك نشط</Badge>}
                      <Badge tone="gold">دفع إجمالاً: {money(c.totalPaid)}</Badge>
                    </span>
                  </button>
                  <button onClick={() => openEdit(c)} title="تعديل بيانات العميل" className="mr-1 rounded-lg bg-white/[.06] p-2 text-slate-200 transition hover:bg-white/15 hover:text-white"><Pencil size={16} /></button>
                  <button onClick={async () => { if (!confirm(`حذف العميل ${c.name}؟`)) return; try { await api("/api/manage", { method: "POST", body: JSON.stringify({ action: "deleteCustomer", id: c.id }) }); setRows((rows || []).filter((x) => x.id !== c.id)); } catch (e: any) { alert(e.message); } }} title="حذف العميل" className="rounded-lg bg-red-500/15 p-2 text-red-300 hover:bg-red-500/25"><Trash2 size={16} /></button>
                  <button onClick={() => setOpen(isOpen ? null : c.id)} className="rounded-lg p-2 text-slate-400"><ChevronDown size={19} className={`transition ${isOpen ? "rotate-180" : ""}`} /></button>
                </div>
                {isOpen && (
                  <div className="pop-in space-y-4 border-t border-dashed border-white/10 bg-white/[.02] p-4">
                    {c.notes && <div className="rounded-xl border border-[#63a8ff]/25 bg-[#2f7bff]/10 px-3 py-2 text-sm font-semibold text-[#8ec0ff]">📝 {c.notes}</div>}
                    <div>
                      <h4 className="mb-2 text-sm font-black text-white">سجل الاشتراكات ({c.rentals.length})</h4>
                      <div className="space-y-2">
                        {c.rentals.map((r: any) => (
                          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#101828] px-3 py-2.5 text-[13px] font-semibold">
                            <span className="font-extrabold text-white">{r.platformName}</span>{rentalBadge(r.status)}
                            <span className="text-slate-400">{r.isLifetime ? "اشتراك دائم ♾️" : <>{fmtDate(r.startDate)} ← {fmtDate(r.endDate)} ({r.durationDays} يوم)</>}{r.activationStatus === "ACTIVATED" ? " • ⚡ مُفعّل" : r.activationStatus === "PENDING" ? " • ⏳ بانتظار التفعيل" : ""}</span>
                            {r.accountEmail && <span dir="ltr" className="font-mono text-xs text-slate-300">{r.accountEmail}</span>}
                            {r.whatsappAlertSent && <Badge tone="blue">نُبّه واتساب ✓</Badge>}
                          </div>
                        ))}
                        {c.rentals.length === 0 && <p className="font-bold text-slate-400">لا اشتراكات.</p>}
                      </div>
                    </div>
                    {c.whatsapp.length > 0 && (
                      <div>
                        <h4 className="mb-2 text-sm font-black text-white">سجل رسائل واتساب ({c.whatsapp.length})</h4>
                        <div className="space-y-2">{c.whatsapp.slice(0, 5).map((w: any) => (
                          <div key={w.id} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold leading-relaxed text-slate-200">
                            <Badge tone="green">
                              {w.kind === "EXPIRY_WARNING" ? "تنبيه انتهاء" : w.kind === "SALE_DETAILS" ? "بيانات اشتراك" : w.kind === "ACTIVATION" ? "تفعيل فوري" : "تجديد"} — {w.status}
                            </Badge>
                            <p className="mt-1.5 whitespace-pre-wrap">{w.message.slice(0, 220)}{w.message.length > 220 ? "…" : ""}</p>
                          </div>
                        ))}</div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <a href={waLink(c.phone, `مرحباً ${c.name} 👋 معك متجر مايسترو كي.`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700"><MessageCircle size={16} /> واتساب العميل</a>
                      <Link href={`/sale?phone=${encodeURIComponent(c.phone)}`} className="btn-primary px-4 py-2.5 text-sm">بيع / تجديد لهذا العميل</Link>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "✏️ تعديل بيانات العميل" : "➕ إضافة عميل جديد"}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">اسم العميل</label>
            <input className="field" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="الاسم الكامل" required />
          </div>
          <div>
            <label className="label">رقم الواتساب</label>
            <input className="field" dir="ltr" style={{ textAlign: "left" }} value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="967771234567 أو 771234567" required />
            <p className="mt-1 text-xs font-semibold text-slate-400">بالأرقام فقط مع مفتاح الدولة (967) إن وُجد — يُستخدم لرسائل الواتساب وربط التجديدات.</p>
          </div>
          <div>
            <label className="label">ملاحظات (اختياري)</label>
            <textarea className="field" rows={2} value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="عميل مميز / ملاحظات داخلية…" />
          </div>
          {err && <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">⚠️ {err}</div>}
          {ok && <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300">{ok}</div>}
          <div className="flex gap-2">
            <button disabled={busy} className="btn-gold flex-1">{busy ? "جارٍ الحفظ…" : editing?.id ? "حفظ التعديلات" : "إضافة العميل"}</button>
            <button type="button" onClick={() => setEditing(null)} className="btn-ghost">إلغاء</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
