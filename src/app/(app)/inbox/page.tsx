"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { CheckCircle2, KeyRound, MessageCircle, PartyPopper, RotateCcw, UserMinus, Wallet, XCircle, Zap } from "lucide-react";
import { api, fmtDate, money, openWhatsapp } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, ReceiptButton, Spinner } from "@/components/ui";

export default function InboxPage() {
  const [ended, setEnded] = useState<any[] | null>(null);
  const [pendingAct, setPendingAct] = useState<any[]>([]);
  const [pendingPays, setPendingPays] = useState<any[]>([]);
  const [needsPw, setNeedsPw] = useState<any[]>([]);
  const [pwModal, setPwModal] = useState<any>(null);
  const [newPw, setNewPw] = useState("");
  const [actModal, setActModal] = useState<any>(null);
  const [actForm, setActForm] = useState({ email: "", password: "", pin: "", link: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([api("/api/rentals?view=all"), api("/api/accounts")]);
    setEnded(r.rentals.filter((x: any) => x.status === "ENDED"));
    setPendingAct(r.rentals.filter((x: any) => x.activationStatus === "PENDING" && x.status !== "REJECTED" && x.status !== "CLOSED"));
    const pp: any[] = [];
    for (const rent of r.rentals) for (const p of rent.payments || []) if (p.status === "PENDING") pp.push({ ...p, rental: rent });
    setPendingPays(pp);
    setNeedsPw(a.accounts.filter((x: any) => x.status === "NEEDS_PASSWORD_CHANGE"));
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 7000);

  async function act(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    try {
      const res = await api("/api/actions", { method: "POST", body: JSON.stringify(body) });
      setMsg("✓ " + okMsg + (res?.refundedAmount ? ` (تم إرجاع ${Number(res.refundedAmount).toLocaleString("ar-YE")} ر.ي لمحفظة الموظف)` : ""));
      await load();
      try { window.dispatchEvent(new Event("maestro-wallet-updated")); } catch {}
      return res;
    } catch (e: any) { setMsg("⚠️ " + e.message); return null; } finally { setBusy(false); }
  }

  if (!ended) return <Spinner />;
  const total = pendingAct.length + ended.length + pendingPays.length + needsPw.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">🔔 التنبيهات والإجراءات المطلوبة</h1>
        <p className="mt-1 text-sm font-semibold text-slate-400">كل ما ينتظر قرارك البشري في شاشة واحدة — تفعيل طلبات فورية، مراجعة سندات، إزالة عملاء، وتغيير كلمات مرور.</p>
      </div>

      {msg && <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${msg.startsWith("⚠️") ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{msg}</div>}

      {total === 0 && <Empty icon={<PartyPopper size={46} />} title="لا توجد إجراءات معلقة حالياً" hint="كل السندات والطلبات مراجعة وكل الحسابات جاهزة." />}

      {/* 0. Pending On-Demand / Link-Only Activations */}
      {pendingAct.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-black text-amber-300">⚡ طلبات تفعيل / إرسال رابط فورية ({pendingAct.length})</h2>
          {pendingAct.map((r) => {
            const p = r.payments?.[0];
            const isLink = r.deliveryMode === "LINK_ONLY";
            const isWallet = p && !p.paymentMethodId;
            return (
              <div key={r.id} className="card flex flex-wrap items-center justify-between gap-3 border-2 border-amber-400/50 bg-amber-400/10 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <PlatformLogo src={r.platformImage} name={r.platformName} color={r.platformColor} size={46} />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={isLink ? "blue" : "gold"}>{isLink ? "🔗 إرسال رابط" : "⚡ تفعيل على إيميل"}</Badge>
                      <span className="font-extrabold text-white">{r.platformName}</span>
                      <span className="text-xs font-bold text-slate-300">للعميل: {r.customerName} (<span dir="ltr">{r.customerPhone}</span>)</span>
                    </div>
                    {r.customerEmail && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-slate-300">📧 إيميل العميل للتفعيل:</span>
                        <span dir="ltr" className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1 font-mono font-bold text-white">{r.customerEmail}</span>
                        <CopyBtn text={r.customerEmail} label="نسخ الإيميل" />
                      </div>
                    )}
                    {r.customerExtra && <div className="text-xs font-bold text-slate-300">🔖 معلومة إضافية: <b className="text-white">{r.customerExtra}</b></div>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>المدة: <b className="text-slate-200">{r.isLifetime ? "♾️ دائم" : `${r.durationDays} يوم`}</b></span>
                      {r.createdByName && <span>• رفع الطلب: <b className="text-slate-200">{r.createdByName}</b></span>}
                      {p && (
                        <span>
                          • {isWallet ? <b className="text-emerald-300">💳 مدفوع بالمحفظة</b> : `${p.bankName} #${p.transactionRef}`}
                          {p.amount > 0 ? ` — ${money(p.amount)}` : ""}
                        </span>
                      )}
                      {p && !isWallet && <ReceiptButton paymentId={p.id} />}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => { setActModal(r); setActForm({ email: r.customerEmail || "", password: "", pin: "", link: "", note: "" }); }}
                    className="btn-gold px-4 py-2.5 text-xs">
                    <Zap size={15} /> {isLink ? "وضع رابط الاشتراك وإرساله" : "تأكيد التفعيل وإرسال البيانات"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt("سبب إلغاء الطلب (سيُعاد المبلغ لمحفظة الموظف تلقائياً إن كان مدفوعاً بالمحفظة):", "تعذر التفعيل");
                      if (!reason) return;
                      act({ action: "refundRental", rentalId: r.id, reason }, "تم إلغاء الطلب");
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-extrabold text-red-300 hover:bg-red-500/20"
                  >
                    <RotateCcw size={14} /> إلغاء{isWallet ? " واسترداد" : ""}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* 1. Pending payments */}
      {pendingPays.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-black text-white">🧾 سندات دفع بانتظار المراجعة ({pendingPays.length})</h2>
          {pendingPays.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3 border-amber-400/35 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">سند معلّق</Badge>
                  {p.isExtension && <Badge tone="blue">↻ تجديد</Badge>}
                  <span className="font-extrabold text-white">{p.rental.customerName}</span>
                  <span className="text-xs font-bold text-slate-400">• {p.rental.platformName}</span>
                  {p.amount > 0 && <span className="text-xs font-extrabold text-emerald-300">{money(p.amount)}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>البنك: <b className="text-slate-200">{p.bankName || "—"}</b></span>
                  <span dir="ltr" className="font-mono font-bold text-slate-200">#{p.transactionRef}</span>
                  <span>المدة: <b className="text-slate-200">{p.durationDays || p.rental.durationDays} يوم</b> (تبدأ بعد موافقتك)</span>
                  <ReceiptButton paymentId={p.id} />
                </div>
              </div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => act({ action: "confirmPayment", paymentId: p.id }, "تم تأكيد السند — تبدأ المدة من اليوم")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"><CheckCircle2 size={15} /> تأكيد السند</button>
                <button disabled={busy} onClick={() => {
                  const reason = prompt("سبب رفض السند (سيُلغى الحجز ويعود البروفايل متاحاً):");
                  if (!reason) return;
                  act({ action: "rejectPayment", paymentId: p.id, reason }, "تم رفض السند وإلغاء الحجز");
                }} className="btn-danger px-3.5 py-2 text-xs"><XCircle size={15} /> رفض</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 2. Ended rentals */}
      {ended.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-black text-white">⏰ اشتراكات انتهت — أزل العميل من المنصة ({ended.length})</h2>
          {ended.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-center justify-between gap-3 border-red-400/35 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="red">انتهى في {fmtDate(r.endDate)}</Badge>
                  <span className="font-extrabold text-white">{r.customerName}</span>
                  <span dir="ltr" className="text-xs font-bold text-slate-400">{r.customerPhone}</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-400">
                  {r.platformName} • {r.accountEmail ? <>الحساب: <span dir="ltr" className="font-mono font-bold text-slate-200">{r.accountEmail}</span> • {r.rentalType === "FULL" ? "حساب كامل" : `${r.profileName || `بروفايل ${r.profileNo}`}`}</> : `طلب على إيميل العميل (${r.customerEmail || "—"})`}
                </div>
              </div>
              <button disabled={busy} onClick={() => act({ action: "freeProfile", rentalId: r.id }, r.accountId ? "تم تحرير البروفايل" : "تم إغلاق الطلب")}
                className="btn-danger px-3.5 py-2 text-xs"><UserMinus size={15} /> {r.accountId ? "أزلت العميل وحررت البروفايل" : "إغلاق الطلب"}</button>
            </div>
          ))}
        </section>
      )}

      {/* 3. Needs password change */}
      {needsPw.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-black text-white">🔑 حسابات تنتظر تغيير كلمة المرور قبل إعادة البيع ({needsPw.length})</h2>
          {needsPw.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3 border-red-400/40 bg-red-500/10 p-4">
              <div>
                <div className="flex items-center gap-2"><Badge tone="red">محجوب عن البيع</Badge><span className="font-extrabold text-white">{a.platformName}</span></div>
                <div dir="ltr" className="mt-1 font-mono text-sm font-bold text-slate-200">{a.email}</div>
                <div className="text-xs text-slate-400">غيّر كلمة المرور داخل موقع {a.platformName} أولاً، ثم سجّلها هنا ليعود الحساب «متاحاً للبيع».</div>
              </div>
              <button onClick={() => setPwModal(a)} className="btn-gold px-4 py-2 text-xs"><KeyRound size={15} /> تم تغيير كلمة المرور</button>
            </div>
          ))}
        </section>
      )}

      <Modal open={!!pwModal} onClose={() => setPwModal(null)} title="تأكيد كلمة المرور الجديدة">
        <p className="mb-3 text-sm font-semibold text-slate-300">أدخل كلمة المرور الجديدة التي وضعتها للحساب <b dir="ltr" className="text-white">{pwModal?.email}</b>:</p>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="NewPassword#2026" />
        <button disabled={busy || !newPw.trim()} onClick={async () => { await act({ action: "confirmPasswordChange", accountId: pwModal.id, newPassword: newPw.trim() }, "تم التحديث وأصبح الحساب متاحاً للبيع"); setPwModal(null); setNewPw(""); }}
          className="btn-gold mt-4 w-full">حفظ وإعادة للمخزون</button>
      </Modal>

      {/* Modal تأكيد تفعيل طلب فوري (حسب نوع التسليم) */}
      <Modal open={!!actModal} onClose={() => setActModal(null)} title={actModal?.deliveryMode === "LINK_ONLY" ? `🔗 إرسال رابط اشتراك: ${actModal?.platformName}` : `⚡ تفعيل اشتراك: ${actModal?.platformName}`}>
        {actModal && (
          <div className="space-y-3">
            {actModal.deliveryMode === "LINK_ONLY" ? (
              <>
                <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-3 text-xs font-bold text-sky-200">
                  العميل: <b>{actModal.customerName}</b> (<span dir="ltr">{actModal.customerPhone}</span>)
                  <div className="mt-1 text-slate-300">الصق رابط الاشتراك / الدعوة بالأسفل — سيظهر فوراً للموظف في «مبيعاتي» لينسخه ويرسله للعميل.</div>
                </div>
                <div>
                  <label className="label">🔗 رابط الاشتراك / الدعوة <span className="text-red-400">*</span></label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://..." value={actForm.link} onChange={(e) => setActForm({ ...actForm, link: e.target.value })} />
                </div>
                <div>
                  <label className="label">📝 ملاحظة اختيارية للعميل</label>
                  <input className="field" placeholder="مثال: اضغط الرابط واختر الانضمام…" value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold text-amber-200">
                  العميل: <b>{actModal.customerName}</b> (<span dir="ltr">{actModal.customerPhone}</span>)
                  {actModal.customerEmail && <div className="mt-1">📧 إيميل العميل: <span dir="ltr" className="font-mono text-white">{actModal.customerEmail}</span></div>}
                </div>
                <p className="text-xs font-semibold text-slate-400">إن فعّلت الاشتراك مباشرة على إيميل العميل اترك الحقول فارغة واضغط تأكيد، أو أدخل بيانات الدخول/رابط الدعوة:</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label">إيميل الحساب (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={actForm.email} onChange={(e) => setActForm({ ...actForm, email: e.target.value })} /></div>
                  <div><label className="label">كلمة المرور (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={actForm.password} onChange={(e) => setActForm({ ...actForm, password: e.target.value })} /></div>
                  <div><label className="label">رابط دعوة التفعيل (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://..." value={actForm.link} onChange={(e) => setActForm({ ...actForm, link: e.target.value })} /></div>
                  <div><label className="label">رمز PIN (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={actForm.pin} onChange={(e) => setActForm({ ...actForm, pin: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className="label">ملاحظة للعميل (مثال: اقبل الدعوة المرسلة لبريدك)</label><input className="field" value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} /></div>
                </div>
              </>
            )}
            <button disabled={busy || (actModal.deliveryMode === "LINK_ONLY" && !actForm.link.trim())} onClick={async () => {
              const res = await act({ action: "activateRental", rentalId: actModal.id, ...actForm }, actModal.deliveryMode === "LINK_ONLY" ? "تم حفظ الرابط وإشعار الموظف" : "تم تفعيل الاشتراك وتأكيد السند");
              if (res?.whatsappMessage) {
                setActModal(null);
                if (confirm("تم الحفظ وإشعار الموظف ✓ — هل تود فتح واتساب العميل مباشرة أيضاً؟")) {
                  openWhatsapp(res.customerPhone, res.whatsappMessage);
                }
              }
            }} className="btn-gold w-full">
              <MessageCircle size={16} /> {actModal.deliveryMode === "LINK_ONLY" ? "حفظ الرابط وإرساله للموظف" : "تأكيد التفعيل وإرسال إشعار للعميل"}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
