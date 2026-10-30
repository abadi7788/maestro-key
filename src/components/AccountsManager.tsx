"use client";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Boxes, Eye, EyeOff, KeyRound, Link2, Pencil, Plus, RotateCcw, Search, Ticket, Trash2, XOctagon } from "lucide-react";
import { api, fmtDate, daysLeft } from "@/lib/client";
import { Badge, CopyBtn, Empty, Modal, PlatformLogo, Spinner, accountBadge } from "@/components/ui";

interface ProfileItem {
  name: string;
  pin: string;
}

export default function AccountsManager({ trash = false }: { trash?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [q, setQ] = useState(""); const [platFilter, setPlatFilter] = useState("");
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<any>(null);

  const defaultProfiles: ProfileItem[] = [
    { name: "بروفايل 1", pin: "" },
    { name: "بروفايل 2", pin: "" },
    { name: "بروفايل 3", pin: "" },
    { name: "بروفايل 4", pin: "" },
    { name: "بروفايل 5", pin: "" }
  ];

  const emptyForm = { 
    type: "PROFILE", 
    deliveryKind: "CREDENTIALS", 
    maxProfiles: 5, 
    pin: "", 
    notes: "", 
    inviteLink: "", 
    licenseKey: "", 
    maxUses: "", 
    email: "", 
    password: "", 
    profilesList: defaultProfiles 
  };

  const [form, setForm] = useState<any>(emptyForm);
  const [revealed, setRevealed] = useState<Record<number, { password?: string; licenseKey?: string }>>({});
  const [pwFor, setPwFor] = useState<any>(null); const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([
      api(`/api/accounts${trash ? "?trash=1" : ""}`).catch(() => ({ accounts: [] })),
      api("/api/meta").catch(() => null)
    ]);
    setRows(a.accounts); setMeta(m);
  }, [trash]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 25000);


  async function act(body: any, okMsg: string, retryForce = false): Promise<boolean> {
    setBusy(true); setMsg("");
    try { 
      await api("/api/actions", { method: "POST", body: JSON.stringify(body) }); 
      setMsg("✓ " + okMsg); 
      await load(); 
      return true; 
    } catch (e: any) {
      if (e.status === 409 && e.data?.needsConfirmation && !retryForce) {
        if (confirm(e.data.error)) return act({ ...body, force: true }, okMsg, true);
      }
      setMsg("⚠️ " + e.message); 
      return false;
    } finally { setBusy(false); }
  }

  function addProfileSlot() {
    const nextIndex = (form.profilesList || []).length + 1;
    const updated = [...(form.profilesList || []), { name: `بروفايل ${nextIndex}`, pin: "" }];
    setForm({ ...form, profilesList: updated, maxProfiles: updated.length });
  }

  function removeProfileSlot(index: number) {
    const updated = (form.profilesList || []).filter((_: any, i: number) => i !== index);
    setForm({ ...form, profilesList: updated, maxProfiles: updated.length });
  }

  function updateProfileField(index: number, field: "name" | "pin", value: string) {
    const updated = [...(form.profilesList || [])];
    updated[index] = { ...updated[index], [field]: value };
    setForm({ ...form, profilesList: updated });
  }

  async function saveForm() {
    setBusy(true); setMsg("");
    try {
      const kind = form.deliveryKind === "INVITE_LINK" || form.deliveryKind === "LICENSE_KEY" ? form.deliveryKind : "CREDENTIALS";
      if (!editing) {
        if (kind === "INVITE_LINK" && !String(form.inviteLink || "").trim()) { setMsg("⚠️ أدخل رابط الدعوة / التفعيل"); setBusy(false); return; }
        if (kind === "LICENSE_KEY" && !String(form.licenseKey || "").trim()) { setMsg("⚠️ أدخل الكود / المفتاح الرقمي"); setBusy(false); return; }
        if (kind === "CREDENTIALS" && !String(form.email || "").trim() && !String(form.password || "")) { setMsg("⚠️ أدخل الإيميل أو كلمة المرور على الأقل"); setBusy(false); return; }
      }

      const payload = { ...form };
      if (payload.type === "FULL") {
        delete payload.pin;
        delete payload.profilesList;
      }

      if (editing) await api("/api/accounts", { method: "PUT", body: JSON.stringify({ id: editing.id, ...payload }) });
      else await api("/api/accounts", { method: "POST", body: JSON.stringify(payload) });

      setMsg(editing ? "✓ تم حفظ التعديلات" : "✓ تمت إضافة الحساب للمخزون"); 
      setShowForm(false); 
      setEditing(null); 
      setForm(emptyForm); 
      await load();
    } catch (e: any) { 
      setMsg("⚠️ " + e.message); 
    } finally { 
      setBusy(false); 
    }
  }

  async function reveal(id: number) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    try { 
      const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "revealPassword", accountId: id }) }); 
      setRevealed((s) => ({ ...s, [id]: { password: d.password, licenseKey: d.licenseKey } })); 
    } catch {}
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
        {!trash ? (
          <button 
            onClick={() => { 
              setEditing(null); 
              setForm({ ...emptyForm, platformId: meta?.platforms?.[0]?.id }); 
              setShowForm(true); 
            }} 
            className="btn-gold"
          >
            <Plus size={18} /> إضافة حساب
          </button>
        ) : (
          <button
            disabled={busy || (rows || []).length === 0}
            onClick={() => {
              if (confirm("⚠️ هل تريد إفراغ سلة المحذوفات بالكامل؟ سيتم مسح الحسابات التي ليس لها سجلات إيجار نهائياً من قاعدة البيانات.")) {
                act({ action: "emptyTrash" }, "تم تنفيذ أمر إفراغ السلة");
              }
            }}
            className="btn-danger"
          >
            <Trash2 size={16} /> إفراغ السلة بالكامل
          </button>
        )}
      </div>

      {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<Boxes size={44} />} title={trash ? "سلة المحذوفات فارغة" : "لا توجد حسابات"} hint={trash ? "الحسابات المحذوفة ناعماً ستظهر هنا مع سبب الحذف." : "أضف أول حساب للمخزون بالزر أعلاه."} /> : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {filtered.map((a) => {
            const expDays = a.expiryDate ? daysLeft(a.expiryDate) : null;
            const used = a.profiles?.filter((p: any) => p.isOccupied).length ?? 0;
            const kind = kindOf(a);
            const title = kind === "INVITE_LINK" ? (a.inviteLink || "رابط دعوة") : kind === "LICENSE_KEY" ? "🎟️ كود ترخيص" : (a.email || "بدون إيميل");
            return (
              <article key={a.id} className={`card overflow-hidden w-full max-w-full min-w-0 p-4 ${a.status === "NEEDS_PASSWORD_CHANGE" && !trash ? "border-red-400 bg-red-500/10" : ""}`}>
                {/* رأس البطاقة: المنصة وشارة الحالة */}
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5 mb-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlatformLogo src={a.platformImage} name={a.platformName} color={a.platformColor} size={36} />
                    <div className="min-w-0">
                      <span className="font-extrabold text-sm text-white truncate block">{a.platformName}</span>
                      <span className="text-[11px] font-semibold text-slate-400">
                        {kind === "CREDENTIALS" ? (a.type === "FULL" ? "حساب كامل (عميل واحد)" : `بروفايلات: ${used}/${a.maxProfiles} مشغول`) : "تسليم مباشر"}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {trash ? <Badge tone="red">محذوف</Badge> : accountBadge(a.status)}
                  </div>
                </div>

                {/* حقل الإيميل / الرابط بكامل عرض البطاقة مع كسر الكلمات وعدم تمدد الشاشة */}
                <div className="w-full min-w-0 overflow-hidden rounded-xl bg-white/[.04] p-2.5 border border-white/5">
                  <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-400 mb-1">
                    <span>{kind === "INVITE_LINK" ? "🔗 رابط الدعوة / التفعيل" : kind === "LICENSE_KEY" ? "🎟️ كود الترخيص" : "📧 إيميل الحساب"}</span>
                    <CopyBtn text={title} label="نسخ" />
                  </div>
                  <div dir="ltr" className="font-mono text-xs sm:text-sm font-black text-white break-all select-all leading-relaxed">
                    {title}
                  </div>
                </div>

                {/* الشارات الإضافية والصلاحية */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {kind === "INVITE_LINK" ? <Badge tone="blue">🔗 رابط دعوة</Badge> : kind === "LICENSE_KEY" ? <Badge tone="gold">🎟️ كود ترخيص</Badge> : <Badge>📧 بيانات حساب</Badge>}
                  {kind !== "CREDENTIALS" && <Badge tone={a.maxUses != null && (a.usedCount ?? 0) >= a.maxUses ? "red" : "slate"}>الاستخدام: {a.usedCount ?? 0}{a.maxUses != null ? `/${a.maxUses}` : " (بلا حد)"}</Badge>}
                  {a.expiryDate ? (
                    expDays !== null && expDays < 0 ? <Badge tone="red">منتهي الصلاحية ({fmtDate(a.expiryDate)})</Badge> :
                    expDays !== null && expDays <= 30 ? <Badge tone="amber">بقي {expDays} يوم ({fmtDate(a.expiryDate)})</Badge> :
                    <span className="text-xs text-slate-400 font-semibold">حتى {fmtDate(a.expiryDate)} ({expDays} يوم)</span>
                  ) : <Badge tone="gold">♾️ بدون انتهاء</Badge>}
                </div>


                {a.type === "PROFILE" && a.profiles?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.profiles.map((p: any) => (
                      <span key={p.id} title={p.rental ? `${p.rental.customerName} حتى ${fmtDate(p.rental.endDate)}` : "فارغ"}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold ${p.isOccupied ? (p.rental?.status === "ENDED" ? "bg-red-100 text-red-300" : "bg-sky-100 text-sky-800") : "bg-emerald-100 text-emerald-300"}`}>
                        <span>{p.isOccupied ? "👤" : "○"} {p.name || `بروفايل ${p.profileNo}`}{p.pin ? ` (PIN: ${p.pin})` : ""}{p.rental ? `: ${p.rental.customerName.split(" ")[0]}${p.rental.status === "ENDED" ? " (انتهى)" : ""}` : " فارغ"}</span>
                        {p.isOccupied && !trash && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act({ action: "restoreProfile", profileId: p.id }, `تم استرجاع ${p.name || `بروفايل ${p.profileNo}`} للبيع مجدداً`)}
                            className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-amber-200 transition hover:bg-black/50"
                            title="استرجاع يدوي لهذا البروفايل ليكون متاحاً للبيع مجدداً"
                          >
                            ↺ استرجاع
                          </button>
                        )}
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
                      <button onClick={() => { 
                        setEditing(a); 
                        setForm({ 
                          email: a.email || "", 
                          pin: a.pin || "", 
                          notes: a.notes || "", 
                          expiryDate: a.expiryDate ? String(a.expiryDate).slice(0, 10) : "", 
                          noExpiry: !a.expiryDate, 
                          platformId: a.platformId, 
                          deliveryKind: kind, 
                          inviteLink: a.inviteLink || "", 
                          licenseKey: "", 
                          maxUses: a.maxUses ?? "", 
                          salePrice: a.salePrice ?? "",
                          type: a.type || "PROFILE",
                          profilesList: a.profiles?.length > 0 ? a.profiles.map((p: any) => ({ name: p.name || `بروفايل ${p.profileNo}`, pin: p.pin || "" })) : defaultProfiles
                        }); 
                        setShowForm(true); 
                      }} className="btn-ghost px-3 py-2 text-xs"><Pencil size={15} /> تعديل</button>
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

      {/* Add / edit Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "✏️ تعديل حساب" : "➕ إضافة حساب للمخزون"} wide>
        <div className="max-h-[75vh] overflow-y-auto overscroll-contain pr-1">
          <div>
            <label className="label">المنصة <span className="text-red-400">*</span></label>
            <select className="field" value={form.platformId || ""} onChange={(e) => setForm({ ...form, platformId: Number(e.target.value) })}>
              {meta?.platforms?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="mt-4">
            <label className="label">📦 صيغة التسليم</label>
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
                <div className="sm:col-span-2">
                  <label className="label">🔗 رابط الدعوة / التفعيل <span className="text-red-400">*</span></label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://..." value={form.inviteLink || ""} onChange={(e) => setForm({ ...form, inviteLink: e.target.value })} />
                </div>
                <div>
                  <label className="label">عدد مرات الاستخدام (اختياري — فارغ = بلا حد)</label>
                  <input className="field" inputMode="numeric" placeholder="مثال: 5" value={form.maxUses ?? ""} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, "") })} />
                </div>
              </>
            )}

            {form.deliveryKind === "LICENSE_KEY" && (
              <div className="sm:col-span-2">
                <label className="label">🎟️ الكود / المفتاح الرقمي <span className="text-red-400">*</span></label>
                <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="XXXX-XXXX-XXXX" value={form.licenseKey || ""} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} />
                {editing && <p className="mt-1 text-[11px] font-semibold text-slate-500">اتركه فارغاً للإبقاء على الكود الحالي.</p>}
              </div>
            )}

            {(form.deliveryKind === "CREDENTIALS" || !form.deliveryKind) && (
              <>
                {!editing && (
                  <div className="sm:col-span-2">
                    <label className="label">نوع الحساب</label>
                    <select 
                      className="field" 
                      value={form.type} 
                      onChange={(e) => setForm({ ...form, type: e.target.value, pin: e.target.value === "FULL" ? "" : form.pin })}
                    >
                      <option value="PROFILE">ببروفايلات (عدة عملاء)</option>
                      <option value="FULL">حساب كامل (عميل واحد)</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="label">📧 إيميل الحساب المشترك <span className="font-semibold text-slate-500">(اختياري)</span></label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>

                <div>
                  <label className="label">🔑 كلمة المرور المشتركة <span className="font-semibold text-slate-500">(اختياري{editing ? " — فارغ للإبقاء" : ""})</span></label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>

                {/* ديناميكية البروفايلات (تظهر فقط عند اختيار PROFILE) */}
                {form.type === "PROFILE" && (
                  <div className="rounded-2xl border border-white/10 bg-white/[.02] p-3.5 sm:col-span-2">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-black text-amber-300">👥 قائمة البروفايلات والـ PIN التابع لها</span>
                        <p className="text-[11px] text-slate-400">حدد أسماء البروفايلات والرمز السري الخاص بكل ملف</p>
                      </div>
                      <button 
                        type="button" 
                        onClick={addProfileSlot} 
                        className="flex items-center gap-1 rounded-xl bg-amber-400/20 px-3 py-1.5 text-xs font-black text-amber-300 hover:bg-amber-400/30"
                      >
                        <Plus size={14} /> إضافة بروفايل
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {(form.profilesList || []).map((prof: ProfileItem, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input 
                            className="field flex-1 text-xs" 
                            placeholder={`اسم البروفايل (مثال: بروفايل ${idx + 1})`} 
                            value={prof.name} 
                            onChange={(e) => updateProfileField(idx, "name", e.target.value)} 
                          />
                          <input 
                            className="field w-28 text-center text-xs font-mono" 
                            placeholder="PIN الملف" 
                            maxLength={8}
                            value={prof.pin} 
                            onChange={(e) => updateProfileField(idx, "pin", e.target.value)} 
                          />
                          {(form.profilesList || []).length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => removeProfileSlot(idx)} 
                              className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-400 hover:bg-red-500/20"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

            <div>
              <label className="label">💵 سعر البيع المقترح (ر.ي) <span className="font-semibold text-slate-500">(اختياري)</span></label>
              <input className="field" inputMode="numeric" placeholder="يسجله المدير ويظهر للموظف" value={form.salePrice || ""} onChange={(e) => setForm({ ...form, salePrice: e.target.value.replace(/\D/g, "") })} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">ملاحظات <span className="font-semibold text-slate-500">(اختياري)</span></label>
              <input className="field" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-400">كلمات المرور والأكواد تُشفَّر قبل الحفظ. كل الحقول التفصيلية اختيارية — يكفي إدخال بيانات صيغة التسليم المختارة.</p>
        </div>

        <button disabled={busy} onClick={saveForm} className="btn-gold sticky bottom-0 mt-5 w-full">
          {editing ? "حفظ التعديلات" : "إضافة للمخزون"}
        </button>
      </Modal>

      {/* Password change Modal */}
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title="🔑 تأكيد تغيير كلمة المرور">
        <p className="mb-3 text-sm font-semibold text-slate-600">الحساب <b dir="ltr">{pwFor?.email || `#${pwFor?.id}`}</b> — أدخل كلمة المرور الجديدة التي وضعتها في المنصة. سيعود الحساب «متاحاً للبيع».</p>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="NewPassword#2026" />
        <button disabled={busy || !newPw.trim()} onClick={async () => { if (await act({ action: "confirmPasswordChange", accountId: pwFor.id, newPassword: newPw.trim() }, "تم تحديث كلمة المرور وإعادة الحساب للمخزون")) { setPwFor(null); setNewPw(""); } }} className="btn-gold mt-4 w-full">تأكيد وإعادة للمخزون</button>
      </Modal>
    </div>
  );
}    
