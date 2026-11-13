"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ImagePlus, MessageCircle, MonitorPlay, Pencil, Plus, Save, Trash2, Users, Wallet, KeyRound, UserCheck, DatabaseBackup, Download, Upload, FileSpreadsheet, FileJson, Send, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { api, cachedApi, fetchMe, fileToDataUrl, fmtDateTime, getCached, getCachedMe, invalidateCache, setCached } from "@/lib/client";
import { Badge, PlatformLogo, Spinner } from "@/components/ui";
import { isAdminRole } from "@/lib/roles";

const SETTINGS_URL = "/api/admin-data?view=settings";

const TABS = [
  { id: "whatsapp", label: "قوالب واتساب", icon: <MessageCircle size={18} /> },
  { id: "platforms", label: "المنصات", icon: <MonitorPlay size={18} /> },
  { id: "banks", label: "البنوك والدفع", icon: <Building2 size={18} /> },
  { id: "users", label: "المستخدمون والصلاحيات", icon: <Users size={18} /> },
  { id: "backup", label: "النسخ الاحتياطي", icon: <DatabaseBackup size={18} /> },
];

export default function SettingsPage() {
  const cachedSettings = getCached<any>(SETTINGS_URL);
  const [tab, setTab] = useState("whatsapp");
  const [data, setData] = useState<any>(() => cachedSettings);
  const [tpl, setTpl] = useState<any>(() => cachedSettings?.settings || {});
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [newPlat, setNewPlat] = useState({ name: "", color: "#0f172a", shortName: "", imageUrl: "" });
  const [selectedPlatId, setSelectedPlatId] = useState<number | "">("");
  const [editPlat, setEditPlat] = useState<any>(null);
  const [newBank, setNewBank] = useState("");
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "USER",
    openWallet: true,
    initialBalance: "0",
    canSell: true,
    canRenew: true,
    canViewPrices: true,
  });
  const [topUpForm, setTopUpForm] = useState({
    userId: "",
    amount: "",
    note: "",
  });
  const [quickTopUpUser, setQuickTopUpUser] = useState<any | null>(null);
  const [quickAmount, setQuickAmount] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [meId, setMeId] = useState<number | null>(() => getCachedMe()?.id ?? null);
  const [backupBusy, setBackupBusy] = useState<"" | "json" | "csv_customers" | "csv_rentals" | "telegram" | "restore">("");
  const [backupNotice, setBackupNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    filename: string;
    exportedAt?: string;
    counts: Record<string, number>;
    payload: any;
  } | null>(null);
  const [restoreResult, setRestoreResult] = useState<{
    inserted: Record<string, number>;
    skipped: Record<string, number>;
  } | null>(null);
  const [showTgConfig, setShowTgConfig] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);


  const load = useCallback(async (force = false) => {
    const d = await cachedApi(SETTINGS_URL, undefined, { force }).catch(() => null);
    if (d) {
      setData(d);
      setTpl(d.settings || {});
    }
    fetchMe().then((u) => setMeId(u?.id ?? null)).catch(() => {});
  }, []);
  useEffect(() => { void load(false); }, [load]);

  async function manage(body: any, ok: string): Promise<boolean> {
    setBusy(true); setMsg("");
    const prevData = data ? structuredClone(data) : null;

    if (data) {
      let next = { ...data };
      if (body.action === "saveSettings") {
        next.settings = { ...body.settings };
      } else if (body.action === "upsertPlatform" && body.id) {
        next.platforms = data.platforms.map((p: any) => p.id === body.id ? { ...p, ...body } : p);
      } else if (body.action === "deletePlatform") {
        next.platforms = data.platforms.filter((p: any) => p.id !== body.id);
      } else if (body.action === "deleteBank") {
        next.paymentMethods = data.paymentMethods.filter((b: any) => b.id !== body.id);
      } else if (body.action === "updateUser") {
        next.users = data.users.map((u: any) => u.id === body.id ? {
          ...u,
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
        } : u);
      } else if (body.action === "deleteUser") {
        next.users = data.users.filter((u: any) => u.id !== body.id);
      } else if (body.action === "topUpWallet") {
        next.users = data.users.map((u: any) => u.id === body.userId ? {
          ...u,
          walletBalance: Number(u.walletBalance || 0) + Number(body.amount || 0),
        } : u);
      }
      setData(next);
      setCached(SETTINGS_URL, next);
    }

    try {
      await api("/api/manage", { method: "POST", body: JSON.stringify(body) });
      setMsg("✓ " + ok);
      invalidateCache("/api/meta");
      void load(true);
      return true;
    } catch (e: any) {
      if (prevData) {
        setData(prevData);
        setCached(SETTINGS_URL, prevData);
      }
      setMsg("⚠️ " + e.message);
      return false;
    } finally { setBusy(false); }
  }

  async function downloadBackupFile(
    url: string,
    fallbackName: string,
    kind: "json" | "csv_customers" | "csv_rentals"
  ) {
    setBackupBusy(kind);
    setBackupNotice(null);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "تعذر تحميل الملف");
      }
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] || fallbackName;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setBackupNotice({ tone: "ok", text: `تم تحميل الملف بنجاح: ${filename}` });
    } catch (e: any) {
      setBackupNotice({ tone: "err", text: e?.message || "حدث خطأ أثناء التحميل" });
    } finally {
      setBackupBusy("");
    }
  }

  async function sendBackupToTelegramNow() {
    setBackupBusy("telegram");
    setBackupNotice(null);
    try {
      const res = await api<{ ok: boolean; filename?: string; sentAt?: string; counts?: Record<string, number> }>("/api/backup", {
        method: "POST",
        body: JSON.stringify({ action: "sendTelegram" }),
      });
      if (data) {
        const next = {
          ...data,
          backupStatus: {
            ...(data.backupStatus || {}),
            lastTelegramBackupAt: res.sentAt || new Date().toISOString(),
            telegramConfigured: true,
          },
        };
        setData(next);
        setCached(SETTINGS_URL, next);
      }
      setBackupNotice({
        tone: "ok",
        text: `تم إرسال النسخة الاحتياطية إلى تيليجرام بنجاح (${res.filename || "JSON"}) — العملاء: ${res.counts?.customers ?? 0}، الاشتراكات: ${res.counts?.rentals ?? 0}`,
      });
    } catch (e: any) {
      setBackupNotice({ tone: "err", text: e?.message || "تعذر إرسال النسخة الاحتياطية إلى تيليجرام" });
    } finally {
      setBackupBusy("");
    }
  }

  async function handleSelectRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBackupNotice(null);
    setRestoreResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
        throw new Error("ملف JSON غير صالح — يجب أن يكون ملف نسخة احتياطية صادر من النظام.");
      }
      const t = parsed.tables;
      const counts = {
        customers: Array.isArray(t.customers) ? t.customers.length : 0,
        rentals: Array.isArray(t.rentals) ? t.rentals.length : 0,
        platforms: Array.isArray(t.platforms) ? t.platforms.length : 0,
        accounts: Array.isArray(t.accounts) ? t.accounts.length : 0,
        payments: Array.isArray(t.payments) ? t.payments.length : 0,
      };
      setPendingRestore({
        filename: file.name,
        exportedAt: parsed.exportedAt,
        counts,
        payload: parsed,
      });
    } catch (err: any) {
      setPendingRestore(null);
      setBackupNotice({ tone: "err", text: err?.message || "تعذر قراءة ملف JSON" });
    }
  }

  async function confirmRestoreBackup() {
    if (!pendingRestore) return;
    setBackupBusy("restore");
    setBackupNotice(null);
    try {
      const res = await api<{
        ok: boolean;
        summary: { inserted: Record<string, number>; skipped: Record<string, number> };
      }>("/api/backup", {
        method: "POST",
        body: JSON.stringify({ action: "restore", backup: pendingRestore.payload }),
      });
      setRestoreResult(res.summary);
      setPendingRestore(null);
      invalidateCache();
      void load(true);
      setBackupNotice({
        tone: "ok",
        text: `تمت استعادة ودمج النسخة الاحتياطية بأمان (+${res.summary.inserted.customers} عملاء، +${res.summary.inserted.rentals} اشتراكات، +${res.summary.inserted.accounts} حسابات) دون أي تكرار.`,
      });
    } catch (e: any) {
      setBackupNotice({ tone: "err", text: e?.message || "فشلت عملية استعادة النسخة الاحتياطية" });
    } finally {
      setBackupBusy("");
    }
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

          {/* تخصيص قالب مستقل لكل منصة */}
          <div className="card space-y-3 p-4">
            <div>
              <h3 className="font-black text-amber-300">📱 تخصيص قالب مستقل لكل منصة (شاهد، نتفليكس، كانفا...)</h3>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-400">
                اختر المنصة بالأسفل لتخصيص نص رسالة واتساب مستقل بها. النظام يملأ المتغيرات الذكية تلقائياً (
                <code className="text-amber-200">{"{{name}}"}</code>, <code className="text-amber-200">{"{{platform}}"}</code>, <code className="text-amber-200">{"{{credentials}}"}</code>, <code className="text-amber-200">{"{{end_date}}"}</code>, <code className="text-amber-200">{"{{email}}"}</code>, <code className="text-amber-200">{"{{password}}"}</code>, <code className="text-amber-200">{"{{profile}}"}</code>
                )، ويميز تلقائياً بين الحساب الكامل (دون سطر PIN) والبروفايل.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {data?.platforms?.map((p: any) => {
                const hasCustom = !!tpl[`whatsapp_platform_template_${p.id}`]?.trim();
                const isSelected = selectedPlatId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlatId(isSelected ? "" : p.id)}
                    className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition border ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/20 text-white shadow-sm"
                        : hasCustom
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-white/10 bg-white/[.03] text-slate-400 hover:border-white/25"
                    }`}
                  >
                    <span>{p.name}</span>
                    {hasCustom && <span className="h-2 w-2 rounded-full bg-emerald-400" title="مخصص" />}
                  </button>
                );
              })}
            </div>

            {selectedPlatId && (
              <div className="mt-3 space-y-2.5 rounded-2xl border border-white/10 bg-white/[.02] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-300">
                    قالب المنصة: {data?.platforms?.find((p: any) => p.id === selectedPlatId)?.name}
                  </span>
                  {tpl[`whatsapp_platform_template_${selectedPlatId}`] && (
                    <button
                      type="button"
                      onClick={() => setTpl({ ...tpl, [`whatsapp_platform_template_${selectedPlatId}`]: "" })}
                      className="text-[11px] font-bold text-red-400 hover:underline"
                    >
                      إلغاء التخصيص والعودة للقالب العام
                    </button>
                  )}
                </div>
                <textarea
                  rows={6}
                  className="field leading-relaxed font-sans"
                  placeholder="اكتب قالب واتساب مخصص لهذه المنصة..."
                  value={tpl[`whatsapp_platform_template_${selectedPlatId}`] || ""}
                  onChange={(e) => setTpl({ ...tpl, [`whatsapp_platform_template_${selectedPlatId}`]: e.target.value })}
                />
              </div>
            )}
          </div>
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
        <div className="space-y-6">
          {/* قسمان متجاوران: إنشاء مستخدم بالصلاحيات + شحن المحفظة يدوياً */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* البطاقة 1: إنشاء مستخدم جديد مع فتح محفظة وتحديد الصلاحيات */}
            <div className="card flex flex-col justify-between p-5 shadow-lg">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                    <UserCheck size={20} />
                  </span>
                  <div>
                    <h3 className="font-black text-white">إنشاء مستخدم / عميل جديد</h3>
                    <p className="text-xs text-slate-400">أنشئ حساب مستخدم أو موظف مع كلمة مرور، وحدد الصلاحيات وافتح له محفظة.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-300">اسم المستخدم (للدخول)</label>
                      <input
                        className="field text-sm"
                        dir="ltr"
                        style={{ textAlign: "left" }}
                        placeholder="username"
                        value={newUser.username}
                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-300">كلمة المرور (6 خانات+)</label>
                      <input
                        className="field text-sm"
                        dir="ltr"
                        style={{ textAlign: "left" }}
                        placeholder="••••••"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-300">الاسم المعروض</label>
                      <input
                        className="field text-sm"
                        placeholder="مثال: أحمد محمد"
                        value={newUser.displayName}
                        onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-300">الرتبة / نوع الحساب</label>
                      <select
                        className="field text-sm font-bold"
                        value={newUser.role}
                        onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      >
                        <option value="USER">👤 مستخدم / عميل عادي</option>
                        <option value="EMPLOYEE">💼 موظف مبيعات</option>
                        <option value="ADMIN">👑 مدير النظام بكامل الصلاحيات</option>
                      </select>
                    </div>
                  </div>

                  {/* فتح محفظة للمستخدم والرصيد الافتتاحي */}
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-3.5">
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-black text-amber-300">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-amber-500"
                        checked={newUser.openWallet}
                        onChange={(e) => setNewUser({ ...newUser, openWallet: e.target.checked })}
                      />
                      <span>فتح محفظة للمستخدم 💳</span>
                    </label>

                    {newUser.openWallet && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-300">رصيد افتتاحي أولي:</span>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          className="field max-w-[140px] py-1.5 text-sm font-black"
                          placeholder="0"
                          value={newUser.initialBalance}
                          onChange={(e) => setNewUser({ ...newUser, initialBalance: e.target.value })}
                        />
                        <span className="text-xs font-bold text-amber-400">ريال يمني</span>
                      </div>
                    )}
                  </div>

                  {/* الصلاحيات المتاحة */}
                  {newUser.role !== "ADMIN" && (
                    <div className="rounded-2xl border border-white/10 bg-white/[.02] p-3 text-xs">
                      <div className="mb-2 font-black text-slate-300">صلاحيات هذا المستخدم:</div>
                      <div className="grid grid-cols-2 gap-2 text-slate-300 font-semibold">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUser.canSell}
                            onChange={(e) => setNewUser({ ...newUser, canSell: e.target.checked })}
                            className="h-3.5 w-3.5 accent-blue-500"
                          />
                          <span>شراء / بيع الاشتراكات</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUser.canRenew}
                            onChange={(e) => setNewUser({ ...newUser, canRenew: e.target.checked })}
                            className="h-3.5 w-3.5 accent-blue-500"
                          />
                          <span>تجديد الاشتراكات</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                disabled={busy || !newUser.username.trim() || newUser.password.length < 6}
                onClick={async () => {
                  const ok = await manage(
                    {
                      action: "createUser",
                      username: newUser.username,
                      password: newUser.password,
                      displayName: newUser.displayName || newUser.username,
                      role: newUser.role,
                      openWallet: newUser.openWallet,
                      initialBalance: Number(newUser.initialBalance || 0),
                      permissions: { canSell: newUser.canSell, canRenew: newUser.canRenew, canViewPrices: newUser.canViewPrices },
                    },
                    "تم إنشاء المستخدم بنجاح"
                  );
                  if (ok) {
                    setNewUser({
                      username: "",
                      password: "",
                      displayName: "",
                      role: "USER",
                      openWallet: true,
                      initialBalance: "0",
                      canSell: true,
                      canRenew: true,
                      canViewPrices: true,
                    });
                  }
                }}
                className="btn-gold mt-4 w-full py-3 text-sm font-black shadow-lg"
              >
                <Plus size={18} /> إنشاء المستخدم وفتح الحساب
              </button>
            </div>

            {/* البطاقة 2: خاصية شحن محفظة (بجانبها كما طلب المستخدم) */}
            <div className="card flex flex-col justify-between p-5 shadow-lg border border-amber-400/20 bg-gradient-to-b from-amber-500/[.03] to-transparent">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                    <Wallet size={20} />
                  </span>
                  <div>
                    <h3 className="font-black text-white">شحن محفظة يدوياً</h3>
                    <p className="text-xs text-slate-400">اختر الشخص واكتب المبلغ يدوياً لإضافته فورياً إلى رصيد محفظته.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-300">اختر الشخص / المستخدم</label>
                    <select
                      className="field text-sm font-bold"
                      value={topUpForm.userId}
                      onChange={(e) => setTopUpForm({ ...topUpForm, userId: e.target.value })}
                    >
                      <option value="">-- اختر المستخدم المراد شحن محفظته --</option>
                      {data.users.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName} (@{u.username}) — الرصيد: {Number(u.walletBalance || 0).toLocaleString()} ر.ي
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-300">مبلغ الشحن (ريال يمني)</label>
                    <input
                      type="number"
                      min="1"
                      step="100"
                      className="field text-base font-black text-amber-300 placeholder:text-slate-600"
                      placeholder="اكتب المبلغ يدوياً (مثال: 5000)"
                      value={topUpForm.amount}
                      onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })}
                    />

                    {/* أزرار مبالغ سريعة */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[500, 1000, 2000, 5000, 10000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setTopUpForm({ ...topUpForm, amount: String(val) })}
                          className="rounded-lg border border-white/10 bg-white/[.04] px-2.5 py-1 text-xs font-black text-slate-200 transition hover:bg-amber-400/20 hover:text-amber-300"
                        >
                          +{val.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-300">بيان / ملاحظة الشحن (اختياري)</label>
                    <input
                      className="field text-sm"
                      placeholder="مثال: إيداع نقدي / حوالة الكريمي رقم #12345"
                      value={topUpForm.note}
                      onChange={(e) => setTopUpForm({ ...topUpForm, note: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <button
                disabled={busy || !topUpForm.userId || !topUpForm.amount || Number(topUpForm.amount) <= 0}
                onClick={async () => {
                  const uid = Number(topUpForm.userId);
                  const amt = Number(topUpForm.amount);
                  const ok = await manage(
                    {
                      action: "topUpWallet",
                      userId: uid,
                      amount: amt,
                      note: topUpForm.note || "شحن يدوي من الإدارة",
                    },
                    `تم شحن ${amt.toLocaleString()} ر.ي بنجاح للمحفظة`
                  );
                  if (ok) {
                    setTopUpForm({ userId: "", amount: "", note: "" });
                  }
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-amber-500 to-[#1463ff] py-3 text-sm font-black text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                <Wallet size={18} /> شحن المحفظة بالمبلغ المحدد
              </button>
            </div>
          </div>

          {/* قائمة المستخدمين الحالية مع عرض أرصدتهم وأزرار شحن سريعة */}
          <div className="card overflow-hidden">
            <div className="border-b border-white/10 bg-white/[.02] px-4 py-3">
              <h3 className="font-black text-white">المستخدمون والحسابات المسجلة ({data.users.length})</h3>
              <p className="text-xs text-slate-400">يمكنك تعديل أي مستخدم أو شحن رصيده فورياً بضغطة زر واحدة.</p>
            </div>

            <div className="divide-y divide-white/5">
              {data.users.map((u: any) => {
                const bal = Number(u.walletBalance || 0);
                return (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-white/[.02]">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0e1526] font-black text-[#57c8ff] shadow-inner">
                        {u.displayName?.slice(0, 1) || "U"}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-white">{u.displayName}</span>
                          {isAdminRole(u.role) ? (
                            <Badge tone="gold">👑 مدير النظام</Badge>
                          ) : u.role === "EMPLOYEE" ? (
                            <Badge tone="blue">💼 موظف مبيعات</Badge>
                          ) : (
                            <Badge tone="green">👤 مستخدم / عميل</Badge>
                          )}
                          {!u.isActive && <Badge tone="red">معطّل</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs font-semibold text-slate-400">
                          <span dir="ltr">@{u.username}</span> • آخر دخول: {fmtDateTime(u.lastLoginAt)}
                        </div>
                      </div>
                    </div>

                    {/* بطاقة رصيد المحفظة مع زر شحن فوري */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-300">
                        <Wallet size={15} />
                        <span>رصيد المحفظة:</span>
                        <span className="font-mono text-sm text-white">{bal.toLocaleString()} ر.ي</span>
                      </div>

                      <button
                        onClick={() => {
                          setQuickTopUpUser(u);
                          setQuickAmount("");
                          setQuickNote("");
                        }}
                        className="flex items-center gap-1.5 rounded-xl bg-amber-500/20 px-3 py-1.5 text-xs font-black text-amber-200 transition hover:bg-amber-500 hover:text-black"
                      >
                        <Plus size={14} /> شحن رصيد
                      </button>

                      {!isAdminRole(u.role) && (
                        <>
                          <button
                            onClick={() => {
                              const pw = prompt(`كلمة مرور جديدة لـ ${u.username}:`);
                              if (pw) manage({ action: "updateUser", id: u.id, password: pw }, "تم تغيير كلمة المرور");
                            }}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                          >
                            <KeyRound size={13} /> كلمة جديدة
                          </button>
                          <button
                            onClick={() => manage({ action: "updateUser", id: u.id, unlock: true }, "تم فك القفل")}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                          >
                            فك القفل
                          </button>
                          <button
                            onClick={() => manage({ action: "updateUser", id: u.id, isActive: !u.isActive }, u.isActive ? "تم التعطيل" : "تم التفعيل")}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                          >
                            {u.isActive ? "تعطيل" : "تفعيل"}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`حذف حساب ${u.displayName} نهائياً؟`)) {
                                manage({ action: "deleteUser", id: u.id }, `تم حذف الحساب ${u.displayName}`);
                              }
                            }}
                            className="btn-danger px-2.5 py-1.5 text-xs"
                          >
                            <Trash2 size={13} /> حذف
                          </button>
                        </>
                      )}

                      {u.id !== meId && (
                        <select
                          className="rounded-xl border border-white/10 bg-[#0e1526] px-2.5 py-1.5 text-xs font-bold text-slate-300 outline-none"
                          value={u.role}
                          onChange={(e) => {
                            const newRole = e.target.value;
                            if (confirm(`تغيير رتبة ${u.displayName} إلى ${newRole === "ADMIN" ? "مدير" : newRole === "EMPLOYEE" ? "موظف" : "مستخدم"}؟`)) {
                              manage({ action: "updateUser", id: u.id, role: newRole }, "تم تغيير الرتبة بنجاح");
                            }
                          }}
                        >
                          <option value="USER">مستخدم / عميل</option>
                          <option value="EMPLOYEE">موظف مبيعات</option>
                          <option value="ADMIN">مدير</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* مودال الشحن السريع للمستخدم المحدد */}
          {quickTopUpUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setQuickTopUpUser(null)}>
              <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c1426] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
                    <Wallet size={24} />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-white">شحن محفظة {quickTopUpUser.displayName}</h3>
                    <p className="text-xs text-slate-400">الرصيد الحالي: {Number(quickTopUpUser.walletBalance || 0).toLocaleString()} ر.ي</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-300">المبلغ المطلوب شحنه (ريال يمني)</label>
                    <input
                      type="number"
                      min="1"
                      step="100"
                      autoFocus
                      className="field text-lg font-black text-amber-300"
                      placeholder="اكتب المبلغ يدوياً"
                      value={quickAmount}
                      onChange={(e) => setQuickAmount(e.target.value)}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[500, 1000, 2000, 5000, 10000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setQuickAmount(String(val))}
                          className="rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-xs font-black text-slate-300 transition hover:bg-amber-400/20 hover:text-amber-300"
                        >
                          +{val.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-300">ملاحظة أو بيان الشحن (اختياري)</label>
                    <input
                      className="field text-sm"
                      placeholder="مثال: إيداع نقدي / حوالة الكريمي"
                      value={quickNote}
                      onChange={(e) => setQuickNote(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      disabled={busy || !quickAmount || Number(quickAmount) <= 0}
                      onClick={async () => {
                        const amt = Number(quickAmount);
                        const ok = await manage(
                          {
                            action: "topUpWallet",
                            userId: quickTopUpUser.id,
                            amount: amt,
                            note: quickNote || "شحن يدوي من الإدارة",
                          },
                          `تم شحن ${amt.toLocaleString()} ر.ي بنجاح لـ ${quickTopUpUser.displayName}`
                        );
                        if (ok) {
                          setQuickTopUpUser(null);
                        }
                      }}
                      className="btn-gold flex-1 py-3 text-sm font-black shadow-lg"
                    >
                      تأكيد الشحن الآن
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickTopUpUser(null)}
                      className="btn-ghost px-4 py-3 text-xs"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="text-sm font-semibold text-slate-500">المستخدمون من نوع «مستخدم/عميل» أو «موظف» لا يرون المخزون ولا المحذوفات ولا التدقيق. يتم الشحن والخصم من المحفظة بمعاملات مسجلة وموثقة في سجل التدقيق.</p>
        </div>
      )}

      {tab === "backup" && (
        <div className="space-y-5">
          {/* حالة النسخ الاحتياطي التلقائي */}
          <div className="card flex flex-wrap items-center justify-between gap-4 border border-white/10 p-5">
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${data.backupStatus?.telegramConfigured ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                <Clock size={22} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-white">النسخ الاحتياطي التلقائي لقناة تيليجرام (كل 12 ساعة)</h3>
                  {data.backupStatus?.telegramConfigured ? (
                    <Badge tone="green">متصل وجاهز</Badge>
                  ) : (
                    <Badge tone="amber">يحتاج ضبط القناة</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-400">
                  يرسل النظام نسخة احتياطية نصية كاملة (JSON) إلى قناة تيليجرام تلقائياً في الخلفية كل 12 ساعة عند تنفيذ أي عملية إضافة أو تعديل، دون أي تأثير على سرعة الواجهة.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-300">
                  <span>
                    آخر نسخة مرسلة لتيليجرام:{" "}
                    <strong className="text-amber-300">
                      {data.backupStatus?.lastTelegramBackupAt ? fmtDateTime(data.backupStatus.lastTelegramBackupAt) : "لم تُرسل نسخة بعد"}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTgConfig((v) => !v)}
              className="btn-ghost px-3 py-2 text-xs"
            >
              {showTgConfig ? "إخفاء إعدادات البوت" : "إعدادات بوت وقناة تيليجرام"}
            </button>
          </div>

          {showTgConfig && (
            <div className="card space-y-3 border border-sky-500/20 bg-sky-500/[.03] p-5">
              <div className="text-sm font-black text-sky-300">ربط بوت وقناة الأرشيف في تيليجرام (اختياري إذا كانت مضبوطة في متغيرات الخادم)</div>
              <p className="text-xs font-semibold text-slate-400">
                في حال لم تُضف <span dir="ltr" className="font-mono">TELEGRAM_BOT_TOKEN</span> و<span dir="ltr" className="font-mono">TELEGRAM_ARCHIVE_CHAT_ID</span> في إعدادات Vercel، يمكنك حفظهما هنا مباشرة.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">رمز البوت (Bot Token)</label>
                  <input
                    className="field text-xs"
                    dir="ltr"
                    type="password"
                    placeholder="123456789:ABC..."
                    value={tpl.telegram_bot_token || ""}
                    onChange={(e) => setTpl({ ...tpl, telegram_bot_token: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">معرّف القناة الخاصة (Archive Chat ID)</label>
                  <input
                    className="field text-xs"
                    dir="ltr"
                    placeholder="-100xxxxxxxxxx"
                    value={tpl.telegram_archive_chat_id || ""}
                    onChange={(e) => setTpl({ ...tpl, telegram_archive_chat_id: e.target.value })}
                  />
                </div>
              </div>
              <button
                disabled={busy}
                onClick={async () => {
                  const ok = await manage({ action: "saveSettings", settings: tpl }, "تم حفظ إعدادات تيليجرام للنسخ الاحتياطي");
                  if (ok) setShowTgConfig(false);
                }}
                className="btn-gold px-4 py-2 text-xs"
              >
                <Save size={15} /> حفظ إعدادات تيليجرام
              </button>
            </div>
          )}

          {backupNotice && (
            <div className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold ${
              backupNotice.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}>
              {backupNotice.tone === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{backupNotice.text}</span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 1. تحميل على جهاز المستخدم (JSON + CSV/Excel) */}
            <div className="card flex flex-col justify-between space-y-4 p-5">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
                    <Download size={20} />
                  </span>
                  <div>
                    <h3 className="font-black text-white">تحميل نسخة احتياطية وتصدير CSV / Excel</h3>
                    <p className="text-xs font-semibold text-slate-400">تنزيل فوري على جهازك للبيانات النصية الكاملة أو كجداول إكسل.</p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={backupBusy !== ""}
                  onClick={() => downloadBackupFile("/api/backup?format=json", `maestro-key-backup-${new Date().toISOString().slice(0, 10)}.json`, "json")}
                  className="btn-gold w-full py-3.5 text-sm font-black shadow-lg"
                >
                  <FileJson size={18} />
                  {backupBusy === "json" ? "جارٍ تجهيز النسخة الشاملة..." : "تحميل نسخة احتياطية كاملة (JSON)"}
                </button>

                <p className="text-[11px] font-semibold leading-relaxed text-slate-400">
                  تشمل النسخة الكاملة جميع الجداول: العملاء، الاشتراكات، الطلبات، المنصات، الحسابات، البروفايلات، المدفوعات، المستخدمين، المحافظ، والإعدادات (بدون صور ثقيلة).
                </p>
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="mb-2 text-xs font-black text-slate-300">تصدير بصيغة Excel / CSV (يدعم العربية):</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={backupBusy !== ""}
                    onClick={() => downloadBackupFile("/api/backup?format=csv&type=customers", `maestro-key-customers-${new Date().toISOString().slice(0, 10)}.csv`, "csv_customers")}
                    className="btn-ghost justify-center py-2.5 text-xs font-extrabold"
                  >
                    <FileSpreadsheet size={15} />
                    {backupBusy === "csv_customers" ? "جارٍ التصدير..." : "تصدير العملاء (CSV)"}
                  </button>
                  <button
                    type="button"
                    disabled={backupBusy !== ""}
                    onClick={() => downloadBackupFile("/api/backup?format=csv&type=rentals", `maestro-key-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`, "csv_rentals")}
                    className="btn-ghost justify-center py-2.5 text-xs font-extrabold"
                  >
                    <FileSpreadsheet size={15} />
                    {backupBusy === "csv_rentals" ? "جارٍ التصدير..." : "تصدير الاشتراكات (CSV)"}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. إرسال فوري إلى قناة تيليجرام الخاصة */}
            <div className="card flex flex-col justify-between space-y-4 border border-sky-500/20 bg-gradient-to-b from-sky-500/[.04] to-transparent p-5">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400">
                    <Send size={20} />
                  </span>
                  <div>
                    <h3 className="font-black text-white">الأرشفة السحابية في تيليجرام</h3>
                    <p className="text-xs font-semibold text-slate-400">إرسال ملف JSON شامل كـ Document مرفق بتاريخ اليوم إلى قناة الأرشيف الخاصة.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3.5 text-xs font-semibold leading-relaxed text-slate-300">
                  <div>• صيغة الملف: <span dir="ltr" className="font-mono text-sky-300">maestro-key-backup-YYYY-MM-DD.json</span></div>
                  <div>• يحتوي الملخص المرفق على أعداد العملاء، المنصات، الحسابات، الاشتراكات، والسندات.</div>
                  <div>• يعمل تلقائياً كل 12 ساعة + يمكنك الإرسال الفوري في أي لحظة.</div>
                </div>
              </div>

              <button
                type="button"
                disabled={backupBusy !== ""}
                onClick={sendBackupToTelegramNow}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-sky-600 to-blue-600 py-3.5 text-sm font-black text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                <Send size={18} />
                {backupBusy === "telegram" ? "جارٍ الإرسال إلى تيليجرام..." : "إرسال نسخة احتياطية الآن إلى تيليجرام"}
              </button>
            </div>
          </div>

          {/* 3. استعادة نسخة احتياطية (رفع ملف JSON) */}
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  <Upload size={20} />
                </span>
                <div>
                  <h3 className="font-black text-white">استعادة نسخة احتياطية (رفع ملف JSON)</h3>
                  <p className="text-xs font-semibold text-slate-400">
                    يقرأ الملف ويدمج السجلات الناقصة في قاعدة البيانات بأمان تام مع تجنب التكرار والمحافظة على البيانات الحالية.
                  </p>
                </div>
              </div>

              <div>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleSelectRestoreFile}
                />
                <button
                  type="button"
                  disabled={backupBusy !== ""}
                  onClick={() => restoreInputRef.current?.click()}
                  className="btn-ghost border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-black text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Upload size={17} /> استعادة نسخة احتياطية (رفع ملف JSON)
                </button>
              </div>
            </div>

            {pendingRestore && (
              <div className="space-y-3 rounded-2xl border border-amber-400/30 bg-amber-500/[.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-amber-300">معاينة ملف النسخة الاحتياطية: <span dir="ltr" className="font-mono">{pendingRestore.filename}</span></div>
                  {pendingRestore.exportedAt && (
                    <span className="text-xs font-bold text-slate-400">تاريخ التصدير: {fmtDateTime(pendingRestore.exportedAt)}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold sm:grid-cols-5">
                  <div className="rounded-xl bg-white/[.04] p-2.5 text-center">
                    <div className="text-slate-400">العملاء</div>
                    <div className="mt-0.5 text-base font-black text-white">{pendingRestore.counts.customers}</div>
                  </div>
                  <div className="rounded-xl bg-white/[.04] p-2.5 text-center">
                    <div className="text-slate-400">الاشتراكات</div>
                    <div className="mt-0.5 text-base font-black text-white">{pendingRestore.counts.rentals}</div>
                  </div>
                  <div className="rounded-xl bg-white/[.04] p-2.5 text-center">
                    <div className="text-slate-400">المنصات</div>
                    <div className="mt-0.5 text-base font-black text-white">{pendingRestore.counts.platforms}</div>
                  </div>
                  <div className="rounded-xl bg-white/[.04] p-2.5 text-center">
                    <div className="text-slate-400">الحسابات</div>
                    <div className="mt-0.5 text-base font-black text-white">{pendingRestore.counts.accounts}</div>
                  </div>
                  <div className="rounded-xl bg-white/[.04] p-2.5 text-center">
                    <div className="text-slate-400">المدفوعات</div>
                    <div className="mt-0.5 text-base font-black text-white">{pendingRestore.counts.payments}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={backupBusy !== ""}
                    onClick={confirmRestoreBackup}
                    className="btn-gold px-5 py-2.5 text-sm font-black"
                  >
                    <CheckCircle2 size={17} />
                    {backupBusy === "restore" ? "جارٍ الدمج والاستعادة..." : "تأكيد الدمج والاستعادة الآن"}
                  </button>
                  <button
                    type="button"
                    disabled={backupBusy !== ""}
                    onClick={() => setPendingRestore(null)}
                    className="btn-ghost px-4 py-2.5 text-xs"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {restoreResult && (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[.05] p-4 text-xs font-bold">
                <div className="mb-2 text-sm font-black text-emerald-300">ملخص عملية الدمج والاستعادة:</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    ["customers", "العملاء"],
                    ["rentals", "الاشتراكات والطلبات"],
                    ["accounts", "الحسابات"],
                    ["platforms", "المنصات"],
                    ["payments", "المدفوعات"],
                    ["settings", "الإعدادات"],
                  ].map(([k, label]) => (
                    <div key={k} className="flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2">
                      <span className="text-slate-300">{label}</span>
                      <span>
                        <span className="text-emerald-300">+{restoreResult.inserted[k] || 0} مضاف</span>
                        <span className="mx-1 text-slate-600">/</span>
                        <span className="text-slate-400">{restoreResult.skipped[k] || 0} موجود</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
