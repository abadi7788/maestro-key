"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Boxes, Eye, EyeOff, KeyRound, Link2, Pencil, Plus, RotateCcw, Search, Ticket, Trash2, XOctagon } from "lucide-react";
import { api, fmtDate, daysLeft } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, Spinner, accountBadge } from "@/components/ui";

export default function AccountsManager({ trash = false }: { trash?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [q, setQ] = useState(""); const [platFilter, setPlatFilter] = useState("");
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<any>(null);
  const emptyForm = { type: "PROFILE", deliveryKind: "CREDENTIALS", maxProfiles: 5, pin: "", notes: "", inviteLink: "", licenseKey: "", maxUses: "" };
  const [form, setForm] = useState<any>(emptyForm);
  const [revealed, setRevealed] = useState<Record<number, { password?: string; licenseKey?: string }>>({});
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
      const kind = form.deliveryKind === "INVITE_LINK" || form.deliveryKind === "LICENSE_KEY" ? form.deliveryKind : "CREDENTIALS";
      if (!editing) {
        if (kind === "INVITE_LINK" && !String(form.inviteLink || "").trim()) { setMsg("⚠️ أدخل رابط الدعوة / التفعيل"); setBusy(false); return; }
        if (kind === "LICENSE_KEY" && !String(form.licenseKey || "").trim()) { setMsg("⚠️ أدخل الكود / المفتاح الرقمي"); setBusy(false); return; }
        if (kind === "CREDENTIALS" && !String(form.email || "").trim() && !String(form.password || "")) { setMsg("⚠️ أدخل الإيميل أو كلمة المرور على الأقل (باقي الحقول اختيارية)"); setBusy(false); return; }
      }
      if (editing) await api("/api/accounts", { method: "PUT", body: JSON.stringify({ id: editing.id, ...form }) });
      else await api("/api/accounts", { method: "POST", body: JSON.stringify(form) });
      setMsg(editing ? "✓ تم حفظ التعديلات" : "✓ تمت إضافة الحساب للمخزون"); setShowForm(false); setEditing(null); setForm(emptyForm); await load();
    } catch (e: any) { setMsg("⚠️ " + e.message); } finally { setBusy(false); }
  }

  async function reveal(id: number) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    try { const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "revealPassword", accountId: id }) }); setRevealed((s) => ({ ...s, [id]: { password: d.password, licenseKey: d.licenseKey } })); } catch {}
  }

  const kindOf = (a: any) => a.deliveryKind === "INVITE_LINK" || a.deliveryKind === "LICENSE_KEY" ? a.deliveryKind : "CREDENTIALS";
  const filtered = (rows || []).filter((r) => {
    if (platFilter && String(r.platformId) !== platFilter) return false;
    if (!q) return true;
    const hay = `${r.email || ""} ${r.inviteLink || ""} ${r.notes || ""} ${r.platformName || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div>
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 px-4 py-3 font-bold text-emerald-300">{msg}</div>}
      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className="field pr-10" placeholder="بحث بالإيميل…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="field sm:w-52" value={platFilter} onChange={(e) => setPlatFilter(e.target.value)}>
          <option value="">كل المنصات</option>{meta?.platforms?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {!trash && <button onClick={() => { setEditing(null); setForm({ ...emptyForm, platformId: meta?.platforms?.[0]?.id }); setShowForm(true); }} className="btn-gold"><Plus size={18} /> إضافة حساب</button>}
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<Boxes size={44} />} title={trash ? "سلة المحذوفات فارغة" : "لا توجد حسابات"} hint={trash ? "الحسابات المحذوفة ناعماً ستظهر هنا مع سبب الحذف." : "أضف أول حساب للمخزون بالزر أعلاه."} /> : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {filtered.map((a) => {
            const expDays = a.expiryDate ? daysLeft(a.expiryDate) : null;
            const used = a.profiles?.filter((p: any) => p.isOccupied).length ?? 0;
            const kind = kindOf(a);
            const title = kind === "INVITE_LINK" ? (a.inviteLink || "رابط دعوة") : kind === "LICENSE_KEY" ? "🎟️ كود ترخيص" : (a.email || "بدون إيميل");
            return (
              <article key={a.id} className={`card p-4.5 p-4 ${a.status === "NEEDS_PASSWORD_CHANGE" && !trash ? "border-red-300 bg-red-500/10/40" : ""}`}>
                <div className="flex items-start gap-3">
                  <PlatformLogo src={a.platformImage} name={a.platformName} color={a.platformColor} size={48} />
                  <div className="min-w-0 flex-1">
                    <div dir="ltr" className="truncate text-right font-mono text-[15px] font-bold">{title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {kind === "INVITE_LINK" ? <Badge tone="blue">🔗 رابط دعوة</Badge> : kind === "LICENSE_KEY" ? <Badge tone="gold">🎟️ كود ترخيص</Badge> : <Badge>📧 بيانات حساب</Badge>}
                      {kind !== "CREDENTIALS" && <Badge tone={a.maxUses != null && (a.usedCount ?? 0) >= a.maxUses ? "red" : "slate"}>الاستخدام: {a.usedCount ?? 0}{a.maxUses != null ? `/${a.maxUses}` : " (بلا حد)"}</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">{a.platformName} • {kind === "CREDENTIALS" ? (a.type === "FULL" ? "حساب كامل (عميل واحد)" : `بروفايلات: ${used}/${a.maxProfiles} مشغول`) : "تسليم مباشر"} • {a.expiryDate ? <>حتى {fmtDate(a.expiryDate)} {expDays !== null && expDays < 0 ? <Badge tone="red">منتهي الصلاحية!</Badge> : expDays !== null && expDays <= 30 ? <Badge tone="amber">بقي {expDays} يوم</Badge> : <span className="text-slate-400">({expDays} يوم)</span>}</> : <Badge tone="gold">♾️ بدون انتهاء</Badge>}</div>
                  </div>
                  {trash ? <Badge tone="red">محذوف</Badge> : accountBadge(a.status)}
                </div>

                {a.type === "PROFILE" && a.profiles?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.profiles.map((p: any) => (
                      <span key={p.id} title={p.rental ? `${p.rental.customerName} حتى ${fmtDate(p.rental.endDate)}` : "فارغ"}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold ${p.isOccupied ? (p.rental?.status === "ENDED" ? "bg-red-100 text-red-300" : "bg-sky-100 text-sky-800") : "bg-emerald-100 text-emerald-300"}`}>
                        {p.isOccupied ? "👤" : "○"} بروفايل {p.profileNo}{p.rental ? `: ${p.rental.customerName.split(" ")[0]}${p.rental.status === "ENDED" ? " (انتهى)" : ""}` : " فارغ"}
                      </span>
                    ))}
                  </div>
                )}
                {a.type === "FULL" && a.currentRentals?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">{a.currentRentals.map((r: any) => <Badge key={r.id} tone={r.status === "ENDED" ? "red" : "blue"}>👤 {r.customerName} — حتى {fmtDate(r.endDate)}{r.status === "ENDED" ? " (انتهى)" : ""}</Badge>)}</div>
                )}

                {kind === "INVITE_LINK" && a.inviteLink && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5">
                    <div className="min-w-0 flex-1"><div className="text-[10px] font-bold text-slate-400">🔗 رابط الدعوة</div><div dir="ltr" className="truncate text-left font-mono text-[13px] font-bold text-sky-200">{a.inviteLink}</div></div>
                    <CopyBtn text={a.inviteLink} />
                  </div>
                )}

                {revealed[a.id] && (revealed[a.id].password || revealed[a.id].licenseKey) && (
                  <div className="pop-in mt-3 space-y-2">
                    {revealed[a.id].password && (
                      <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-white/[.04] px-3 py-2.5">
                        <div className="flex-1"><div className="text-[10px] font-bold text-slate-400">🔑 كلمة المرور (سُجّل عرضها في التدقيق)</div><div dir="ltr" className="text-left font-mono font-bold">{revealed[a.id].password}</div></div>
                        <CopyBtn text={revealed[a.id].password || ""} />
                      </div>
                    )}
                    {revealed[a.id].licenseKey && (
                      <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-white/[.04] px-3 py-2.5">
                        <div className="flex-1"><div className="text-[10px] font-bold text-slate-400">🎟️ الكود / المفتاح (سُجّل عرضه في التدقيق)</div><div dir="ltr" className="text-left font-mono font-bold">{revealed[a.id].licenseKey}</div></div>
                        <CopyBtn text={revealed[a.id].licenseKey || ""} />
                      </div>
                    )}
                  </div>
                )}

                {trash ? (
                  <div className="mt-3 rounded-xl bg-white/[.04] px-3 py-2 text-xs font-semibold text-slate-500">حُذف {fmtDate(a.deletedAt)} — السبب: {a.deletedReason || "—"} • سجلات إيجار سابقة: {a.totalRentals}</div>
                ) : null}

                <div className="mt-3.5 flex flex-wrap gap-2 border-t border-dashed border-white/10 pt-3">
                  {!trash ? (
                    <>
                      {(kind === "CREDENTIALS" || (kind === "LICENSE_KEY" && a.hasLicenseKey)) && (
                        <button onClick={() => reveal(a.id)} className="btn-ghost px-3 py-2 text-xs">{revealed[a.id] ? <EyeOff size={15} /> : <Eye size={15} />} {revealed[a.id] ? "إخفاء" : kind === "LICENSE_KEY" ? "عرض الكود" : "عرض كلمة المرور"}</button>
                      )}
                      <button onClick={() => { setEditing(a); setForm({ email: a.email || "", pin: a.pin || "", notes: a.notes || "", expiryDate: a.expiryDate ? String(a.expiryDate).slice(0, 10) : "", noExpiry: !a.expiryDate, platformId: a.platformId, deliveryKind: kind, inviteLink: a.inviteLink || "", licenseKey: "", maxUses: a.maxUses ?? "", salePrice: a.salePrice ?? "" }); setShowForm(true); }} className="btn-ghost px-3 py-2 text-xs"><Pencil size={15} /> تعديل</button>
                      {a.status === "NEEDS_PASSWORD_CHANGE" && <button onClick={() => setPwFor(a)} className="btn-gold px-3 py-2 text-xs"><KeyRound size={15} /> تم تغيير كلمة المرور</button>}
                      {expDays !== null && expDays < 0 && <button disabled={busy} onClick={() => { if (confirm("هذا الحساب منتهي الصلاحية. هل تريد حذفه وإمكانية إضافة حساب جديد بدل منه؟")) act({ action: "deleteExpired", accountId: a.id }, "تم حذف الحساب منتهي الصلاحية"); }} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-red-700"><XOctagon size={15} /> حذف حساب منتهي</button>}
                      <button disabled={busy} onClick={() => { const reason = prompt("سبب نقل الحساب إلى سلة المحذوفات:") ?? ""; act({ action: "moveToTrash", accountId: a.id, reason }, "تم نقل الحساب إلى سلة المحذوفات (حذف ناعم)"); }} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-[#101828] px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10"><Trash2 size={15} /> حذف</button>
                    </>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => act({ action: "restore", accountId: a.id }, "تم استرجاع الحساب إلى المخزون")} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"><RotateCcw size={15} /> استرجاع للمخزون</button>
                      <button disabled={busy} onClick={() => { if (confirm("⚠️ حذف نهائي لا يمكن التراجع عنه. متأكد؟") && confirm("تأكيد أخير: سيُمسح الحساب من السيرفر نهائياً.")) act({ action: "permanentDelete", accountId: a.id }, "تم الحذف النهائي"); }} className="btn-danger px-3 py-2 text-xs"><XOctagon size={15} /> حذف نهائي</button>
                      {a.totalRentals > 0 && <span className="self-center text-[11px] font-bold text-slate-400">الحذف النهائي محظور لوجود سجل إيجارات مالي</span>}
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
        <div><label className="label">المنصة <span className="text-red-400">*</span></label><select className="field" value={form.platformId || ""} onChange={(e) => setForm({ ...form, platformId: Number(e.target.value) })}>{meta?.platforms?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="mt-4"><label className="label">📦 صيغة التسليم</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { v: "CREDENTIALS", t: "بيانات حساب", d: "إيميل + باسورد", icon: <KeyRound size={17} /> },
              { v: "INVITE_LINK", t: "رابط دعوة", d: "رابط تفعيل فقط", icon: <Link2 size={17} /> },
              { v: "LICENSE_KEY", t: "كود رقمي", d: "مفتاح ترخيص فقط", icon: <Ticket size={17} /> },
            ].map((o) => (
              <button key={o.v} type="button" onClick={() => setForm({ ...form, deliveryKind: o.v })}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-3.5 py-3 text-right transition ${form.deliveryKind === o.v ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-white/[.03] hover:border-white/25"}`}>
                <span className="text-amber-300">{o.icon}</span>
                <span><span className="block text-[13px] font-black text-white">{o.t}</span><span className="block text-[11px] font-semibold text-slate-400">{o.d}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {form.deliveryKind === "INVITE_LINK" && (
            <>
              <div className="sm:col-span-2"><label className="label">🔗 رابط الدعوة / التفعيل <span className="text-red-400">*</span></label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://..." value={form.inviteLink || ""} onChange={(e) => setForm({ ...form, inviteLink: e.target.value })} /></div>
              <div><label className="label">عدد مرات الاستخدام (اختياري — فارغ = بلا حد)</label><input className="field" inputMode="numeric" placeholder="مثال: 5" value={form.maxUses ?? ""} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} /></div>
            </>
          )}
          {form.deliveryKind === "LICENSE_KEY" && (
            <div className="sm:col-span-2"><label className="label">🎟️ الكود / المفتاح الرقمي <span className="text-red-400">*</span></label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="XXXX-XXXX-XXXX" value={form.licenseKey || ""} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} />{editing && <p className="mt-1 text-[11px] font-semibold text-slate-500">اتركه فارغاً للإبقاء على الكود الحالي.</p>}</div>
          )}
          {(form.deliveryKind === "CREDENTIALS" || !form.deliveryKind) && (
            <>
              {!editing && <div><label className="label">نوع الحساب</label><select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="PROFILE">ببروفايلات (عدة عملاء)</option><option value="FULL">حساب كامل (عميل واحد)</option></select></div>}
              {!editing && form.type === "PROFILE" && <div><label className="label">عدد البروفايلات <span className="font-semibold text-slate-500">(اختياري — الافتراضي 5)</span></label><input type="number" min={1} max={10} className="field" placeholder="5" value={form.maxProfiles ?? ""} onChange={(e) => setForm({ ...form, maxProfiles: e.target.value === "" ? "" : Number(e.target.value) })} /></div>}
              <div><label className="label">📧 إيميل الحساب <span className="font-semibold text-slate-500">(اختياري)</span></label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="label">🔑 كلمة المرور <span className="font-semibold text-slate-500">(اختياري{editing ? " — فارغ للإبقاء" : ""})</span></label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div><label className="label">PIN الحساب <span className="font-semibold text-slate-500">(اختياري)</span></label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></div>
            </>
          )}
          <div>
            <label className="label">⏳ تاريخ انتهاء الحساب <span className="font-semibold text-slate-500">(اختياري)</span></label>
            <input type="date" className="field" value={form.expiryDate || ""} disabled={!!form.noExpiry} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-bold text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-[#c99327]" checked={!!form.noExpiry} onChange={(e) => setForm({ ...form, noExpiry: e.target.checked, expiryDate: e.target.checked ? "" : form.expiryDate })} />
              ♾️ بدون انتهاء (للاشتراكات الدائمة)
            </label>
          </div>
          <div><label className="label">💵 سعر البيع المقترح (ر.ي) <span className="font-semibold text-slate-500">(اختياري)</span></label><input className="field" inputMode="numeric" placeholder="يسجله المدير ويظهر للموظف" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value.replace(/\D/g, "") })} /></div>
          <div className="sm:col-span-2"><label className="label">ملاحظات <span className="font-semibold text-slate-500">(اختياري)</span></label><input className="field" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-400">كلمات المرور والأكواد تُشفَّر قبل الحفظ. كل الحقول التفصيلية اختيارية — يكفي إدخال بيانات صيغة التسليم المختارة.</p>
        <button disabled={busy} onClick={saveForm} className="btn-gold sticky bottom-0 mt-5 w-full">{editing ? "حفظ التعديلات" : "إضافة للمخزون"}</button>
      </Modal>

      {/* Password change */}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="🔑 تأكيد تغيير كلمة المرور">
        <p className="mb-3 text-sm font-semibold text-slate-600">الحساب <b dir="ltr">{pwFor?.email || `#${pwFor?.id}`}</b> — أدخل كلمة المرور الجديدة التي وضعتها في المنصة. سيعود الحساب «متاحاً للبيع».</p>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="NewPassword#2026" />
        <button disabled={busy || !newPw.trim()} onClick={async () => { if (await act({ action: "confirmPasswordChange", accountId: pwFor.id, newPassword: newPw.trim() }, "تم تحديث كلمة المرور وإعادة الحساب للمخزون")) { setPwFor(null); setNewPw(""); } }} className="btn-gold mt-4 w-full">تأكيد وإعادة للمخزون</button>
      </Modal>
    </div>
  );
}
