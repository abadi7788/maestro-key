"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Boxes, Eye, EyeOff, KeyRound, Link2, Pencil, Plus, RotateCcw, Search, Trash2, XOctagon } from "lucide-react";
import { api, fmtDate, daysLeft } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, Spinner, accountBadge } from "@/components/ui";

const EMPTY_FORM = {
  platformId: 0, type: "PROFILE", maxProfiles: 5,
  email: "", password: "", pin: "", expiryDate: "", notes: "", salePrice: "",
  deliveryType: "CREDENTIALS", inviteLink: "", inviteMaxUses: "", licenseKey: "",
};

const D_TYPE = {
  CREDENTIALS: { label: "حساب", tone: "slate" },
  INVITE_LINK: { label: "رابط دعوة", tone: "blue" },
  LICENSE_KEY: { label: "كود", tone: "amber" },
} as const;

export default function AccountsManager({ trash = false }: { trash?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [q, setQ] = useState(""); const [platFilter, setPlatFilter] = useState("");
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [pwFor, setPwFor] = useState<any>(null); const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([api(`/api/accounts${trash ? "?trash=1" : ""}`).catch(() => ({ accounts: [] })), api("/api/meta").catch(() => null)]);
    setRows(a.accounts); setMeta(m);
  }, [trash]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 8000);

  async function act(body: any, okMsg: string, retryForce = false): Promise<boolean> {
    setBusy(true); setMsg("");
    try { await api("/api/actions", { method: "POST", body: JSON.stringify(body) }); setMsg("✓ " + okMsg); await load(); return true; }
    catch (e: any) {
      if (e.status === 409 && e.data?.needsConfirmation && !retryForce) {
        if (confirm(e.data.error)) return act({ ...body, force: true }, okMsg, true);
      }
      setMsg("⚠️ " + e.message); return false;
    } finally { setBusy(false); }
  }

  async function saveForm() {
    setBusy(true); setMsg("");
    try {
      if (editing) await api("/api/accounts", { method: "PUT", body: JSON.stringify({ id: editing.id, ...form }) });
      else await api("/api/accounts", { method: "POST", body: JSON.stringify(form) });
      setMsg(editing ? "✓ تم حفظ التعديلات" : "✓ تمت إضافة الحساب للمخزون"); setShowForm(false); setEditing(null); setForm(EMPTY_FORM); await load();
    } catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }

  async function reveal(id: number) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    try { const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "revealPassword", accountId: id }) }); setRevealed((s) => ({ ...s, [id]: d.password })); } catch {}
  }

  const filtered = (rows || []).filter((r) => (!q || (r.email || r.inviteLink || r.licenseKey || "").toLowerCase().includes(q.toLowerCase())) && (!platFilter || String(r.platformId) === platFilter));

  return (
    <div>
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">{msg}</div>}
      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className="field pr-10" placeholder="بحث بالإيميل / الرابط / الكود…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="field sm:w-52" value={platFilter} onChange={(e) => setPlatFilter(e.target.value)}>
          <option value="">كل المنصات</option>{meta?.platforms?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {!trash && <button onClick={() => { setEditing(null); setForm({ ...EMPTY_FORM, platformId: meta?.platforms?.[0]?.id || 0 }); setShowForm(true); }} className="btn-gold"><Plus size={18} /> إضافة حساب</button>}
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<Boxes size={44} />} title={trash ? "سلة المحذوفات فارغة" : "لا توجد حسابات"} hint={trash ? "الحسابات المحذوفة ناعماً ستظهر هنا مع سبب الحذف." : "أضف أول حساب للمخزون بالزر أعلاه."} /> : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {filtered.map((a) => {
            const dType = a.deliveryType || "CREDENTIALS";
            const dMeta = D_TYPE[dType as keyof typeof D_TYPE] || D_TYPE.CREDENTIALS;
            const expDays = a.expiryDate ? daysLeft(a.expiryDate) : null;
            const used = a.profiles?.filter((p: any) => p.isOccupied).length ?? 0;
            const isCreds = dType === "CREDENTIALS";
            const mainText = isCreds ? (a.email || "—") : dType === "INVITE_LINK" ? (a.inviteLink || "—") : (a.licenseKey || "—");
            return (
              <article key={a.id} className={`card p-4 ${a.status === "NEEDS_PASSWORD_CHANGE" && !trash ? "border-red-300 bg-red-500/10" : ""}`}>
                <div className="flex items-start gap-3">
                  <PlatformLogo src={a.platformImage} name={a.platformName} color={a.platformColor} size={48} />
                  <div className="min-w-0 flex-1">
                    <div dir="ltr" className="truncate text-right font-mono text-[15px] font-bold">{mainText}</div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-400">
                      {a.platformName} • {dMeta.label}
                      {isCreds ? (a.type === "FULL" ? " • حساب كامل (عميل واحد)" : ` • بروفايلات: ${used}/${a.maxProfiles} مشغول`) : null}
                      {" • "}
                      {a.expiryDate ? <>صلاحية الحساب حتى {fmtDate(a.expiryDate)} {expDays !== null && expDays < 0 ? <Badge tone="red">منتهي الصلاحية!</Badge> : expDays !== null && expDays <= 30 ? <Badge tone="amber">بقي {expDays} يوم</Badge> : <span className="text-slate-500">({expDays} يوم)</span>}</> : <span className="text-slate-500">بدون انتهاء</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {!trash && <Badge tone={dMeta.tone as any}>{dMeta.label}</Badge>}
                    {trash ? <Badge tone="red">محذوف</Badge> : accountBadge(a.status)}
                  </div>
                </div>

                {isCreds && a.type === "PROFILE" && a.profiles?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.profiles.map((p: any) => (
                      <span key={p.id} title={p.rental ? `${p.rental.customerName} حتى ${fmtDate(p.rental.endDate)}` : "فارغ"}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold ${p.isOccupied ? (p.rental?.status === "ENDED" ? "bg-red-100 text-red-300" : "bg-sky-100 text-sky-800") : "bg-emerald-100 text-emerald-300"}`}>
                        {p.isOccupied ? "👤" : "○"} بروفايل {p.profileNo}{p.rental ? `: ${p.rental.customerName.split(" ")[0]}${p.rental.status === "ENDED" ? " (انتهى)" : ""}` : " فارغ"}
                      </span>
                    ))}
                  </div>
                )}
                {!isCreds && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {dType === "INVITE_LINK" && a.inviteMaxUses ? <Badge tone="blue">🔁 استخدامات: {a.inviteMaxUses}</Badge> : null}
                    {dType === "INVITE_LINK" && a.inviteLink ? <span className="inline-flex items-center gap-1"><CopyBtn text={a.inviteLink} label="نسخ الرابط" /><Link2 size={14} className="text-slate-400" /></span> : null}
                    {dType === "LICENSE_KEY" && a.licenseKey ? <span className="inline-flex items-center gap-1"><CopyBtn text={a.licenseKey} label="نسخ الكود" /></span> : null}
                  </div>
                )}
                {isCreds && a.type === "FULL" && a.currentRentals?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">{a.currentRentals.map((r: any) => <Badge key={r.id} tone={r.status === "ENDED" ? "red" : "blue"}>👤 {r.customerName} — حتى {fmtDate(r.endDate)}{r.status === "ENDED" ? " (انتهى)" : ""}</Badge>)}</div>
                )}

                {revealed[a.id] && (
                  <div className="pop-in mt-3 flex items-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-white/[.04] px-3 py-2.5">
                    <div className="flex-1"><div className="text-[10px] font-bold text-slate-400">🔑 كلمة المرور (سُجّل عرضها في التدقيق)</div><div dir="ltr" className="text-left font-mono font-bold">{revealed[a.id]}</div></div>
                    <CopyBtn text={revealed[a.id]} />
                  </div>
                )}

                {trash ? (
                  <div className="mt-3 rounded-xl bg-white/[.04] px-3 py-2 text-xs font-semibold text-slate-500">حُذف {fmtDate(a.deletedAt)} — السبب: {a.deletedReason || "—"} • سجلات إيجار سابقة: {a.totalRentals}</div>
                ) : null}

                <div className="mt-3.5 flex flex-wrap gap-2 border-t border-dashed border-white/10 pt-3">
                  {!trash ? (
                    <>
                      {isCreds && a.hasPassword && (
                        <button onClick={() => reveal(a.id)} className="btn-ghost px-3 py-2 text-xs">{revealed[a.id] ? <EyeOff size={15} /> : <Eye size={15} />} {revealed[a.id] ? "إخفاء" : "عرض كلمة المرور"}</button>
                      )}
                      <button onClick={() => { setEditing(a); setForm({ ...EMPTY_FORM, platformId: a.platformId, type: a.type, maxProfiles: a.maxProfiles, email: a.email || "", pin: a.pin || "", expiryDate: a.expiryDate ? String(a.expiryDate).slice(0, 10) : "", notes: a.notes || "", salePrice: a.salePrice || "", deliveryType: dType, inviteLink: a.inviteLink || "", inviteMaxUses: a.inviteMaxUses || "", licenseKey: a.licenseKey || "" }); setShowForm(true); }} className="btn-ghost px-3 py-2 text-xs"><Pencil size={15} /> تعديل</button>
                      {a.status === "NEEDS_PASSWORD_CHANGE" && <button onClick={() => setPwFor(a)} className="btn-gold px-3 py-2 text-xs"><KeyRound size={15} /> تم تغيير كلمة المرور</button>}
                      {expDays !== null && expDays < 0 && <button disabled={busy} onClick={() => { if (confirm("هذا الحساب منتهي الصلاحية. هل تريد حذفه وإمكانية إضافة حساب جديد بدل منه؟")) act({ action: "deleteExpired", accountId: a.id }, "تم حذف الحساب منتهي الصلاحية"); }} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-red-700"><XOctagon size={15} /> حذف حساب منتهي</button>}
                      <button disabled={busy} onClick={() => { const reason = prompt("سبب نقل الحساب إلى سلة المحذوفات:") ?? ""; act({ action: "moveToTrash", accountId: a.id, reason }, "تم نقل الحساب إلى سلة المحذوفات (حذف ناعم)"); }} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-[#101828] px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10"><Trash2 size={15} /> حذف</button>
                    </>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => act({ action: "restore", accountId: a.id }, "تم استرجاع الحساب إلى المخزون")} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"><RotateCcw size={15} /> استرجاع للمخزون</button>
                      <button disabled={busy} onClick={() => { if (confirm("⚠️ حذف نهائي لا يمكن التراجع عنه. متأكد؟") && confirm("تأكيد أخير: سيُمسح الحساب من السيرفر نهائياً.")) act({ action: "permanentDelete", accountId: a.id }, "تم الحذف النهائي"); }} className="btn-danger px-3 py-2 text-xs"><XOctagon size={15} /> حذف نهائي</button>
                      {a.totalRentals > 0 && <span className="self-center text-[11px] font-bold text-slate-500">الحذف النهائي محظور لوجود سجل إيجارات مالي</span>}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add / edit */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "✏️ تعديل حساب" : "➕ إضافة حساب للمخزون"} wide>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="label">المنصة</label><select className="field" value={form.platformId || ""} onChange={(e) => setForm({ ...form, platformId: Number(e.target.value) })}>{meta?.platforms?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div>
            <label className="label">نوع التسليم</label>
            <select className="field" value={form.deliveryType || "CREDENTIALS"} onChange={(e) => setForm({ ...form, deliveryType: e.target.value })}>
              <option value="CREDENTIALS">بيانات حساب (إيميل + كلمة مرور)</option>
              <option value="INVITE_LINK">رابط دعوة / تفعيل</option>
              <option value="LICENSE_KEY">كود / مفتاح رقمي</option>
            </select>
          </div>

          {form.deliveryType === "CREDENTIALS" && (
            <>
              {!editing && <div><label className="label">نوع الحساب</label><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="PROFILE">ببروفايلات (عدة عملاء)</option><option value="FULL">حساب كامل (عميل واحد)</option></select></div>}
              {!editing && form.type === "PROFILE" && <div><label className="label">عدد البروفايلات</label><input type="number" min={2} max={10} className="field" value={form.maxProfiles} onChange={(e) => setForm({ ...form, maxProfiles: Number(e.target.value) })} /></div>}
              <div className={editing ? "sm:col-span-2" : ""}><label className="label">📧 إيميل الحساب (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="label">🔑 كلمة المرور {editing ? "(اتركها فارغة للإبقاء)" : "(اختياري)"}</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div><label className="label">PIN الحساب (اختياري)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></div>
              <div><label className="label">⏳ تاريخ انتهاء الحساب (اختياري)</label><input type="date" className="field" value={form.expiryDate || ""} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
            </>
          )}

          {form.deliveryType === "INVITE_LINK" && (
            <>
              <div className="sm:col-span-2"><label className="label">🔗 رابط الدعوة / التفعيل</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://…" value={form.inviteLink || ""} onChange={(e) => setForm({ ...form, inviteLink: e.target.value })} /></div>
              <div><label className="label">🔁 عدد مرات الاستخدام (اختياري)</label><input type="number" min={1} className="field" value={form.inviteMaxUses || ""} onChange={(e) => setForm({ ...form, inviteMaxUses: e.target.value.replace(/\D/g, "") })} /></div>
            </>
          )}

          {form.deliveryType === "LICENSE_KEY" && (
            <div className="sm:col-span-2"><label className="label">🎫 الكود / المفتاح</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.licenseKey || ""} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} /></div>
          )}

          <div><label className="label">💵 سعر البيع المقترح (ر.ي)</label><input className="field" inputMode="numeric" placeholder="يسجله المدير ويظهر للموظف" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value.replace(/\D/g, "") })} /></div>
          <div><label className="label">ملاحظات</label><input className="field" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-400">جميع الحقول التفصيلية اختيارية — المنصة فقط هي المطلوبة. كلمة المرور تُشفَّر قبل الحفظ. السعر الذي تسجله هنا يظهر للموظف ويمكنه تعديله عند البيع.</p>
        <button disabled={busy} onClick={saveForm} className="btn-gold sticky bottom-0 mt-5 w-full">{editing ? "حفظ التعديلات" : "إضافة للمخزون"}</button>
      </Modal>

      {/* Password change */}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="🔑 تأكيد تغيير كلمة المرور">
        <p className="mb-3 text-sm font-semibold text-slate-400">الحساب <b dir="ltr">{pwFor?.email || "—"}</b> — أدخل كلمة المرور الجديدة التي وضعتها في المنصة. سيعود الحساب «متاحاً للبيع».</p>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="NewPassword#2026" />
        <button disabled={busy || !newPw.trim()} onClick={async () => { if (await act({ action: "confirmPasswordChange", accountId: pwFor.id, newPassword: newPw.trim() }, "تم تحديث كلمة المرور وإعادة الحساب للمخزون")) { setPwFor(null); setNewPw(""); } }} className="btn-gold mt-4 w-full">تأكيد وإعادة للمخزون</button>
      </Modal>
    </div>
  );
}
