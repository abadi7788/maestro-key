"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Check, Copy, ExternalLink, KeyRound, Loader2, Lock, MessageCircle, Pencil, ReceiptText, RotateCcw, Search, ShieldAlert, Trash2, Undo2, X } from "lucide-react";
import { api, cachedApi, fetchMe, fmtDate, fmtDateTime, getCached, getCachedMe, invalidateCache, money, setCached, waLink, daysLeft, type Me } from "@/lib/client";
import { isAdminRole } from "@/lib/roles";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, ReceiptButton, Spinner, paymentBadge, rentalBadge } from "@/components/ui";

export default function RentalsList({ mode }: { mode: "all" | "mine" }) {
  const buildUrl = (st: string, ps: string) => {
    const params = new URLSearchParams({ view: mode });
    if (st) params.set("status", st);
    if (ps) params.set("paymentStatus", ps);
    return `/api/rentals?${params}`;
  };
  const baseCache = getCached<any>(buildUrl("", ""));

  const [me, setMe] = useState<Me | null>(() => getCachedMe());
  const [rows, setRows] = useState<any[] | null>(() => baseCache?.rentals ?? null);
  const [platformsList, setPlatformsList] = useState<any[]>(() => baseCache?.platforms ?? []);
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState(""); const [payStatus, setPayStatus] = useState(""); const [q, setQ] = useState("");
  const [rejecting, setRejecting] = useState<any>(null); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [credRental, setCredRental] = useState<any>(null); const [credData, setCredData] = useState<any>(null); const [credBusy, setCredBusy] = useState(false); const [credErr, setCredErr] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<any>(null);
  const [replaceReason, setReplaceReason] = useState("توقف الحساب / مشاكل دخول أو إغلاق");
  const [replaceResult, setReplaceResult] = useState<any>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceErr, setReplaceErr] = useState("");

  // Edit rental modal
  const [editingRental, setEditingRental] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    customerName: "",
    customerPhone: "",
    platformId: 0,
    endDate: "",
    isLifetime: false,
    customerEmail: "",
    customerExtra: "",
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState("");

  // Rollback rental modal
  const [rollbackRental, setRollbackRental] = useState<any>(null);
  const [rollbackReason, setRollbackReason] = useState("طلب العميل الإلغاء والاسترجاع");
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackErr, setRollbackErr] = useState("");

  // Hard delete rental modal with admin password verification
  const [deleteRental, setDeleteRental] = useState<any>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  function openEditModal(r: any) {
    setEditingRental(r);
    setEditErr("");
    setEditForm({
      customerName: r.customerName || "",
      customerPhone: r.customerPhone || "",
      platformId: r.platformId || 0,
      endDate: r.endDate ? new Date(r.endDate).toISOString().split("T")[0] : "",
      isLifetime: Boolean(r.isLifetime),
      customerEmail: r.customerEmail || "",
      customerExtra: r.customerExtra || "",
    });
  }

  function openRollbackModal(r: any) {
    setRollbackRental(r);
    setRollbackErr("");
    setRollbackReason("طلب العميل الإلغاء والاسترجاع");
  }

  function openDeleteModal(r: any) {
    setDeleteRental(r);
    setDeleteErr("");
    setDeletePassword("");
  }

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

  const load = useCallback(async (force = false) => {
    const url = buildUrl(status, payStatus);
    const d = await cachedApi(url, undefined, { force }).catch(() => null);
    if (d?.rentals) {
      setRows(d.rentals);
      if (d.platforms) setPlatformsList(d.platforms);
    } else if (!rows) {
      setRows([]);
    }
  }, [mode, status, payStatus]);

  useEffect(() => { fetchMe().then((u) => { if (u) setMe(u); }); void load(false); }, [load]);
  useAutoRefresh(() => load(true), 25000);

  async function act(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    const currentUrl = buildUrl(status, payStatus);
    const prevRows = rows ? [...rows] : null;

    if (rows) {
      let next = rows;
      if (body.action === "confirmPayment") {
        next = rows.map((r) => ({
          ...r,
          payments: (r.payments || []).map((p: any) => p.id === body.paymentId ? { ...p, status: "CONFIRMED" } : p),
        }));
      } else if (body.action === "rejectPayment") {
        next = rows.map((r) => {
          if (!(r.payments || []).some((p: any) => p.id === body.paymentId)) return r;
          return {
            ...r,
            status: "REJECTED",
            payments: (r.payments || []).map((p: any) => p.id === body.paymentId ? { ...p, status: "REJECTED", rejectionReason: body.reason } : p),
          };
        });
      }
      setRows(next);
      setCached(currentUrl, { rentals: next, platforms: platformsList });
    }
    setRejecting(null); setReason("");

    try {
      await api("/api/actions", { method: "POST", body: JSON.stringify(body) });
      setMsg(okMsg);
      invalidateCache("/api/admin-data");
      invalidateCache("/api/accounts");
      invalidateCache("/api/meta");
      void load(true);
    } catch (e: any) {
      if (prevRows) {
        setRows(prevRows);
        setCached(currentUrl, { rentals: prevRows, platforms: platformsList });
      }
      setMsg("⚠️ " + e.message);
    } finally { setBusy(false); }
  }

  const filtered = (rows || []).filter((r) => {
    if (q && !`${r.customerName}${r.customerPhone}${r.platformName}${r.sellerName}`.includes(q)) {
      return false;
    }
    const isDigitalOrLifetime = Boolean(r.isLifetime || r.status === "COMPLETED" || r.accountDeliveryKind === "LICENSE_KEY");
    if (category === "ACTIVE_MONITORED") {
      return r.status === "ACTIVE" && !isDigitalOrLifetime;
    }
    if (category === "DIGITAL_KEYS") {
      return isDigitalOrLifetime && r.status !== "REFUNDED" && r.status !== "REJECTED";
    }
    if (category === "ENDED_CLOSED") {
      return r.status === "ENDED" || r.status === "CLOSED";
    }
    if (category === "REFUNDED") {
      return r.status === "REFUNDED" || r.status === "REJECTED";
    }
    return true;
  });
  const isAdmin = isAdminRole(me?.role);

  return (
    <div>
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">{msg}</div>}

      {/* تصنيف وفصل المنتجات الرقمية والاشتراكات */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { id: "ALL", label: "كل العمليات", count: rows?.length || 0 },
          { id: "ACTIVE_MONITORED", label: "الاشتراكات النشطة والمتابعة", count: rows?.filter(r => r.status === "ACTIVE" && !r.isLifetime && r.accountDeliveryKind !== "LICENSE_KEY").length || 0 },
          { id: "DIGITAL_KEYS", label: "مفاتيح رقمية ومبيعات بدون مدة", count: rows?.filter(r => r.isLifetime || r.status === "COMPLETED" || r.accountDeliveryKind === "LICENSE_KEY").length || 0 },
          { id: "ENDED_CLOSED", label: "المنتهية والمغلقة", count: rows?.filter(r => r.status === "ENDED" || r.status === "CLOSED").length || 0 },
          { id: "REFUNDED", label: "المسترجعة والملغاة", count: rows?.filter(r => r.status === "REFUNDED" || r.status === "REJECTED").length || 0 },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black transition ${
              category === tab.id
                ? "bg-[#2f7bff] text-white shadow-md shadow-blue-500/20"
                : "bg-white/[.05] text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{tab.label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${category === tab.id ? "bg-white/20 text-white" : "bg-white/10 text-slate-400"}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="field pr-10" placeholder="بحث باسم العميل أو رقمه أو المنصة أو الموظف…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="field sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل حالات الاشتراك</option>
          <option value="ACTIVE">نشط</option>
          <option value="COMPLETED">مكتمل / بيع نهائي</option>
          <option value="REFUNDED">مسترجع</option>
          <option value="ENDED">منتهي</option>
          <option value="CLOSED">مغلق</option>
          <option value="REJECTED">ملغي</option>
        </select>
        <select className="field sm:w-52" value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
          <option value="">كل حالات السند</option>
          <option value="PENDING">بانتظار المراجعة</option>
          <option value="CONFIRMED">مؤكد</option>
          <option value="REFUNDED">مسترجع</option>
          <option value="REJECTED">مرفوض</option>
        </select>
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<ReceiptText size={44} />} title="لا توجد عمليات مطابقة" /> : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const isOneTime = Boolean(r.isLifetime || r.status === "COMPLETED" || r.accountDeliveryKind === "LICENSE_KEY");
            return (
              <article key={r.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <PlatformLogo src={r.platformImage} name={r.platformName} color={r.platformColor} size={48} />
                  <div className="min-w-[170px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-white">{r.customerName}</span>
                      <span className="text-xs font-bold text-slate-400" dir="ltr">{r.customerPhone}</span>
                      <Badge tone={r.rentalType === "RENEWAL" ? "blue" : "gold"}>{r.rentalType === "RENEWAL" ? "تجديد" : "بيع جديد"}</Badge>
                      {isOneTime && <Badge tone="blue">✨ بيع مباشر بدون مدة</Badge>}
                      {!r.accountType && <Badge tone="amber">عند الطلب</Badge>}
                      {r.activationStatus === "PENDING" && <Badge tone="amber">⏳ بانتظار التفعيل</Badge>}
                      {r.activationStatus === "ACTIVATED" && <Badge tone="green">⚡ مُفعّل {fmtDateTime(r.activatedAt)}</Badge>}
                    </div>
                    <div className="mt-1 text-[13px] font-semibold leading-relaxed text-slate-400">
                      {r.platformName}{r.profileNo ? ` — بروفايل ${r.profileNo}` : r.accountType === "FULL" ? " — حساب كامل" : ""}
                      {isOneTime ? (
                        <span className="font-bold text-sky-400"> • منتج رقمي / بدون دورة تجديد</span>
                      ) : (
                        <> • من {fmtDate(r.startDate)} إلى {fmtDate(r.endDate)}</>
                      )}
                      {r.status === "ACTIVE" && !isOneTime && <span className="font-bold text-emerald-300"> (بقي {daysLeft(r.endDate)} يوم)</span>}
                      <br />البائع: {r.sellerName} • {fmtDateTime(r.createdAt)}{isAdmin && r.accountEmail && <span dir="ltr" className="font-mono"> • {r.accountEmail}</span>}
                      {isAdmin && r.customerEmail && <> • <span dir="ltr" className="font-mono">📧 {r.customerEmail}</span></>}
                      {isAdmin && r.customerExtra && <> • 📝 {r.customerExtra}</>}
                      {r.refundReason && <span className="block font-bold text-amber-400 mt-0.5">↩️ سبب الاسترجاع: {r.refundReason}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {rentalBadge(r.status)}
                    {r.whatsappAlertSent && <Badge tone="blue">🔔 نُبّه العميل واتساب</Badge>}
                  </div>
                </div>

                {/* payments */}
                <div className="mt-3 space-y-2 border-t border-dashed border-white/10 pt-3">
                  {r.payments.map((p: any) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white/[.04] px-3 py-2.5 text-[13px]">
                      <span className="font-extrabold">🏦 {p.bankName}</span>
                      <span className="font-mono font-bold text-slate-400" dir="ltr">{p.transactionRef}</span>
                      <span className="font-bold text-white">{money(p.amount)}</span>
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
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300"><Lock size={13} /> {r.accountType ? "البيانات مقفلة — بانتظار تأكيد المدير" : "بانتظار تفعيل المدير"}</span>
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
                  {!isOneTime && (r.status === "ACTIVE" || r.status === "ENDED") && (
                    <Link href={`/sale?phone=${encodeURIComponent(r.customerPhone)}&platformId=${r.platformId}`} className="btn-ghost py-2 text-xs">↻ تسجيل تجديد لهذا العميل</Link>
                  )}
                  {isAdmin && r.status === "ENDED" && <Link href="/inbox" className="btn-ghost border-red-200 py-2 text-xs text-red-300">⚠️ يحتاج إجراء في التنبيهات</Link>}

                  {/* أزرار التحكم بالاشتراك (للمدير) */}
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-slate-200 transition hover:bg-white/15"
                      >
                        <Pencil size={13} className="text-amber-400" /> تعديل البيانات
                      </button>
                      {r.status !== "REFUNDED" && r.status !== "REJECTED" && (
                        <button
                          type="button"
                          onClick={() => openRollbackModal(r)}
                          className="inline-flex items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-300 transition hover:bg-amber-500/20 active:scale-[.98]"
                        >
                          <Undo2 size={13} /> استرجاع / إلغاء التفعيل
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openDeleteModal(r)}
                        className="inline-flex items-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300 transition hover:bg-red-500/20 active:scale-[.98]"
                      >
                        <Trash2 size={13} /> حذف نهائي
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
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

      {/* مودال تعديل بيانات الاشتراك */}
      <Modal open={!!editingRental} onClose={() => setEditingRental(null)} title="✏️ تعديل بيانات الاشتراك">
        {editingRental && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setEditBusy(true);
              setEditErr("");
              const currentUrl = buildUrl(status, payStatus);
              const prevRows = rows ? [...rows] : null;
              const target = editingRental;
              const snapshotForm = { ...editForm };
              const nextPlatName = platformsList.find((p) => p.id === Number(snapshotForm.platformId))?.name || target.platformName;

              // Optimistic update
              if (rows) {
                const next = rows.map((x) => x.id === target.id ? {
                  ...x,
                  customerName: snapshotForm.customerName,
                  customerPhone: snapshotForm.customerPhone,
                  platformId: Number(snapshotForm.platformId),
                  platformName: nextPlatName,
                  isLifetime: snapshotForm.isLifetime,
                  endDate: snapshotForm.isLifetime ? x.endDate : snapshotForm.endDate,
                  customerEmail: snapshotForm.customerEmail,
                  customerExtra: snapshotForm.customerExtra,
                } : x);
                setRows(next);
                setCached(currentUrl, { rentals: next, platforms: platformsList });
              }
              setEditingRental(null);
              setMsg("✓ تم حفظ تعديلات الاشتراك بنجاح");

              try {
                await api("/api/actions", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "editRental",
                    rentalId: target.id,
                    customerName: snapshotForm.customerName,
                    customerPhone: snapshotForm.customerPhone,
                    platformId: Number(snapshotForm.platformId),
                    endDate: snapshotForm.isLifetime ? null : snapshotForm.endDate,
                    isLifetime: snapshotForm.isLifetime,
                    customerEmail: snapshotForm.customerEmail,
                    customerExtra: snapshotForm.customerExtra,
                  }),
                });
                invalidateCache("/api/admin-data");
                void load(true);
              } catch (err: any) {
                if (prevRows) {
                  setRows(prevRows);
                  setCached(currentUrl, { rentals: prevRows, platforms: platformsList });
                }
                setEditingRental(target);
                setEditErr(err.message || "فشل تعديل بيانات الاشتراك");
              } finally {
                setEditBusy(false);
              }
            }}
            className="space-y-3.5"
          >
            {editErr && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300">⚠️ {editErr}</div>}
            <div>
              <label className="label">اسم العميل</label>
              <input required className="field" value={editForm.customerName} onChange={(e) => setEditForm({ ...editForm, customerName: e.target.value })} />
            </div>
            <div>
              <label className="label">رقم هاتف / واتساب العميل</label>
              <input required dir="ltr" className="field" value={editForm.customerPhone} onChange={(e) => setEditForm({ ...editForm, customerPhone: e.target.value })} />
            </div>
            <div>
              <label className="label">المنصة</label>
              <select className="field" value={editForm.platformId} onChange={(e) => setEditForm({ ...editForm, platformId: Number(e.target.value) })}>
                {platformsList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.03] p-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-white mb-2">
                <input
                  type="checkbox"
                  checked={editForm.isLifetime}
                  onChange={(e) => setEditForm({ ...editForm, isLifetime: e.target.checked })}
                  className="rounded border-slate-700 text-[#2f7bff] focus:ring-0"
                />
                اشتراك دائم / مدى الحياة (Lifetime — بدون عداد انتهاء)
              </label>
              {!editForm.isLifetime && (
                <div>
                  <label className="label">تاريخ الانتهاء</label>
                  <input
                    type="date"
                    required
                    className="field"
                    value={editForm.endDate}
                    onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="label">إيميل العميل (اختياري)</label>
              <input dir="ltr" className="field" value={editForm.customerEmail} onChange={(e) => setEditForm({ ...editForm, customerEmail: e.target.value })} />
            </div>
            <div>
              <label className="label">ملاحظات إضافية (اختياري)</label>
              <input className="field" value={editForm.customerExtra} onChange={(e) => setEditForm({ ...editForm, customerExtra: e.target.value })} />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={editBusy} className="btn-gold flex-1 py-2.5 text-xs font-bold">
                {editBusy ? "جارِ الحفظ..." : "حفظ التعديلات"}
              </button>
              <button type="button" onClick={() => setEditingRental(null)} className="btn-ghost py-2.5 text-xs">
                إلغاء
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* مودال استرجاع / إلغاء التفعيل */}
      <Modal open={!!rollbackRental} onClose={() => setRollbackRental(null)} title="↩️ استرجاع / إلغاء تفعيل الاشتراك">
        {rollbackRental && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs font-semibold leading-relaxed text-amber-200">
              سيتم إلغاء تفعيل هذا الاشتراك للعميل (<b>{rollbackRental.customerName}</b>) في المنصة (<b>{rollbackRental.platformName}</b>).
              <br />
              <b>النتيجة:</b> يعود الحساب أو البروفايل تلقائياً إلى حالة <b>«متاح للبيع»</b> في المخزون، ويتم تسوية السجل المالي وإرجاع الرصيد للمحفظة إذا كان مدفوعاً بالمحفظة.
            </div>
            {rollbackErr && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300">⚠️ {rollbackErr}</div>}
            <div>
              <label className="label">سبب الاسترجاع (يُحفظ في سجل التدقيق)</label>
              <input
                className="field"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                placeholder="اكتب سبب الاسترجاع..."
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["طلب العميل الإلغاء", "إدخال خاطئ في نقطة البيع", "مشكلة في بيانات الحساب", "تعذر خدمة العميل"].map((quickReason) => (
                <button
                  key={quickReason}
                  type="button"
                  onClick={() => setRollbackReason(quickReason)}
                  className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-white/10"
                >
                  {quickReason}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={rollbackBusy}
                onClick={async () => {
                  setRollbackBusy(true);
                  setRollbackErr("");
                  const currentUrl = buildUrl(status, payStatus);
                  const prevRows = rows ? [...rows] : null;
                  const target = rollbackRental;
                  const reasonText = rollbackReason.trim() || "استرجاع من قبل الإدارة";

                  // Optimistic update
                  if (rows) {
                    const next = rows.map((x) => x.id === target.id ? {
                      ...x,
                      status: "REFUNDED",
                      refundReason: reasonText,
                      payments: (x.payments || []).map((p: any) => ({ ...p, status: "REFUNDED" })),
                    } : x);
                    setRows(next);
                    setCached(currentUrl, { rentals: next, platforms: platformsList });
                  }
                  setRollbackRental(null);
                  setMsg("✓ تم استرجاع الاشتراك وإعادة الحساب للمخزون وتسوية السجل المالي");

                  try {
                    await api("/api/actions", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "rollbackRental",
                        rentalId: target.id,
                        reason: reasonText,
                      }),
                    });
                    invalidateCache("/api/admin-data");
                    invalidateCache("/api/accounts");
                    invalidateCache("/api/meta");
                    void load(true);
                  } catch (err: any) {
                    if (prevRows) {
                      setRows(prevRows);
                      setCached(currentUrl, { rentals: prevRows, platforms: platformsList });
                    }
                    setRollbackRental(target);
                    setRollbackErr(err.message || "تعذر إتمام الاسترجاع");
                  } finally {
                    setRollbackBusy(false);
                  }
                }}
                className="btn-danger flex-1 py-2.5 text-xs font-bold"
              >
                {rollbackBusy ? "جارِ الاسترجاع..." : "تأكيد الاسترجاع وتحرير المخزون"}
              </button>
              <button type="button" onClick={() => setRollbackRental(null)} className="btn-ghost py-2.5 text-xs">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* مودال الحذف النهائي بحماية كلمة مرور المدير */}
      <Modal open={!!deleteRental} onClose={() => setDeleteRental(null)} title="⚠️ حذف نهائي للاشتراك (Hard Delete)">
        {deleteRental && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-red-500/40 bg-red-500/15 p-4 text-xs font-semibold leading-relaxed text-red-200">
              <div className="flex items-center gap-2 font-black text-sm text-red-300 mb-1">
                <ShieldAlert size={18} /> تحذير أمني شديد: عملية لا رجعة فيها
              </div>
              سيتم <b>حذف هذا الاشتراك وسنداته وسجلاته نهائياً من قاعدة البيانات</b>، مع تحرير أي حساب أو بروفايل مرتبط به فوراً في المخزون.
              يُستخدم هذا الخيار لحذف العمليات التجريبية أو الأخطاء التامة.
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs text-slate-300">
              العميل: <b className="text-white">{deleteRental.customerName}</b> ({deleteRental.customerPhone})<br />
              المنصة: <b className="text-white">{deleteRental.platformName}</b> — رقم العملية #{deleteRental.id}
            </div>
            {deleteErr && <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300">⚠️ {deleteErr}</div>}
            <div>
              <label className="label">🔐 كلمة مرور المدير للتأكيد (Admin Password)</label>
              <input
                type="password"
                required
                className="field"
                placeholder="أدخل كلمة مرور حسابك كمدير لتأكيد الحذف"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={deleteBusy || !deletePassword}
                onClick={async () => {
                  setDeleteBusy(true);
                  setDeleteErr("");
                  const currentUrl = buildUrl(status, payStatus);
                  const prevRows = rows ? [...rows] : null;
                  const target = deleteRental;
                  const pw = deletePassword;

                  try {
                    await api("/api/actions", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "hardDeleteRental",
                        rentalId: target.id,
                        adminPassword: pw,
                      }),
                    });
                    if (rows) {
                      const next = rows.filter((x) => x.id !== target.id);
                      setRows(next);
                      setCached(currentUrl, { rentals: next, platforms: platformsList });
                    }
                    setMsg("✓ تم حذف الاشتراك نهائياً من قاعدة البيانات");
                    setDeleteRental(null);
                    setDeletePassword("");
                    invalidateCache("/api/admin-data");
                    invalidateCache("/api/accounts");
                    invalidateCache("/api/meta");
                    void load(true);
                  } catch (err: any) {
                    if (prevRows) {
                      setRows(prevRows);
                      setCached(currentUrl, { rentals: prevRows, platforms: platformsList });
                    }
                    setDeleteErr(err.message || "كلمة مرور المدير غير صحيحة أو تعذر الحذف");
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
                className="btn-danger flex-1 py-2.5 text-xs font-black bg-red-600 hover:bg-red-700"
              >
                {deleteBusy ? "جارِ التحقق والحذف..." : "تأكيد الحذف النهائي"}
              </button>
              <button type="button" onClick={() => setDeleteRental(null)} className="btn-ghost py-2.5 text-xs">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
