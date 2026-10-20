"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Check, KeyRound, Loader2, Lock, MessageCircle, ReceiptText, Search, X } from "lucide-react";
import { api, fetchMe, fmtDate, fmtDateTime, money, waLink, daysLeft, type Me } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, ReceiptButton, Spinner, paymentBadge, rentalBadge } from "@/components/ui";

export default function RentalsList({ mode }: { mode: "all" | "mine" }) {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState(""); const [payStatus, setPayStatus] = useState(""); const [q, setQ] = useState("");
  const [rejecting, setRejecting] = useState<any>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [credRental, setCredRental] = useState<any>(null); const [credData, setCredData] = useState<any>(null); const [credBusy, setCredBusy] = useState(false); const [credErr, setCredErr] = useState("");

  async function openCreds(r: any) {
    setCredRental(r); setCredData(null); setCredErr(""); setCredBusy(true);
    try { const d = await api(`/api/sales/credentials?rentalId=${r.id}`); setCredData(d); }
    catch (e: any) { setCredErr(e.message || "تعذّر فتح البيانات"); }
    finally { setCredBusy(false); }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view: mode });
    if (status) params.set("status", status);
    if (payStatus) params.set("paymentStatus", payStatus);
    const d = await api(`/api/rentals?${params}`).catch(() => ({ rentals: [] }));
    setRows(d.rentals);
  }, [mode, status, payStatus]);

  useEffect(() => { fetchMe().then(setMe); load(); }, [load]);
  useAutoRefresh(load, 8000);

  async function act(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    try { await api("/api/actions", { method: "POST", body: JSON.stringify(body) }); setMsg(okMsg); setRejecting(null); setReason(""); await load(); }
    catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }

  const filtered = (rows || []).filter((r) => !q || `${r.customerName}${r.customerPhone}${r.platformName}${r.sellerName}`.includes(q));
  const isAdmin = me?.role === "ADMIN";

  return (
    <div>
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">{msg}</div>}
      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="field pr-10" placeholder="بحث باسم العميل أو رقمه أو المنصة أو الموظف…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="field sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل حالات الاشتراك</option><option value="ACTIVE">نشط</option><option value="ENDED">منتهي</option><option value="CLOSED">مغلق</option><option value="REJECTED">ملغي</option>
        </select>
        <select className="field sm:w-52" value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
          <option value="">كل حالات السند</option><option value="PENDING">بانتظار المراجعة</option><option value="CONFIRMED">مؤكد</option><option value="REJECTED">مرفوض</option>
        </select>
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<ReceiptText size={44} />} title="لا توجد عمليات مطابقة" /> : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <article key={r.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <PlatformLogo src={r.platformImage} name={r.platformName} color={r.platformColor} size={48} />
                <div className="min-w-[170px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black">{r.customerName}</span>
                    <span className="text-xs font-bold text-slate-500" dir="ltr">{r.customerPhone}</span>
                    <Badge tone={r.rentalType === "RENEWAL" ? "blue" : "gold"}>{r.rentalType === "RENEWAL" ? "تجديد" : "بيع جديد"}</Badge>
                    {!r.accountType && <Badge tone="amber">عند الطلب</Badge>}
                    {r.activationStatus === "PENDING" && <Badge tone="amber">⏳ بانتظار التفعيل</Badge>}
                    {r.activationStatus === "ACTIVATED" && <Badge tone="green">⚡ مُفعّل {fmtDateTime(r.activatedAt)}</Badge>}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold leading-relaxed text-slate-500">
                    {r.platformName}{r.profileNo ? ` — بروفايل ${r.profileNo}` : r.accountType === "FULL" ? " — حساب كامل" : ""} • من {fmtDate(r.startDate)} إلى {fmtDate(r.endDate)}
                    {r.status === "ACTIVE" && <span className="font-bold text-emerald-300"> (بقي {daysLeft(r.endDate)} يوم)</span>}
                    <br />البائع: {r.sellerName} • {fmtDateTime(r.createdAt)}{isAdmin && r.accountEmail && <span dir="ltr" className="font-mono"> • {r.accountEmail}</span>}
                    {isAdmin && r.customerEmail && <> • <span dir="ltr" className="font-mono">📧 {r.customerEmail}</span></>}
                    {isAdmin && r.customerExtra && <> • 📝 {r.customerExtra}</>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">{rentalBadge(r.status)}{r.whatsappAlertSent && <Badge tone="blue">🔔 نُبّه العميل واتساب</Badge>}</div>
              </div>

              {/* payments */}
              <div className="mt-3 space-y-2 border-t border-dashed border-white/10 pt-3">
                {r.payments.map((p: any) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white/[.04] px-3 py-2.5 text-[13px]">
                    <span className="font-extrabold">🏦 {p.bankName}</span>
                    <span className="font-mono font-bold text-slate-600" dir="ltr">{p.transactionRef}</span>
                    <span className="font-bold">{money(p.amount)}</span>
                    {p.isExtension && <Badge tone="blue">تمديد</Badge>}
                    {paymentBadge(p.status)}
                    {p.status === "REJECTED" && p.rejectionReason && <span className="font-bold text-red-300">سبب: {p.rejectionReason}</span>}
                    <span className="mr-auto" />
                    {isAdmin && p.hasReceipt && <ReceiptButton paymentId={p.id} />}
                    {isAdmin && p.status === "PENDING" && (
                      <>
                        <button disabled={busy} onClick={() => act({ action: "confirmPayment", paymentId: p.id }, "✓ تم تأكيد السند")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700"><Check size={14} /> تأكيد السند</button>
                        <button disabled={busy} onClick={() => setRejecting(p)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-red-700"><X size={14} /> رفض</button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {(r.payments.some((p: any) => p.status === "CONFIRMED") || r.activationStatus === "ACTIVATED") && (
                  <button onClick={() => openCreds(r)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0e1526] px-3.5 py-2 text-xs font-extrabold text-white transition hover:bg-[#182238] active:scale-[.98]">
                    <KeyRound size={15} className="text-[#174ea6]" /> {r.accountType ? "عرض بيانات الحساب (مؤكد ✓)" : "عرض بيانات التفعيل ✓"}
                  </button>
                )}
                {r.payments.some((p: any) => p.status === "PENDING") && r.activationStatus !== "ACTIVATED" && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700"><Lock size={13} /> {r.accountType ? "البيانات مقفلة — بانتظار تأكيد المدير" : "بانتظار تفعيل المدير"}</span>
                )}
                <a className="btn-ghost py-2 text-xs" target="_blank" rel="noreferrer" href={waLink(r.customerPhone, `مرحباً ${r.customerName}، معك متجر مايسترو كي بخصوص اشتراك ${r.platformName}.`)}><MessageCircle size={15} className="text-[#1fa855]" /> مراسلة العميل</a>
                {(r.status === "ACTIVE" || r.status === "ENDED") && (
                  <Link href={`/sale?phone=${encodeURIComponent(r.customerPhone)}&platformId=${r.platformId}`} className="btn-ghost py-2 text-xs">↻ تسجيل تجديد لهذا العميل</Link>
                )}
                {isAdmin && r.status === "ENDED" && <Link href="/inbox" className="btn-ghost border-red-200 py-2 text-xs text-red-300">⚠️ يحتاج إجراء في التنبيهات</Link>}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="رفض سند دفع">
        <p className="mb-3 text-sm font-semibold leading-relaxed text-slate-600">عند الرفض: يُلغى الاشتراك المرتبط ويعود الحساب/البروفايل إلى المخزون تلقائياً (أو يُتراجع عن التمديد)، ويُسجَّل السبب في سجل التدقيق. انتبه: العميل ربما استلم البيانات — تواصل مع الموظف فوراً.</p>
        <label className="label">سبب الرفض</label>
        <input className="field" placeholder="مثال: المبلغ لا يطابق / السند غير واضح" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={() => act({ action: "rejectPayment", paymentId: rejecting.id, reason: reason || "سند غير مقبول" }, "تم رفض السند وإلغاء الاشتراك وإعادة الحساب للمخزون")} className="btn-danger flex-1">تأكيد الرفض والإلغاء</button>
          <button onClick={() => setRejecting(null)} className="btn-ghost">تراجع</button>
        </div>
      </Modal>

      {/* Credentials reveal (only after admin confirmed the receipt) */}
      <Modal open={!!credRental} onClose={() => { setCredRental(null); setCredData(null); }} title="🔑 بيانات الحساب المسحوب">
        {credBusy ? <Spinner /> : credErr ? (
          <p className="py-6 text-center font-bold text-amber-700">{credErr}</p>
        ) : credData ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300">✓ يمكنك الآن إرسال البيانات للعميل.</p>
            {[
              { l: "📧 الإيميل", v: credData.email },
              { l: "🔑 كلمة المرور", v: credData.password },
              { l: "👤 البروفايل / PIN", v: credData.profileLabel },
              { l: "🔗 رابط التفعيل", v: credData.link },
              { l: "📝 ملاحظة", v: credData.note },
            ].filter((row) => row.v).map((row) => (
              <div key={row.l} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="text-[11px] font-bold text-slate-400">{row.l}</div><div dir="ltr" className="truncate text-left font-mono text-[15px] font-bold text-white">{row.v}</div></div>
                <CopyBtn text={row.v} />
              </div>
            ))}
            <a href={waLink(credData.customerPhone, credData.whatsappMessage)} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-5 py-3 font-extrabold text-white transition hover:bg-[#178a45]">
              <MessageCircle size={18} /> إرسال البيانات للعميل عبر واتساب
            </a>
            <CopyBtn text={credData.whatsappMessage} label="نسخ رسالة الواتساب كاملة" />
            <p className="text-center text-[11px] text-slate-400">تم تسجيل عرض هذه البيانات في سجل التدقيق. لا تشاركها مع غير العميل.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
