"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, ImagePlus, MessageCircle, MonitorPlay, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
import { api, fetchMe, fileToDataUrl, fmtDateTime } from "@/lib/client";
import { Badge, PlatformLogo, Spinner } from "@/components/ui";
import { isAdminRole } from "@/lib/roles";

const TABS = [
  { id: "whatsapp", label: "قوالب واتساب", icon: <MessageCircle size={18} /> },
  { id: "platforms", label: "المنصات", icon: <MonitorPlay size={18} /> },
  { id: "banks", label: "البنوك والدفع", icon: <Building2 size={18} /> },
  { id: "users", label: "المستخدمون والصلاحيات", icon: <Users size={18} /> },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("whatsapp");
  const [data, setData] = useState<any>(null); const [tpl, setTpl] = useState<any>({});
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [newPlat, setNewPlat] = useState({ name: "", color: "#0f172a", shortName: "", imageUrl: "" });
  const [editPlat, setEditPlat] = useState<any>(null);
  const [newBank, setNewBank] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", displayName: "", role: "EMPLOYEE" });
  const [meId, setMeId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const d = await api("/api/admin-data?view=settings").catch(() => null);
    setData(d); if (d) setTpl(d.settings || {});
    fetchMe().then((u) => setMeId(u?.id ?? null)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function manage(body: any, ok: string): Promise<boolean> {
    setBusy(true); setMsg("");
    try { await api("/api/manage", { method: "POST", body: JSON.stringify(body) }); setMsg("✓ " + ok); await load(); return true; }
    catch (e: any) { setMsg("⚠️ " + e.message); return false; } finally { setBusy(false); }
  }

  if (!data) return <Spinner />;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">⚙️ الإعدادات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-500">للمدير فقط — قوالب الرسائل، المنصات، البنوك، وحسابات الموظفين وصلاحياتهم.</p>
      {msg && <div className={`mb-4 rounded-2xl px-4 py-3 font-bold ${msg.startsWith("⚠️") ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{msg}</div>}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-extrabold transition ${tab === t.id ? "bg-[#0e1526] text-white shadow" : "bg-[#101828] text-slate-600 border border-white/10"}`}>{t.icon}{t.label}</button>
        ))}
      </div>

      {tab === "whatsapp" && (
        <div className="space-y-4">
          <div className="card border-emerald-200 bg-emerald-500/10/60 p-4 text-sm font-semibold leading-relaxed text-emerald-900">
            المتغيرات المتاحة داخل القوالب: <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{name}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{platform}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{email}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{password}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{profile}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{end_date}}"}</code> <code className="rounded bg-[#101828] px-1.5 py-0.5 font-mono text-xs">{"{{days}}"}</code>
            <br />الإرسال التلقائي قبل الانتهاء بيومين يعمل عبر Meta Cloud API عند ضبط <span dir="ltr" className="font-mono text-xs">WHATSAPP_TOKEN</span> و<span dir="ltr" className="font-mono text-xs">WHATSAPP_PHONE_ID</span> في متغيرات الخادم؛ بدونه تُجهَّز الرسالة وتُسجَّل ويظهر زر إرسال واتساب فوري. المهمة اليومية متاحة أيضاً على <span dir="ltr" className="font-mono text-xs">/api/cron/daily</span> للجدولة الساعة 09:00 بتوقيت عدن.
          </div>
          {[
            { k: "whatsapp_expiry_template", t: "🔔 قالب تنبيه الانتهاء (قبل يومين — تلقائي بدون مراجعة)" },
            { k: "whatsapp_sale_template", t: "🎉 قالب تسليم بيانات اشتراك جديد" },
            { k: "whatsapp_renewal_template", t: "✅ قالب تأكيد التجديد" },
            { k: "whatsapp_activation_template", t: "⚡ قالب «تم التفعيل» — يصل للعميل بعد ضغطك الزر (المتغيرات: {{name}} {{platform}} {{email}} {{password}} {{link}} {{note}} {{credentials}} {{end_date}})" },
          ].map((f) => (
            <div key={f.k} className="card p-4">
              <label className="label">{f.t}</label>
              <textarea rows={6} className="field leading-relaxed" value={tpl[f.k] || ""} onChange={(e) => setTpl({ ...tpl, [f.k]: e.target.value })} />
            </div>
          ))}
          <div className="card space-y-3 p-4">
            <h3 className="font-black">بريد إرسال كود الأدمن</h3>
            <p className="text-xs font-semibold leading-relaxed text-slate-400">حتى يصل الكود إلى almaystrwbady@gmail.com ضع بيانات مرسل البريد هنا. مع جيميل استخدم smtp.gmail.com والمنفذ 587 وكلمة مرور التطبيقات لا كلمة الجيميل العادية.</p>
            <input className="field" dir="ltr" placeholder="SMTP host مثل smtp.gmail.com" value={tpl.smtp_host || ""} onChange={(e) => setTpl({ ...tpl, smtp_host: e.target.value })} />
            <input className="field" dir="ltr" placeholder="SMTP user" value={tpl.smtp_user || ""} onChange={(e) => setTpl({ ...tpl, smtp_user: e.target.value })} />
            <input className="field" dir="ltr" type="password" placeholder={String(tpl.smtp_pass || "").startsWith("v1:") ? "محفوظة — اكتبها فقط إذا أردت تغييرها" : "SMTP password"} value={String(tpl.smtp_pass || "").startsWith("v1:") ? "" : (tpl.smtp_pass || "")} onChange={(e) => setTpl({ ...tpl, smtp_pass: e.target.value })} />
            <input className="field" dir="ltr" placeholder="من البريد From" value={tpl.smtp_from || ""} onChange={(e) => setTpl({ ...tpl, smtp_from: e.target.value })} />
          </div>
          <button disabled={busy} onClick={() => manage({ action: "saveSettings", settings: tpl }, "تم حفظ القوالب")} className="btn-gold"><Save size={18} /> حفظ القوالب</button>

          <div className="card p-4">
            <h3 className="mb-3 font-black">آخر رسائل واتساب المسجلة</h3>
            <div className="space-y-2">
              {data.whatsappLogs.slice(0, 8).map((w: any) => (
                <div key={w.id} className="rounded-xl bg-white/[.04] px-3 py-2.5 text-xs font-semibold">
                  <div className="flex flex-wrap gap-2"><Badge tone="green">{w.kind}</Badge><Badge>{w.status}</Badge><span dir="ltr">{w.phone}</span><span className="text-slate-400">{fmtDateTime(w.createdAt)}</span></div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-600">{w.message.slice(0, 180)}{w.message.length > 180 ? "…" : ""}</p>
                </div>
              ))}
              {data.whatsappLogs.length === 0 && <p className="font-bold text-slate-400">لا رسائل بعد.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "platforms" && (
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div className="flex items-center gap-3">
              <PlatformLogo src={newPlat.imageUrl} name={newPlat.name || "؟"} color={newPlat.color} size={64} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">إضافة منصة يدوياً</div>
                <div className="text-xs font-semibold text-slate-400">اكتب الاسم وارفع صورة الشعار. ستظهر الصورة فوق اسم المنصة في نقطة البيع.</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input className="field" placeholder="اسم المنصة (مثال: Apple TV+)" value={newPlat.name} onChange={(e) => setNewPlat({ ...newPlat, name: e.target.value })} />
              <label className="btn-ghost cursor-pointer">
                <ImagePlus size={16} /> صورة المنصة
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1_200_000) { setMsg("⚠️ الصورة أكبر من 1 ميجا"); return; }
                  setNewPlat({ ...newPlat, imageUrl: await fileToDataUrl(file) });
                }} />
              </label>
            </div>
            <button disabled={busy || !newPlat.name.trim()} onClick={() => { manage({ action: "upsertPlatform", name: newPlat.name, color: newPlat.color, shortName: newPlat.name.slice(0, 1), imageUrl: newPlat.imageUrl }, "تمت إضافة المنصة"); setNewPlat({ name: "", color: "#0f172a", shortName: "", imageUrl: "" }); }} className="btn-gold"><Plus size={17} /> إضافة المنصة</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.platforms.map((p: any) => (
              <div key={p.id} className="card flex flex-col items-center gap-3 p-4 text-center">
                <PlatformLogo src={p.imageUrl} name={p.name} color={p.color} size={72} />
                <div className="font-extrabold">{p.name}</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {p.deliveryMode === "ON_DEMAND"
                    ? <Badge tone="amber">عند الطلب — يفعّله المدير</Badge>
                    : <Badge tone="green">من المخزون — تسليم فوري</Badge>}
                  {p.requiresCustomerEmail && <Badge tone="blue">يطلب إيميل العميل</Badge>}
                  {p.extraFieldLabel && <Badge tone="gold">حقل: {p.extraFieldLabel}</Badge>}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => setEditPlat({ ...p, imageUrl: p.imageUrl || "", extraFieldLabel: p.extraFieldLabel || "" })} className="btn-ghost px-3 py-2 text-xs"><Pencil size={14} /> تعديل</button>
                  <button onClick={() => manage({ action: "upsertPlatform", id: p.id, name: p.name, color: p.color, shortName: p.shortName, imageUrl: p.imageUrl, isActive: !p.isActive }, p.isActive ? "تم تعطيل المنصة" : "تم تفعيل المنصة")} className="btn-ghost px-3 py-2 text-xs">{p.isActive ? "تعطيل" : "تفعيل"}</button>
                  <button onClick={() => { if (confirm(`حذف منصة ${p.name}؟`)) manage({ action: "deletePlatform", id: p.id }, "تم حذف المنصة"); }} className="btn-danger px-3 py-2 text-xs"><Trash2 size={14} /> حذف</button>
                  {!p.isActive && <Badge tone="red">معطلة</Badge>}
                </div>
              </div>
            ))}
          </div>
          {editPlat && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setEditPlat(null)}>
              <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0c1426] p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="mb-4 text-lg font-black text-white">تعديل المنصة</h3>
                <div className="mb-4 flex justify-center"><PlatformLogo src={editPlat.imageUrl} name={editPlat.name} color={editPlat.color} size={88} /></div>
                <label className="label">الاسم</label>
                <input className="field" value={editPlat.name} onChange={(e) => setEditPlat({ ...editPlat, name: e.target.value })} />
                <label className="btn-ghost mt-3 w-full cursor-pointer">
                  <ImagePlus size={16} /> تغيير الصورة
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1_200_000) { setMsg("⚠️ الصورة أكبر من 1 ميجا"); return; }
                    setEditPlat({ ...editPlat, imageUrl: await fileToDataUrl(file) });
                  }} />
                </label>

                <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                  <div className="text-sm font-black text-white">⚙️ طريقة التسليم والطلب من العميل</div>
                  <div>
                    <label className="label">نمط التسليم</label>
                    <select className="field" value={editPlat.deliveryMode === "INVENTORY" ? "INSTANT_INVENTORY" : editPlat.deliveryMode === "ON_DEMAND" ? "ON_DEMAND_EMAIL" : (editPlat.deliveryMode || "INSTANT_INVENTORY")} onChange={(e) => setEditPlat({ ...editPlat, deliveryMode: e.target.value })}>
                      <option value="INSTANT_INVENTORY">⚡ تسليم فوري — يُسحب حساب جاهز من المخزون تلقائياً</option>
                      <option value="ON_DEMAND_EMAIL">📧 تفعيل على إيميل العميل — يُطلب الإيميل، والمدير يفعّل ثم يؤكد</option>
                      <option value="LINK_ONLY">🔗 تسليم برابط فقط — المدير يضع رابط الدعوة ثم يؤكد الإرسال</option>
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-[#c99327]" checked={!!editPlat.isLifetime} onChange={(e) => setEditPlat({ ...editPlat, isLifetime: e.target.checked })} />
                    ♾️ اشتراك دائم / بدون مدة انتهاء (تُلغى المدة والتواريخ والتجديد)
                  </label>
                  {(editPlat.deliveryMode === "INSTANT_INVENTORY" || editPlat.deliveryMode === "INVENTORY" || !editPlat.deliveryMode) && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-200">
                      <input type="checkbox" className="h-4 w-4 accent-[#c99327]" checked={!!editPlat.requiresCustomerEmail} onChange={(e) => setEditPlat({ ...editPlat, requiresCustomerEmail: e.target.checked })} />
                      اطلب إيميل العميل عند البيع (يُعرض للمدير في التنبيهات)
                    </label>
                  )}
                  {editPlat.deliveryMode === "ON_DEMAND_EMAIL" && (
                    <p className="rounded-xl bg-sky-500/10 px-3 py-2 text-[12px] font-bold text-sky-300">✓ إيميل العميل إلزامي تلقائياً في هذا النمط — يُفعَّل الاشتراك عليه خارجياً.</p>
                  )}
                  {editPlat.deliveryMode === "LINK_ONLY" && (
                    <p className="rounded-xl bg-sky-500/10 px-3 py-2 text-[12px] font-bold text-sky-300">✓ هذا النمط لا يطلب إيميلاً من العميل — فقط تضع الرابط عند التأكيد.</p>
                  )}
                  <div>
                    <label className="label">حقل إضافي تطلبه من العميل (اختياري)</label>
                    <input className="field" placeholder="مثال: إيميل حساب الجيم / اسم المستخدم" value={editPlat.extraFieldLabel || ""} onChange={(e) => setEditPlat({ ...editPlat, extraFieldLabel: e.target.value })} />
                    <p className="mt-1 text-[11px] font-semibold text-slate-400">إذا كتبته، تظهر خانة بهذا العنوان في نموذج البيع، وتصل قيمتها لك في لوحة الإدارة.</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button disabled={busy || !editPlat.name.trim()} onClick={async () => { await manage({ action: "upsertPlatform", id: editPlat.id, name: editPlat.name, color: editPlat.color, shortName: editPlat.shortName, imageUrl: editPlat.imageUrl, isActive: editPlat.isActive, deliveryMode: editPlat.deliveryMode || "INSTANT_INVENTORY", requiresCustomerEmail: !!editPlat.requiresCustomerEmail, extraFieldLabel: editPlat.extraFieldLabel || "", isLifetime: !!editPlat.isLifetime }, "تم تحديث المنصة"); setEditPlat(null); }} className="btn-gold flex-1">حفظ</button>
                  <button onClick={() => setEditPlat(null)} className="btn-ghost">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "banks" && (
        <div className="space-y-4">
          <div className="card flex flex-col gap-3 p-4 sm:flex-row">
            <input className="field flex-1" placeholder="اسم بنك جديد" value={newBank} onChange={(e) => setNewBank(e.target.value)} />
            <button disabled={busy || !newBank.trim()} onClick={() => { manage({ action: "upsertBank", name: newBank }, "تمت إضافة البنك"); setNewBank(""); }} className="btn-gold"><Plus size={17} /> إضافة</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.paymentMethods.filter((b: any) => b.isActive).map((b: any) => (
              <div key={b.id} className="card flex items-center gap-3 p-4">
                <span className="rounded-2xl bg-white/[.06] p-3"><Building2 size={20} /></span>
                <span className="flex-1 font-extrabold">{b.name}</span>
                <button onClick={() => { if (confirm(`حذف ${b.name}؟`)) manage({ action: "deleteBank", id: b.id }, "تم حذف البنك"); }} className="btn-danger px-3 py-2 text-xs"><Trash2 size={14} /> حذف</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-4">
          <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <input className="field" placeholder="الاسم المعروض" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
            <select className="field" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}><option value="EMPLOYEE">موظف مبيعات</option><option value="ADMIN">مدير</option></select>
            <button disabled={busy} onClick={async () => { const ok = await manage({ action: "createUser", ...newUser }, "تم إنشاء المستخدم"); if (ok) setNewUser({ username: "", password: "", displayName: "", role: "EMPLOYEE" }); }} className="btn-gold"><Plus size={17} /> إنشاء مستخدم</button>
          </div>
          <div className="card divide-y divide-slate-100 overflow-hidden">
            {data.users.map((u: any) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0e1526] font-black text-[#174ea6]">{u.displayName.slice(0, 1)}</span>
                <div className="min-w-[160px] flex-1">
                  <div className="font-extrabold">{u.displayName} {isAdminRole(u.role) ? <Badge tone="gold">مدير — كل الصلاحيات</Badge> : <Badge>موظف</Badge>} {!u.isActive && <Badge tone="red">معطّل</Badge>}</div>
                  <div className="text-xs font-bold text-slate-400"><span dir="ltr">@{u.username}</span> • آخر دخول: {fmtDateTime(u.lastLoginAt)}</div>
                </div>
                {!isAdminRole(u.role) && (
                  <>
                    <button onClick={() => { const pw = prompt(`كلمة مرور جديدة لـ ${u.username}:`); if (pw) manage({ action: "updateUser", id: u.id, password: pw }, "تم تغيير كلمة المرور"); }} className="btn-ghost px-3 py-2 text-xs">كلمة مرور جديدة</button>
                    <button onClick={() => manage({ action: "updateUser", id: u.id, unlock: true }, "تم فك القفل")} className="btn-ghost px-3 py-2 text-xs">فك القفل</button>
                    <button onClick={() => manage({ action: "updateUser", id: u.id, isActive: !u.isActive }, u.isActive ? "تم التعطيل" : "تم التفعيل")} className="btn-ghost px-3 py-2 text-xs">{u.isActive ? "تعطيل" : "تفعيل"}</button>
                    <button onClick={() => { if (confirm(`حذف الموظف ${u.displayName} نهائياً؟ سيتم نقل سجلاته لحسابك للحفاظ على البيانات.`)) manage({ action: "deleteUser", id: u.id }, `تم حذف الموظف ${u.displayName} نهائياً`); }} className="btn-danger px-3 py-2 text-xs"><Trash2 size={14} /> حذف</button>
                  </>
                )}
                {u.id !== meId && (
                  <button onClick={() => { const toAdmin = !isAdminRole(u.role); if (confirm(isAdminRole(u.role) ? `تخفيض ${u.displayName} من مدير إلى موظف؟ سيفقد كل صلاحيات الإدارة فوراً.` : `ترقية ${u.displayName} إلى مدير بكامل الصلاحيات؟`)) manage({ action: "updateUser", id: u.id, role: toAdmin ? "ADMIN" : "EMPLOYEE" }, toAdmin ? `تمت ترقية ${u.displayName} إلى مدير` : `تم تخفيض ${u.displayName} إلى موظف`); }} className="btn-ghost px-3 py-2 text-xs">{isAdminRole(u.role) ? "⬇ تخفيض لموظف" : "⬆ ترقية لمدير"}</button>
                )}
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-slate-500">الموظف لا يرى المخزون ولا المحذوفات ولا التدقيق، ولا يستطيع الحذف أو تأكيد السندات — تُفرض هذه القيود من الخادم في كل طلب وليس من الواجهة فقط. بعد 5 محاولات دخول فاشلة يُقفل الحساب 15 دقيقة.</p>
        </div>
      )}
    </div>
  );
}
