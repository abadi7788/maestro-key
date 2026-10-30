"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { CheckCircle2, KeyRound, MessageCircle, ReceiptText, RefreshCcw, RotateCcw, Search, Send, UserMinus, Wallet, XCircle } from "lucide-react";
import Link from "next/link";
import { api, fmtDate, fmtDateTime, money, daysLeft, openWhatsapp } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, ReceiptButton, Spinner, paymentBadge, rentalBadge } from "@/components/ui";

export default function RentalsList({ view, title, subtitle, adminControls = false }: {
  view: "all" | "renewals" | "mine"; title: string; subtitle: string; adminControls?: boolean;
}) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [credModal, setCredModal] = useState<any>(null);
  const [credData, setCredData] = useState<any>(null);
  const [credErr, setCredErr] = useState("");
  const [credLoading, setCredLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await api(`/api/rentals?view=${view}${statusFilter ? `&status=${statusFilter}` : ""}`);
    setRows(d.rentals);
  }, [view, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 25000);

  async function act(id: number, body: any, okMsg: string) {
    setBusy(id); setMsg("");
    try {
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify(body) });
      setMsg("✓ " + okMsg + (r.needsPasswordChange ? " — الحساب الآن في قسم التنبيهات لتغيير كلمة مروره" : "") + (r.refundedAmount ? ` (تم إرجاع ${Number(r.refundedAmount).toLocaleString("ar-YE")} ر.ي لمحفظة الموظف)` : ""));
      await load();
      try { window.dispatchEvent(new Event("maestro-wallet-updated")); } catch {}
      return r;
    } catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(null); }
  }

  async function openCredentials(r: any) {
    setCredModal(r); setCredData(null); setCredErr(""); setCredLoading(true);
    try {
      const d = await api(`/api/sales/credentials?rentalId=${r.id}`);
      setCredData(d);
    } catch (e: any) { setCredErr(e.message || "تعذر جلب البيانات"); }
    finally { setCredLoading(false); }
  }

  const filtered = (rows || []).filter((r) => !q ||
    r.customerName.toLowerCase().includes(q.toLowerCase()) ||
    r.customerPhone.includes(q) ||
    r.platformName.toLowerCase().includes(q.toLowerCase()) ||
    (r.accountEmail || "").toLowerCase().includes(q.toLowerCase()) ||
    (r.customerEmail || "").toLowerCase().includes(q.toLowerCase()) ||
    r.payments?.some((p: any) => p.transactionRef.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">{title}</h1>
        <p className="mt-1 text-sm font-semibold text-slate-400">{subtitle}</p>
      </div>

      {msg && <div className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${msg.startsWith("⚠️") ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{msg}</div>}

      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="field pr-10" placeholder="بحث بالعميل، الهاتف، المنصة، الإيميل، أو رقم العملية…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {view === "all" && (
          <select className="field sm:w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="ENDED">منتهي</option>
            <option value="CLOSED">مغلق</option>
            <option value="REJECTED">ملغي / مسترد</option>
          </select>
        )}
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? (
        <Empty icon={<ReceiptText size={44} />} title="لا توجد سجلات مطابقة" hint={view === "renewals" ? "ممتاز — لا توجد اشتراكات تنتهي خلال يومين أو منتهية حالياً." : "ستظهر العمليات هنا فور تسجيلها."} />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const left = daysLeft(r.endDate);
            const hasConfirmedPayment = r.payments?.some((p: any) => p.status === "CONFIRMED");
            const hasPendingPayment = r.payments?.some((p: any) => p.status === "PENDING");
            const walletPayment = r.payments?.find((p: any) => !p.paymentMethodId && p.status !== "REJECTED");
            const isOnDemand = !r.accountId;
            const isLinkOnly = r.deliveryMode === "LINK_ONLY";
            const canReveal = r.status !== "REJECTED" && (isOnDemand ? r.activationStatus === "ACTIVATED" : hasConfirmedPayment);

            return (
              <div key={r.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <PlatformLogo src={r.platformImage} name={r.platformName} color={r.platformColor} size={46} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-white">{r.customerName}</span>
                        <a href={`tel:${r.customerPhone}`} dir="ltr" className="text-xs font-bold text-slate-400 hover:underline">{r.customerPhone}</a>
                        {rentalBadge(r.status)}
                        {r.refundedAt && <Badge tone="blue">↩️ مسترد للمحفظة</Badge>}
                        {isOnDemand && (r.activationStatus === "ACTIVATED"
                          ? <Badge tone="green">{isLinkOnly ? "🔗 تم إرسال الرابط" : "⚡ مُفعَّل"}</Badge>
                          : r.status !== "REJECTED" && <Badge tone="amber">{isLinkOnly ? "🔗 بانتظار الرابط" : "⏳ بانتظار تفعيل المدير"}</Badge>)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">
                        {r.platformName} • {isLinkOnly ? "إرسال رابط اشتراك" : isOnDemand ? "تفعيل على إيميل العميل" : r.rentalType === "FULL" ? "حساب كامل" : `${r.profileName || "بروفايل"}`}
                        {r.accountEmail && <> • <span dir="ltr" className="font-mono text-slate-300">{r.accountEmail}</span></>}
                        {r.customerEmail && <> • 📧 <span dir="ltr" className="font-mono text-slate-300">{r.customerEmail}</span></>}
                        {r.customerExtra && <> • 🔖 {r.customerExtra}</>}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">
                        {r.isLifetime ? (
                          <Badge tone="gold">♾️ اشتراك دائم مدى الحياة</Badge>
                        ) : (!isOnDemand && hasPendingPayment && !hasConfirmedPayment) || (isOnDemand && r.activationStatus !== "ACTIVATED") ? (
                          <span className="font-bold text-amber-300">⏳ المدة المطلوبة: {r.durationDays} يوم — تبدأ من لحظة الموافقة/التفعيل</span>
                        ) : (
                          <>
                            من {fmtDate(r.startDate)} إلى <b className="text-slate-200">{fmtDate(r.endDate)}</b> ({r.durationDays} يوم) •{" "}
                            {r.status === "ACTIVE" && (left <= 2 ? <Badge tone="amber">بقي {Math.max(0, left)} يوم</Badge> : <span className="text-emerald-400">بقي {left} يوم</span>)}
                          </>
                        )}
                        {adminControls && r.createdByName && <span> • باعه: {r.createdByName}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canReveal && (
                      <button onClick={() => openCredentials(r)} className="btn-gold px-3.5 py-2 text-xs">
                        <KeyRound size={15} /> {isLinkOnly ? "عرض الرابط وإرساله" : "عرض بيانات الحساب"}
                      </button>
                    )}
                    {!canReveal && r.status !== "REJECTED" && (hasPendingPayment || (isOnDemand && r.activationStatus !== "ACTIVATED")) && (
                      <span className="inline-flex items-center gap-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-300">
                        ⏳ {isLinkOnly ? "بانتظار وضع الرابط من المدير" : isOnDemand ? "بانتظار تفعيل المدير" : "تظهر البيانات بعد موافقة المدير"}
                      </span>
                    )}
                    {!r.isLifetime && (r.status === "ACTIVE" || r.status === "ENDED") && (
                      <Link href={`/sale?phone=${encodeURIComponent(r.customerPhone)}`} className="btn-primary px-3 py-2 text-xs">
                        <RefreshCcw size={15} /> تجديد
                      </Link>
                    )}
                    {adminControls && !r.isLifetime && r.status === "ACTIVE" && (
                      <button disabled={busy === r.id} onClick={async () => {
                        const res = await act(r.id, { action: "sendWhatsapp", rentalId: r.id }, "تم تحضير رسالة التذكير");
                        if (res?.message) openWhatsapp(res.phone, res.message);
                      }} className="btn-ghost px-3 py-2 text-xs">
                        <Send size={14} /> تذكير واتساب{r.whatsappAlertSent ? " ✓" : ""}
                      </button>
                    )}
                    {adminControls && r.status === "ENDED" && (
                      <button disabled={busy === r.id} onClick={() => act(r.id, { action: "freeProfile", rentalId: r.id }, isOnDemand ? "تم إغلاق الطلب" : "تم تحرير البروفايل")}
                        className="btn-danger px-3 py-2 text-xs">
                        <UserMinus size={14} /> {isOnDemand ? "إغلاق الطلب" : "أزلت العميل وحررت البروفايل"}
                      </button>
                    )}
                    {adminControls && walletPayment && r.status !== "REJECTED" && !r.refundedAt && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => {
                          const reason = prompt("سبب إلغاء الطلب وإرجاع المبلغ لمحفظة الموظف:", "تعذر التفعيل / إلغاء بناءً على طلب العميل");
                          if (!reason) return;
                          act(r.id, { action: "refundRental", rentalId: r.id, reason }, "تم إلغاء الطلب واسترداد الرصيد للمحفظة");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-extrabold text-red-300 hover:bg-red-500/20"
                      >
                        <RotateCcw size={14} /> إلغاء واسترداد للمحفظة
                      </button>
                    )}
                  </div>
                </div>

                {r.payments?.length > 0 && (
                  <div className="mt-3.5 space-y-2 border-t border-dashed border-white/10 pt-3">
                    {r.payments.map((p: any) => {
                      const isWallet = !p.paymentMethodId;
                      return (
                        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[.04] px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            {paymentBadge(p.status)}
                            {p.isExtension && <Badge tone="blue">↻ تجديد</Badge>}
                            {isWallet ? (
                              <span className="inline-flex items-center gap-1 font-extrabold text-amber-300">
                                <Wallet size={13} /> محفظة الموظف
                              </span>
                            ) : (
                              <span className="font-bold text-slate-200">{p.bankName || "تحويل بنكي"}</span>
                            )}
                            <span dir="ltr" className="font-mono font-bold text-slate-300">#{p.transactionRef}</span>
                            {p.amount > 0 && <span className="font-extrabold text-emerald-300">{money(p.amount)}</span>}
                            <span className="text-slate-400">{fmtDateTime(p.createdAt)}</span>
                            {p.rejectionReason && <span className="font-bold text-red-300">— السبب: {p.rejectionReason}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {adminControls && !isWallet && <ReceiptButton paymentId={p.id} />}
                            {adminControls && p.status === "PENDING" && (
                              <>
                                <button disabled={busy === p.id} onClick={() => act(p.id, { action: "confirmPayment", paymentId: p.id }, "تم تأكيد السند — يمكن للموظف الآن عرض البيانات")}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-extrabold text-white hover:bg-emerald-700"><CheckCircle2 size={14} /> تأكيد</button>
                                <button disabled={busy === p.id} onClick={() => {
                                  const reason = prompt("سبب رفض السند (سيُلغى الاشتراك ويعود البروفايل متاحاً):");
                                  if (!reason) return;
                                  act(p.id, { action: "rejectPayment", paymentId: p.id, reason }, "تم رفض السند وإلغاء الحجز");
                                }} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 font-extrabold text-white hover:bg-red-700"><XCircle size={14} /> رفض</button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!credModal} onClose={() => setCredModal(null)} title={credData?.deliveryMode === "LINK_ONLY" ? "🔗 رابط اشتراك العميل" : "🔑 بيانات الحساب للعميل"}>
        {credLoading ? <Spinner /> : credErr ? (
          <p className="py-6 text-center font-bold text-red-400">{credErr}</p>
        ) : credData ? (
          <div className="space-y-2.5">
            <div className="rounded-xl bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-300">
              ✓ الطلب مؤكد — يظهر لسجل التدقيق أنك فتحت هذه البيانات لإرسالها إلى <b>{credData.customerName}</b>.
            </div>
            {[
              credData.email && { k: "📧 الإيميل", v: credData.email, ltr: true },
              credData.password && { k: "🔑 كلمة المرور", v: credData.password, ltr: true },
              credData.licenseKey && { k: "🎟️ الكود / المفتاح", v: credData.licenseKey, ltr: true },
              credData.link && { k: "🔗 رابط التفعيل", v: credData.link, ltr: true },
              credData.profileName && { k: "👤 البروفايل المخصص", v: credData.profileName },
              credData.pin && { k: "🔒 رمز PIN", v: credData.pin, ltr: true },
              credData.note && { k: "📝 ملاحظة من المدير", v: credData.note },
            ].filter(Boolean).map((row: any) => (
              <div key={row.k} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-slate-400">{row.k}</div>
                  <div dir={row.ltr ? "ltr" : "rtl"} className={`break-all font-mono text-sm font-bold text-white ${row.ltr ? "text-left" : ""}`}>{row.v}</div>
                </div>
                <CopyBtn text={String(row.v)} />
              </div>
            ))}
            {!credData.email && !credData.password && !credData.licenseKey && !credData.link && !credData.note && (
              <div className="rounded-xl bg-white/[.04] px-3.5 py-3 text-center text-xs font-bold text-slate-300">
                تم التفعيل مباشرة على بريد العميل المسجل دون بيانات دخول إضافية.
              </div>
            )}
            <div className="rounded-xl bg-amber-400/10 px-3.5 py-2 text-center text-xs font-bold text-amber-300">
              {credData.isLifetime ? "♾️ اشتراك دائم مدى الحياة" : <>صالح من {credData.startDate} حتى <b>{credData.endDate}</b> ({credData.durationDays} يوم)</>}
            </div>
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <CopyBtn text={credData.whatsappText} label="نسخ الرسالة كاملة" />
              <button onClick={() => openWhatsapp(credData.customerPhone, credData.whatsappText)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-700">
                <MessageCircle size={16} /> إرسال عبر واتساب
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
