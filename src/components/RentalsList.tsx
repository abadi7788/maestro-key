"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Check, Copy, ExternalLink, KeyRound, Loader2, Lock, MessageCircle, ReceiptText, RotateCcw, Search, X } from "lucide-react";
import { api, fetchMe, fmtDate, fmtDateTime, money, waLink, daysLeft, type Me } from "@/lib/client";
import { isAdminRole } from "@/lib/roles";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, ReceiptButton, Spinner, paymentBadge, rentalBadge } from "@/components/ui";

export default function RentalsList({ mode }: { mode: "all" | "mine" }) {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState(""); const [payStatus, setPayStatus] = useState(""); const [q, setQ] = useState("");
  const [rejecting, setRejecting] = useState<any>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [credRental, setCredRental] = useState<any>(null); const [credData, setCredData] = useState<any>(null); const [credBusy, setCredBusy] = useState(false); const [credErr, setCredErr] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<any>(null);
  const [replaceReason, setReplaceReason] = useState("توقف الحساب / مشاكل دخول أو إغلاق");
  const [replaceResult, setReplaceResult] = useState<any>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceErr, setReplaceErr] = useState("");

  async function openCreds(r: any) {
    setCredRental(r); setCredData(null); setCredErr(""); setCredBusy(true);
    try { const d = await api(`/api/sales/credentials?rentalId=${r.id}`); setCredData(d); }
    catch (e: any) { setCredErr(e.message || "تعذّر فتح البيانات"); }
    finally { setCredBusy(false); }
  }

  async function doReplacement() {
    if (!replaceTarget) return;
    setReplaceBusy(true);
    setReplaceErr("");
    try {
      const res = await api("/api/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "compensateReplacement",
          rentalId: replaceTarget.id,
          reason: replaceReason.trim() || "تعويض واستبدال بروفايل جديد",
        }),
      });
      setReplaceResult(res);
      await load();
    } catch (err: any) {
      setReplaceErr(err.message || "تعذر إتمام عملية التعويض");
    } finally {
      setReplaceBusy(false);
    }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view: mode });
    if (status) params.set("status", status);
    if (payStatus) params.set("paymentStatus", payStatus);
    const d = await api(`/api/rentals?${params}`).catch(() => ({ rentals: [] }));
    setRows(d.rentals);
  }, [mode, status, payStatus]);

  useEffect(() => { fetchMe().then(setMe); load(); }, [load]);
  useAutoRefresh(load, 25000);


  async function act(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    try { await api("/api/actions", { method: "POST", body: JSON.stringify(body) }); setMsg(okMsg); setRejecting(null); setReason(""); await load(); }
    catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }

  const filtered = (rows || []).filter((r) => !q || `${r.customerName}${r.customerPhone}${r.platformName}${r.sellerName}`.includes(q));
  const isAdmin = isAdminRole(me?.role);

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
                    <KeyRound size={15} className="text-[#174ea6]" /> {r.deliveryMode === "LINK_ONLY" ? "عرض رابط التفعيل ✓" : r.accountType ? "عرض بيانات الحساب (مؤكد ✓)" : "عرض حالة التفعيل ✓"}
                  </button>
                )}
                {r.payments.some((p: any) => p.status === "PENDING") && r.activationStatus !== "ACTIVATED" && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700"><Lock size={13} /> {r.accountType ? "البيانات مقفلة — بانتظار تأكيد المدير" : "بانتظار تفعيل المدير"}</span>
                )}
                {isAdmin && r.activationStatus === "PENDING" && (
                  <Link href="/inbox" className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/20 px-3.5 py-2 text-xs font-black text-amber-300 transition hover:bg-amber-500/30">
                    <Check size={14} /> تفعيل الطلب في التنبيهات
                  </Link>
                )}
                {(r.status === "ACTIVE" || r.status === "ENDED") && r.deliveryMode !== "LINK_ONLY" && (
                  <button
                    type="button"
                    onClick={() => {
                      setReplaceTarget(r);
                      setReplaceResult(null);
                      setReplaceErr("");
                      setReplaceReason("توقف الحساب / مشاكل دخول أو إغلاق");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-xs font-black text-amber-300 transition hover:bg-amber-400/20 active:scale-[.98]"
                  >
                    <RotateCcw size={14} /> تعويض ببروفايل جديد
                  </button>
                )}
                <a className="btn-ghost py-2 text-xs" target="_blank" rel="noreferrer" href={waLink(r.customerPhone, `مرحباً ${r.customerName}، معك متجر مايسترو كي بخصوص اشتراك ${r.platformName}.`)}><MessageCircle size={15} className="text-[#1fa855]" /> مراسلة العميل</a>
                {!r.isLifetime && (r.status === "ACTIVE" || r.status === "ENDED") && (
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

      {/* Credentials reveal — يختلف العرض حسب نمط التسليم */}
      <Modal open={!!credRental} onClose={() => { setCredRental(null); setCredData(null); }} title={credData?.deliveryMode === "LINK_ONLY" ? "🔗 رابط التفعيل" : credData?.deliveryMode === "ON_DEMAND_EMAIL" ? "⚡ حالة التفعيل" : "🔑 بيانات الحساب المسحوب"}>
        {credBusy ? <Spinner /> : credErr ? (
          <p className="py-6 text-center font-bold text-amber-700">{credErr}</p>
        ) : credData ? (
          <div className="space-y-3">
            {credData.deliveryMode === "LINK_ONLY" ? (
              <>
                <div className="rounded-2xl border border-[#2f7bff]/30 bg-gradient-to-br from-[#2f7bff]/15 to-transparent p-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2f7bff]/20">
                    <ExternalLink size={26} className="text-[#63a8ff]" />
                  </div>
                  <p className="mt-3 text-sm font-black text-white">رابط اشتراك {credData.platformName}</p>
                  <p className="mt-1 break-all text-[12px] font-mono text-slate-400" dir="ltr">{credData.link}</p>
                  {credData.note && <p className="mt-2 text-[12px] font-bold text-slate-300">📝 {credData.note}</p>}
                </div>
                <a href={credData.link} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e1526] px-5 py-3 font-extrabold text-white transition hover:bg-[#182238]">
                  <ExternalLink size={18} /> فتح رابط التفعيل
                </a>
                <CopyBtn text={credData.link} label="نسخ الرابط" />
              </>
            ) : credData.deliveryMode === "ON_DEMAND_EMAIL" ? (
              <>
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-transparent p-5 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20">
                    <Check size={26} className="text-emerald-300" />
                  </div>
                  <p className="mt-3 text-sm font-black text-white">تم التفعيل على إيميلك بنجاح ✓</p>
                  {credData.activatedOnEmail && <p className="mt-1 text-[12px] font-bold text-slate-300" dir="ltr">{credData.activatedOnEmail}</p>}
                  {credData.link && (
                    <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-right">
                      <div className="text-[11px] font-bold text-blue-300 mb-1">🔗 رابط التفعيل:</div>
                      <p className="break-all font-mono text-[12px] text-white" dir="ltr">{credData.link}</p>
                    </div>
                  )}
                  {credData.note && <p className="mt-2 text-[12px] font-bold text-slate-300">📝 {credData.note}</p>}
                </div>
                {credData.link && (
                  <>
                    <a href={credData.link} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0e1526] px-5 py-3 font-extrabold text-white transition hover:bg-[#182238]">
                      <ExternalLink size={18} /> فتح رابط التفعيل
                    </a>
                    <CopyBtn text={credData.link} label="نسخ الرابط" />
                  </>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
            <a href={waLink(credData.customerPhone, credData.whatsappMessage)} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-5 py-3 font-extrabold text-white transition hover:bg-[#178a45]">
              <MessageCircle size={18} /> إرسال للعميل عبر واتساب
            </a>
            <CopyBtn text={credData.whatsappMessage} label="نسخ رسالة الواتساب كاملة" />
            <p className="text-center text-[11px] text-slate-400">تم تسجيل عرض هذه البيانات في سجل التدقيق. لا تشاركها مع غير العميل.</p>
          </div>
        ) : null}
      </Modal>

      {/* Replacement Generator Modal — تعويض ببروفايل جديد وتجهيز رسالة واتساب */}
      <Modal
        open={!!replaceTarget}
        onClose={() => {
          setReplaceTarget(null);
          setReplaceResult(null);
          setReplaceErr("");
        }}
        title="🔄 تعويض ببروفايل جديد وتجهيز رسالة اعتذار"
      >
        {replaceResult ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-emerald-300">
              <div className="flex items-center gap-2 font-black text-sm mb-1">
                <Check size={18} className="text-emerald-400" />
                {replaceResult.message}
              </div>
              <p className="text-xs text-slate-300">
                تم استبدال البروفايل وتخصيص الحساب الجديد في النظام فوراً، وحفظ العملية في سجل التدقيق.
              </p>
            </div>

            {replaceResult.newCredentials && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[.04] p-3.5">
                <div className="text-xs font-black text-[#63a8ff] mb-1">بيانات الحساب الجديد المسحوب:</div>
                {replaceResult.newCredentials.email && (
                  <div className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-400">الإيميل:</span>
                    <span className="font-mono font-bold text-white" dir="ltr">{replaceResult.newCredentials.email}</span>
                  </div>
                )}
                {replaceResult.newCredentials.password && (
                  <div className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-400">كلمة المرور:</span>
                    <span className="font-mono font-bold text-white" dir="ltr">{replaceResult.newCredentials.password}</span>
                  </div>
                )}
                {replaceResult.newCredentials.profileName && (
                  <div className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-400">البروفايل:</span>
                    <span className="font-bold text-white">{replaceResult.newCredentials.profileName}</span>
                  </div>
                )}
                {replaceResult.newCredentials.pin && (
                  <div className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-400">رمز PIN:</span>
                    <span className="font-mono font-bold text-amber-300">{replaceResult.newCredentials.pin}</span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-[#09101f] p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300">رسالة الواتساب الجاهزة للإرسال:</span>
                <CopyBtn text={replaceResult.whatsappMessage} label="نسخ النص" />
              </div>
              <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200" dir="rtl">
                {replaceResult.whatsappMessage}
              </pre>
            </div>

            <a
              href={waLink(replaceResult.customerPhone, replaceResult.whatsappMessage)}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-5 py-3 font-black text-white shadow-lg transition hover:bg-[#178a45] active:scale-[.99]"
            >
              <MessageCircle size={18} /> إرسال رسالة التعويض للعميل عبر واتساب
            </a>

            <button
              type="button"
              onClick={() => {
                setReplaceTarget(null);
                setReplaceResult(null);
              }}
              className="btn-ghost w-full py-2.5 text-xs font-bold"
            >
              إغلاق
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3.5 text-xs font-semibold leading-relaxed text-amber-200">
              يقوم هذا الإجراء بسحب بروفايل متاح جديد فوراً لنفس المنصة (<b>{replaceTarget?.platformName}</b>) وربطه بالعميل (<b>{replaceTarget?.customerName}</b>)، مع إخلاء البروفايل القديم وتجهيز رسالة اعتذار وتعويض بالبيانات الجديدة.
            </div>

            {replaceErr && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300">
                ⚠️ {replaceErr}
              </div>
            )}

            <div>
              <label className="label">سبب التعويض والاستبدال <span className="text-slate-400 text-[11px]">(يُحفظ في سجل التدقيق)</span></label>
              <input
                className="field"
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                placeholder="مثال: توقف الحساب من المنصة / مشاكل دخول"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={replaceBusy}
                onClick={doReplacement}
                className="btn-gold flex-1 py-3 text-sm font-black"
              >
                {replaceBusy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> جلب بروفايل بديل…
                  </span>
                ) : (
                  "تأكيد سحب بروفايل بديل وتجهيز الرسالة"
                )}
              </button>
              <button
                type="button"
                onClick={() => setReplaceTarget(null)}
                className="btn-ghost py-3 px-4 text-xs font-bold"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
