"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { AlarmClock, BellRing, Check, ChevronDown, KeyRound, MessageCircle, Play, ReceiptText, ScanLine, UserMinus, X } from "lucide-react";
import { api, fmtDate, waLink, daysLeft } from "@/lib/client";
import { Badge, Empty, Modal, ReceiptButton, Spinner } from "@/components/ui";

export default function InboxPage() {
  const [rentals, setRentals] = useState<any[] | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pwFor, setPwFor] = useState<any>(null); const [newPw, setNewPw] = useState("");
  const [rejectFor, setRejectFor] = useState<any>(null); const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [activating, setActivating] = useState<number | null>(null);
  const [actForm, setActForm] = useState({ email: "", password: "", link: "", pin: "", note: "" });
  const [lastActivation, setLastActivation] = useState<any>(null);

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([api("/api/rentals?view=all").catch(() => ({ rentals: [] })), api("/api/accounts").catch(() => ({ accounts: [] }))]);
    setRentals(r.rentals); setAccounts(a.accounts);
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 8000);

  async function act(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    try { const d = await api("/api/actions", { method: "POST", body: JSON.stringify(body) }); setMsg("✓ " + okMsg); setPwFor(null); setNewPw(""); await load(); return d; }
    catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }
  async function runJob() {
    const d = await act({ action: "runDailyJob" }, "");
    if (d) setMsg(`✓ المهمة اليومية: انتهى ${d.endedCount} اشتراك، وجهّز ${d.alertsSent} تنبيه انتهاء قبل يومين (يُرسل تلقائياً عبر Meta إن كان مضبوطاً، وإلا سُجّل ويظهر زر واتساب بجانب العميل).`);
  }

  const modeOf = (r: any) => r.deliveryMode === "LINK_ONLY" ? "LINK_ONLY" : (r.deliveryMode === "ON_DEMAND_EMAIL" || !r.accountType) ? "ON_DEMAND_EMAIL" : "INSTANT_INVENTORY";

  async function doActivate(r: any) {
    if (modeOf(r) === "LINK_ONLY" && !actForm.link.trim()) {
      setMsg("⚠️ ضع رابط الاشتراك / الدعوة أولاً ثم أكّد الإرسال");
      return;
    }
    setActivating(r.id);
    try {
      const d = await api("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "activateRental", rentalId: r.id, ...actForm }),
      });
      setMsg(modeOf(r) === "LINK_ONLY"
        ? `✓ تم إرسال رابط اشتراك ${r.customerName} — وصله إشعار واتساب بالرابط، وأُشعر الموظف.`
        : `✓ تم تفعيل اشتراك ${r.customerName} — وصل إشعار واتساب، وأُشعر الموظف.`);
      setLastActivation({ customerPhone: d.customerPhone, whatsappMessage: d.whatsappMessage });
      setActivating(null);
      setActForm({ email: "", password: "", link: "", pin: "", note: "" });
      await load();
    } catch (e: any) {
      setMsg("⚠️ " + e.message);
      setActivating(null);
    }
  }

  if (!rentals) return <Spinner />;
  const pendingActivation = rentals.filter((r) => r.activationStatus === "PENDING" && r.status !== "REJECTED" && r.status !== "CLOSED");
  const endedProfile = rentals.filter((r) => r.status === "ENDED" && r.accountType === "PROFILE");
  const endedFull = rentals.filter((r) => r.status === "ENDED" && r.accountType === "FULL");
  const needsPw = accounts.filter((a) => a.status === "NEEDS_PASSWORD_CHANGE");
  const pendingPays = rentals.flatMap((r) => r.payments.filter((p: any) => p.status === "PENDING").map((p: any) => ({ ...p, rental: r })));
  const endingSoon = rentals.filter((r) => !r.isLifetime && r.status === "ACTIVE" && daysLeft(r.endDate) <= 2 && daysLeft(r.endDate) >= 0);
  const total = pendingActivation.length + endedProfile.length + endedFull.length + pendingPays.length + needsPw.filter((a) => !endedFull.some((r) => r.accountId === a.id)).length;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-black"><BellRing className="text-red-300" /> التنبيهات والإجراءات المطلوبة {total > 0 && <Badge tone="red">{total}</Badge>}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">كل اشتراك منتهٍ يظهر باسم عميله — حتى لو كان الحساب نفسه مؤجَّراً لعملاء آخرين في بروفايلات أخرى.</p>
        </div>
        <button onClick={runJob} disabled={busy} className="btn-primary"><Play size={17} /> تشغيل المهمة اليومية</button>
      </div>
      {msg && <div className="rounded-2xl bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">{msg}</div>}

      {lastActivation && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#1fa855]/40 bg-[#1fa855]/10 px-5 py-4">
          <div className="flex-1 text-[13px] font-bold text-emerald-200">
            ✓ رسالة التفعيل جاهزة. أرسلها للعميل الآن عبر واتساب (أو عبر «مبيعاتي» → عرض بيانات الحساب).
          </div>
          <a href={waLink(lastActivation.customerPhone, lastActivation.whatsappMessage)} target="_blank" rel="noreferrer" className="btn-ghost text-xs border-[#1fa855]/40 bg-[#1fa855]/20 text-emerald-100">
            <MessageCircle size={15} /> إرسال عبر واتساب
          </a>
          <button onClick={() => setLastActivation(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {/* Pending activation (on-demand orders) */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-black"><ScanLine className="text-[#fbbf24]" size={20} /> طلبات بانتظار التفعيل ({pendingActivation.length})</h2>
        {pendingActivation.length === 0 ? <p className="card p-4 font-bold text-slate-500">لا يوجد.</p> : (
          <div className="space-y-3">
            {pendingActivation.map((r: any) => (
              <div key={r.id} className="card overflow-hidden border-[#fbbf24]/30">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f59e0b]/15">
                    <ScanLine size={20} className="text-[#fbbf24]" />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-extrabold text-white">فعّل اشتراك «{r.customerName}» على {r.platformName}</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-400" dir="rtl">
                      <span dir="ltr">{r.customerPhone}</span> • {r.durationDays} يوم • باع: {r.sellerName}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.customerEmail && <span className="pill pill-blue">📧 <span dir="ltr">{r.customerEmail}</span></span>}
                      {r.customerExtra && <span className="pill pill-gold">📝 {r.customerExtra}</span>}
                      {r.payments?.map((p: any) => (
                        <span key={p.id} className="pill pill-neutral">🏦 {p.bankName} <span dir="ltr">{p.transactionRef}</span> — {p.amount.toLocaleString("ar-YE")} ر.ي</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {r.payments?.[0]?.hasReceipt && <ReceiptButton paymentId={r.payments[0].id} />}
                    <button onClick={() => setActivating(activating === r.id ? null : r.id)} className={`btn-ghost text-xs ${activating === r.id ? "border-[#fbbf24]/50" : ""}`}>
                      <ChevronDown size={14} className={activating === r.id ? "rotate-180 transition" : "transition"} /> {activating === r.id ? "إغلاق" : "بيانات التفعيل"}
                    </button>
                  </div>
                </div>

                {activating === r.id && (
                  <div className="space-y-3 border-t border-white/10 bg-white/[.02] p-4">
                    {modeOf(r) === "LINK_ONLY" ? (
                      <>
                        <p className="text-[12.5px] font-bold text-slate-400">
                          الصق <b className="text-white">رابط الاشتراك / الدعوة</b> هنا ثم اضغط تأكيد — سيصل العميل إشعار واتساب بالرابط فوراً.
                        </p>
                        <div>
                          <label className="label">🔗 رابط الاشتراك / الدعوة <span className="text-[#ff5769]">إلزامي</span></label>
                          <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://…" value={actForm.link} onChange={(e) => setActForm({ ...actForm, link: e.target.value })} />
                        </div>
                        <div>
                          <label className="label">📝 ملاحظة تصل للعميل (اختياري)</label>
                          <input className="field" value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} />
                        </div>
                        <button disabled={busy} onClick={() => doActivate(r)} className="btn-gold w-full sm:w-auto sm:min-w-[280px]">
                          <Check size={17} /> تأكيد الإرسال — إشعار العميل
                        </button>
                      </>
                    ) : modeOf(r) === "ON_DEMAND_EMAIL" ? (
                      <>
                        <p className="text-[12.5px] font-bold text-slate-400">
                          فعّل الاشتراك خارجياً على إيميل العميل {r.customerEmail && <b className="text-white" dir="ltr">{r.customerEmail}</b>}،
                          ثم اضغط تأكيد — سيصل العميل إشعار «تم التفعيل على إيميلك بنجاح» <b className="text-white">بدون أي كلمات مرور</b>.
                        </p>
                        <div>
                          <label className="label">📝 ملاحظة تصل للعميل (اختياري)</label>
                          <input className="field" value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} placeholder="مثال: تحقق من صندوق الوارد والرسائل المزعجة" />
                        </div>
                        <button disabled={busy} onClick={() => doActivate(r)} className="btn-gold w-full sm:w-auto sm:min-w-[280px]">
                          <Check size={17} /> تأكيد التفعيل — إشعار العميل
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[12.5px] font-bold text-slate-400">
                          راجع بيانات العميل الإضافية أعلاه ثم أكّد — بيانات الحساب نفسها تُسلَّم من المخزون بعد تأكيد السند.
                          {r.accountEmail && <> الحساب المرجعي: <span dir="ltr" className="font-mono text-[#63a8ff]">{r.accountEmail}</span></>}
                        </p>
                        <div>
                          <label className="label">📝 ملاحظة تصل للعميل (اختياري)</label>
                          <input className="field" value={actForm.note} onChange={(e) => setActForm({ ...actForm, note: e.target.value })} />
                        </div>
                        <button disabled={busy} onClick={() => doActivate(r)} className="btn-gold w-full sm:w-auto sm:min-w-[280px]">
                          <Check size={17} /> تأكيد — إشعار العميل
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ended - profile removals */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-black"><UserMinus className="text-red-300" size={20} /> انتهت فترتهم — أزلهم من البروفايل يدوياً ({endedProfile.length})</h2>
        {endedProfile.length === 0 ? <p className="card p-4 font-bold text-slate-500">لا يوجد.</p> : (
          <div className="space-y-2.5">{endedProfile.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-center gap-3 border-red-100 p-4">
              <div className="min-w-[180px] flex-1">
                <div className="font-extrabold">انتهى اشتراك «{r.customerName}» على {r.platformName}</div>
                <div className="text-[13px] font-semibold text-slate-500">الحساب <span dir="ltr" className="font-mono">{r.accountEmail}</span> — بروفايل {r.profileNo} • انتهى {fmtDate(r.endDate)}</div>
                <div className="text-xs font-semibold text-slate-400">اذهب للمنصة واحذف بروفايل العميل يدوياً، ثم اضغط الزر. لا تغيّر كلمة المرور — بقية البروفايلات تعمل.</div>
              </div>
              <a href={waLink(r.customerPhone, `مرحباً ${r.customerName}، انتهى اشتراكك في ${r.platformName}. للتجديد حوّل المبلغ وأرسل السند وسنفعّله فوراً — مايسترو كي`)} target="_blank" rel="noreferrer" className="btn-ghost text-xs"><MessageCircle size={15} className="text-[#1fa855]" /> إشعار العميل</a>
              <button disabled={busy} onClick={() => act({ action: "freeProfile", rentalId: r.id }, `تم تحرير بروفايل ${r.customerName} وإعادته للبيع`)} className="btn-danger text-xs"><UserMinus size={15} /> تمت إزالة العميل من البروفايل ✓</button>
            </div>
          ))}</div>
        )}
      </section>

      {/* Ended - full / password changes */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-black"><KeyRound className="text-[#2563eb]" size={20} /> حسابات بانتظار تغيير كلمة المرور ({needsPw.length})</h2>
        {needsPw.length === 0 ? <p className="card p-4 font-bold text-slate-500">لا يوجد.</p> : (
          <div className="space-y-2.5">{needsPw.map((a) => {
            const rel = endedFull.filter((r) => r.accountId === a.id);
            return (
              <div key={a.id} className="card flex flex-wrap items-center gap-3 border-amber-200 bg-white/[.04] p-4">
                <div className="min-w-[180px] flex-1">
                  <div className="font-extrabold" dir="ltr" style={{ textAlign: "right" }}>{a.email}</div>
                  <div className="text-[13px] font-semibold text-slate-500">{a.platformName} — {a.type === "FULL" ? "حساب كامل" : "أُفرغت كل بروفايلاته"}{rel.length ? ` • آخر عميل: ${rel.map((r) => r.customerName).join("، ")}` : ""}</div>
                  <div className="text-xs font-semibold text-slate-400">غيّر كلمة المرور في المنصة بنفسك أولاً لقطع وصول العميل السابق، ثم أكّد هنا ليعود الحساب للبيع.</div>
                </div>
                <button disabled={busy} onClick={() => setPwFor(a)} className="btn-gold text-sm"><KeyRound size={16} /> تم تغيير كلمة المرور</button>
              </div>
            );
          })}</div>
        )}
      </section>

      {/* Ending soon - whatsapp */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-black"><AlarmClock className="text-amber-600" size={20} /> ينتهون خلال يومين — تنبيه العميل ({endingSoon.length})</h2>
        {endingSoon.length === 0 ? <p className="card p-4 font-bold text-slate-500">لا يوجد.</p> : (
          <div className="space-y-2.5">{endingSoon.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[180px] flex-1">
                <div className="font-extrabold">{r.customerName} — {r.platformName}</div>
                <div className="text-[13px] font-semibold text-slate-500">ينتهي {fmtDate(r.endDate)} (بقي {daysLeft(r.endDate)} يوم) • <span dir="ltr">{r.customerPhone}</span></div>
              </div>
              {r.whatsappAlertSent ? <Badge tone="blue">أُرسل التنبيه التلقائي ✓ {fmtDate(r.whatsappAlertSentAt)}</Badge> : <Badge tone="amber">لم يُرسل بعد</Badge>}
              <button disabled={busy} onClick={async () => { const d = await act({ action: "sendWhatsapp", rentalId: r.id }, `تم تجهيز/إرسال تنبيه ${r.customerName}`); if (d?.message && d?.phone) window.open(waLink(d.phone, d.message), "_blank"); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1fa855] px-3.5 py-2.5 text-sm font-extrabold text-white hover:bg-[#178a45]"><MessageCircle size={16} /> إرسال واتساب الآن</button>
            </div>
          ))}</div>
        )}
      </section>

      {/* Pending receipts */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-black"><ReceiptText className="text-[#174ea6]" size={20} /> سندات تنتظر مراجعتك ({pendingPays.length})</h2>
        {pendingPays.length === 0 ? <p className="card p-4 font-bold text-slate-500">لا يوجد.</p> : (
          <div className="space-y-2.5">{pendingPays.map((p: any) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="min-w-[180px] flex-1">
                <span className="font-extrabold">{p.rental.customerName}</span> — {p.rental.platformName}
                <div className="text-[13px] font-semibold text-slate-500">🏦 {p.bankName} • <span dir="ltr" className="font-mono">{p.transactionRef}</span> • باع: {p.rental.sellerName}</div>
              </div>
              <ReceiptButton paymentId={p.id} />
              <button disabled={busy} onClick={() => act({ action: "confirmPayment", paymentId: p.id }, "تم تأكيد السند")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white"><Check size={14} /> تأكيد</button>
              <button disabled={busy} onClick={() => { setRejectFor(p); setRejectReason(""); }} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-red-700"><X size={14} /> رفض</button>
            </div>
          ))}</div>
        )}
      </section>

      {total === 0 && endingSoon.length === 0 && <Empty icon={<BellRing size={44} />} title="لا إجراءات مطلوبة 🎉" hint="كل الاشتراكات سليمة والسندات معتمدة." />}

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="🔑 تأكيد تغيير كلمة المرور">
        <p className="mb-3 text-sm font-semibold leading-relaxed text-slate-600">الحساب: <b dir="ltr">{pwFor?.email}</b><br />أدخل كلمة المرور الجديدة التي وضعتها فعلاً في المنصة. ستُشفَّر وتُحفظ، وسيعود الحساب «متاحاً للبيع» وتُغلق اشتراكات العملاء السابقين.</p>
        <label className="label">كلمة المرور الجديدة</label>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="NewPassword#2026" />
        <button disabled={busy || !newPw.trim()} onClick={() => act({ action: "confirmPasswordChange", accountId: pwFor.id, newPassword: newPw.trim() }, "تم تحديث كلمة المرور وإعادة الحساب للمخزون")} className="btn-gold mt-4 w-full">تأكيد وإعادة الحساب للمخزون</button>
      </Modal>

      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title="✖️ رفض السند">
        <p className="mb-3 text-sm font-semibold leading-relaxed text-slate-600">
          العميل: <b>{rejectFor?.rental?.customerName}</b> — {rejectFor?.rental?.platformName}<br />
          🏦 {rejectFor?.bankName} • <span dir="ltr" className="font-mono">{rejectFor?.transactionRef}</span><br />
          عند الرفض يُلغى الاشتراك ويُحرَّر الحساب/البروفايل تلقائياً، ويُسجَّل السبب في سجل التدقيق.
        </p>
        <label className="label">سبب الرفض</label>
        <input className="field" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="مثال: السند غير واضح / لم يصل التحويل / رقم عملية مكرر" />
        <div className="mt-2 flex flex-wrap gap-2">
          {["السند غير واضح", "لم يصل التحويل", "المبلغ غير مطابق", "رقم عملية مكرر"].map((r) => (
            <button key={r} type="button" onClick={() => setRejectReason(r)} className="rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">{r}</button>
          ))}
        </div>
        <button disabled={busy || !rejectReason.trim()} onClick={() => { act({ action: "rejectPayment", paymentId: rejectFor.id, reason: rejectReason.trim() }, `تم رفض سند ${rejectFor?.rental?.customerName} وإلغاء الاشتراك`); setRejectFor(null); }} className="btn-danger mt-4 w-full py-3">تأكيد الرفض وإلغاء الاشتراك</button>
      </Modal>
    </div>
  );
}
