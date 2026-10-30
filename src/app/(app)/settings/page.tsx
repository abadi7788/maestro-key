"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import {
  ArrowDownLeft, ArrowUpRight, Bell, Building2, CheckCircle2, History, KeyRound, LockOpen, Mail,
  MessageSquare, MinusCircle, Pencil, Plus, PlusCircle, RotateCcw, Send, Shield, Trash2, Upload, Users, Wallet, X,
} from "lucide-react";
import { api, compressLogo, fmtDateTime, money } from "@/lib/client";
import { PERMISSIONS, PERMISSION_LABELS, DEFAULT_EMPLOYEE_PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { isAdminRole } from "@/lib/roles";
import { Badge, Modal, PlatformLogo, Spinner } from "@/components/ui";
import { disablePushOnThisDevice, enablePushOnThisDevice } from "@/lib/pwa-client";
import { playAlertSound } from "@/lib/notify-sound";

type TabId = "wallets" | "users" | "platforms" | "banks" | "whatsapp" | "smtp" | "push";

const TOPUP_PRESETS = [5000, 10000, 20000, 50000, 100000];

export default function SettingsPage() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<TabId>("wallets");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [tplExp, setTplExp] = useState("");
  const [tplCred, setTplCred] = useState("");
  const [tplAct, setTplAct] = useState("");
  const [alertEmail, setAlertEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpHasSavedPass, setSmtpHasSavedPass] = useState(false);

  const [platModal, setPlatModal] = useState<any>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [newBank, setNewBank] = useState("");
  const [userForm, setUserForm] = useState<any>(null);
  const [pwReset, setPwReset] = useState<{ id: number; name: string; pw: string } | null>(null);
  const [permModal, setPermModal] = useState<{ user: any; perms: Record<string, boolean> } | null>(null);

  const [walletTxs, setWalletTxs] = useState<any[]>([]);
  const [walletModal, setWalletModal] = useState<{ user: any; mode: "topup" | "deduct"; amount: string; note: string } | null>(null);
  const [statementUser, setStatementUser] = useState<any | null>(null);
  const [statementTxs, setStatementTxs] = useState<any[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);

  const [pushStatus, setPushStatus] = useState<{ supported: boolean; permission: string; subscribed: boolean; count: number; configured: boolean } | null>(null);

  const load = useCallback(async () => {
    const [d, w] = await Promise.all([
      api("/api/admin-data?view=settings"),
      api("/api/wallet").catch(() => ({ transactions: [] })),
    ]);
    setData(d);
    setWalletTxs(w.transactions || []);
    setTplExp(d.settings.whatsapp_expiry_template || "");
    setTplCred(d.settings.whatsapp_credentials_template || "");
    setTplAct(d.settings.whatsapp_activation_template || "");
    setAlertEmail(d.settings.admin_alert_email || "");
    setSmtpHost(d.settings.smtp_host || "smtp.gmail.com");
    setSmtpPort(d.settings.smtp_port || "465");
    setSmtpUser(d.settings.smtp_user || "");
    setSmtpHasSavedPass(!!d.settings.smtp_pass);
  }, []);

  const refreshPushStatus = useCallback(async () => {
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const permission = supported ? Notification.permission : "unsupported";
    let subscribed = false;
    if (supported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        subscribed = !!sub;
      } catch {}
    }
    try {
      const s = await api("/api/push");
      setPushStatus({ supported, permission, subscribed, count: s.subscribedDevices || 0, configured: !!s.configured });
    } catch {
      setPushStatus({ supported, permission, subscribed, count: 0, configured: false });
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const qTab = new URLSearchParams(window.location.search).get("tab") as TabId | null;
      if (qTab && ["wallets", "users", "platforms", "banks", "whatsapp", "smtp", "push"].includes(qTab)) {
        setTab(qTab);
      }
    }
    load();
    refreshPushStatus();
  }, [load, refreshPushStatus]);

  useAutoRefresh(async () => {
    const [d, w] = await Promise.all([
      api("/api/admin-data?view=settings").catch(() => null),
      api("/api/wallet").catch(() => null),
    ]);
    if (d) setData((prev: any) => prev ? { ...prev, users: d.users, platforms: d.platforms, paymentMethods: d.paymentMethods, whatsappLogs: d.whatsappLogs } : d);
    if (w?.transactions) setWalletTxs(w.transactions);
  }, 25000);

  async function manage(body: any, okMsg: string) {
    setBusy(true); setMsg("");
    try {
      const r = await api("/api/manage", { method: "POST", body: JSON.stringify(body) });
      setMsg("✓ " + (r?.message || okMsg));
      await load();
      return true;
    } catch (e: any) {
      setMsg("⚠️ " + e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitWalletAdjust() {
    if (!walletModal) return;
    const amt = Number(walletModal.amount || 0);
    if (!amt || amt <= 0) {
      setMsg("⚠️ أدخل مبلغاً صحيحاً أكبر من صفر");
      return;
    }
    setBusy(true); setMsg("");
    try {
      const res = await api("/api/wallet", {
        method: "POST",
        body: JSON.stringify({
          action: walletModal.mode,
          userId: walletModal.user.id,
          amount: amt,
          note: walletModal.note.trim() || undefined,
        }),
      });
      setMsg(`✓ ${res.message || "تم تحديث المحفظة"} — الرصيد الجديد: ${Number(res.balance).toLocaleString("ar-YE")} ر.ي`);
      setWalletModal(null);
      await load();
      try { window.dispatchEvent(new Event("maestro-wallet-updated")); } catch {}
    } catch (e: any) {
      setMsg("⚠️ " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openUserStatement(u: any) {
    setStatementUser(u);
    setStatementLoading(true);
    try {
      const w = await api(`/api/wallet?userId=${u.id}`);
      setStatementTxs(w.transactions || []);
    } catch {
      setStatementTxs([]);
    } finally {
      setStatementLoading(false);
    }
  }

  if (!data) return <Spinner />;

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "wallets", label: "محافظ الموظفين", icon: <Wallet size={16} /> },
    { id: "users", label: "المستخدمون والصلاحيات", icon: <Users size={16} /> },
    { id: "platforms", label: "المنصات", icon: <Building2 size={16} /> },
    { id: "banks", label: "البنوك", icon: <Shield size={16} /> },
    { id: "whatsapp", label: "قوالب واتساب", icon: <MessageSquare size={16} /> },
    { id: "smtp", label: "البريد الإلكتروني", icon: <Mail size={16} /> },
    { id: "push", label: "إشعارات الجوال", icon: <Bell size={16} /> },
  ];

  const totalStaffWallet = (data.users || []).reduce((s: number, u: any) => s + Number(u.walletBalance || 0), 0);
  const staffMembers = (data.users || []).filter((u: any) => !isAdminRole(u.role));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-black text-white">⚙️ الإعدادات والمحافظ والصلاحيات</h1>
      <p className="mb-5 text-sm font-semibold text-slate-400">شحن محافظ الموظفين والموزعين، إدارة الصلاحيات، المنصات، البنوك، وقوالب الرسائل.</p>

      {msg && <div className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${msg.startsWith("⚠️") ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>{msg}</div>}

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
              tab === t.id ? "bg-[#2f7bff] text-white shadow-md shadow-[#2f7bff]/25" : "border border-white/10 bg-[#0d1526] text-slate-300 hover:bg-white/[.06]"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ================= WALLETS TAB ================= */}
      {tab === "wallets" && (
        <div className="space-y-5">
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="card border-amber-400/25 bg-gradient-to-br from-amber-400/10 to-transparent p-4">
              <div className="text-xs font-bold text-amber-300">إجمالي أرصدة المحافظ الحالية</div>
              <div className="mt-1 font-mono text-2xl font-black text-white">{money(totalStaffWallet)}</div>
              <div className="mt-1 text-[11px] font-semibold text-slate-400">رصيد جاهز للشراء والاعتماد الفوري</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-bold text-slate-400">عدد الموظفين والموزعين</div>
              <div className="mt-1 text-2xl font-black text-white">{staffMembers.length} <span className="text-sm font-bold text-slate-400">موظف</span></div>
              <div className="mt-1 text-[11px] font-semibold text-slate-400">إضافة موظف جديد من تبويب المستخدمين</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-bold text-slate-400">آخر حركات المحافظ المسجلة</div>
              <div className="mt-1 text-2xl font-black text-white">{walletTxs.length} <span className="text-sm font-bold text-slate-400">حركة</span></div>
              <div className="mt-1 text-[11px] font-semibold text-slate-400">توثيق كامل للشحن والخصم والاسترداد</div>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-black text-white">💳 أرصدة الموظفين والموزعين</h2>
                <p className="text-xs font-semibold text-slate-400">اشحن رصيد أي موظف ليتمكن من البيع والاعتماد الفوري من نقطة البيع دون انتظار مراجعة سند بنكي.</p>
              </div>
              <button onClick={() => setUserForm({ role: "EMPLOYEE", openWallet: true, initialBalance: "0", permissions: { ...DEFAULT_EMPLOYEE_PERMISSIONS } })} className="btn-ghost text-xs">
                <Plus size={15} /> موظف / موزع جديد
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {data.users.map((u: any) => {
                const isAdmin = isAdminRole(u.role);
                return (
                  <div key={u.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-white">{u.displayName}</span>
                          <Badge tone={isAdmin ? "gold" : "blue"}>{isAdmin ? "مدير" : "موظف / موزع"}</Badge>
                          {!u.isActive && <Badge tone="red">معطَّل</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs font-semibold text-slate-400">@{u.username}</div>
                      </div>
                      <div className="text-left">
                        <div className="text-[10px] font-bold text-slate-400">الرصيد الحالي</div>
                        <div className="font-mono text-lg font-black text-amber-300">{money(u.walletBalance || 0)}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-dashed border-white/10 pt-3">
                      <button
                        type="button"
                        onClick={() => setWalletModal({ user: u, mode: "topup", amount: "", note: "" })}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"
                      >
                        <PlusCircle size={15} /> شحن رصيد
                      </button>
                      <button
                        type="button"
                        onClick={() => setWalletModal({ user: u, mode: "deduct", amount: "", note: "" })}
                        disabled={!u.walletBalance || u.walletBalance <= 0}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-extrabold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        <MinusCircle size={15} /> خصم / تسوية
                      </button>
                      <button
                        type="button"
                        onClick={() => openUserStatement(u)}
                        className="btn-ghost px-3 py-2 text-xs"
                      >
                        <History size={15} /> السجل
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-black text-white">📜 أحدث حركات المحافظ (جميع الموظفين)</h3>
            {walletTxs.length === 0 ? (
              <p className="py-8 text-center text-sm font-semibold text-slate-400">لا توجد حركات محافظ بعد — ابدأ بشحن رصيد أحد الموظفين أعلاه.</p>
            ) : (
              <div className="space-y-2">
                {walletTxs.slice(0, 40).map((tx: any) => {
                  const isCredit = tx.type === "TOPUP" || tx.type === "REFUND";
                  const label =
                    tx.type === "TOPUP" ? "شحن رصيد" :
                    tx.type === "REFUND" ? "استرداد طلب" :
                    tx.type === "DEDUCT" ? "تسوية خصم" : "شراء اشتراك";
                  return (
                    <div key={tx.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.02] px-3.5 py-2.5 text-xs">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                          tx.type === "REFUND" ? "bg-sky-500/15 text-sky-300" :
                          isCredit ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
                        }`}>
                          {tx.type === "REFUND" ? <RotateCcw size={15} /> : isCredit ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-extrabold text-white">{tx.userDisplayName || tx.username}</span>
                            <Badge tone={tx.type === "REFUND" ? "blue" : isCredit ? "green" : "red"}>{label}</Badge>
                            {tx.rentalId && <span className="font-mono text-[11px] text-slate-400">طلب #{tx.rentalId}</span>}
                          </div>
                          <div className="mt-0.5 truncate text-slate-400">
                            {tx.note || "—"} • {fmtDateTime(tx.createdAt)}
                            {tx.createdByName ? ` • المنفذ: ${tx.createdByName}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="text-left">
                        <div dir="ltr" className={`font-mono text-sm font-black ${isCredit ? "text-emerald-300" : "text-red-300"}`}>
                          {isCredit ? "+" : "-"}{Number(tx.amount).toLocaleString("ar-YE")} ر.ي
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          بعد العملية: {Number(tx.balanceAfter).toLocaleString("ar-YE")} ر.ي
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= USERS & PERMISSIONS TAB ================= */}
      {tab === "users" && (
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-black text-white">حسابات الموظفين والمديرين والصلاحيات</h2>
              <p className="text-xs font-semibold text-slate-400">تحكم في حسابات الموظفين، أرصدتهم، وصلاحيات كل موظف بدقة.</p>
            </div>
            <button onClick={() => setUserForm({ role: "EMPLOYEE", openWallet: true, initialBalance: "0", permissions: { ...DEFAULT_EMPLOYEE_PERMISSIONS } })} className="btn-gold text-xs"><Plus size={16} /> مستخدم جديد</button>
          </div>
          <div className="space-y-2.5">
            {data.users.map((u: any) => {
              const isAdmin = isAdminRole(u.role);
              const isLocked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-white">{u.displayName}</span>
                      <Badge tone={isAdmin ? "gold" : "blue"}>{isAdmin ? "مدير النظام" : u.role === "USER" ? "موزع" : "موظف مبيعات"}</Badge>
                      {!u.isActive && <Badge tone="red">معطَّل</Badge>}
                      {isLocked && <Badge tone="red">🔒 مقفل مؤقتاً</Badge>}
                      <Badge tone="amber">💳 {Number(u.walletBalance || 0).toLocaleString("ar-YE")} ر.ي</Badge>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-400">
                      @{u.username} • آخر دخول: {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "لم يدخل بعد"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setWalletModal({ user: u, mode: "topup", amount: "", note: "" })}
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-extrabold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <Wallet size={14} /> شحن محفظة
                    </button>
                    {!isAdmin && (
                      <button
                        onClick={() => setPermModal({ user: u, perms: { ...DEFAULT_EMPLOYEE_PERMISSIONS, ...(u.permissions || {}) } })}
                        className="inline-flex items-center gap-1 rounded-xl border border-[#63a8ff]/30 bg-[#2f7bff]/15 px-3 py-1.5 text-xs font-extrabold text-[#8ec0ff] hover:bg-[#2f7bff]/25"
                      >
                        <Shield size={14} /> الصلاحيات
                      </button>
                    )}
                    <button onClick={() => setPwReset({ id: u.id, name: u.displayName, pw: "" })} className="btn-ghost px-3 py-1.5 text-xs"><KeyRound size={14} /> كلمة مرور</button>
                    {(isLocked || (u.failedAttempts ?? 0) > 0) && (
                      <button onClick={() => manage({ action: "updateUser", id: u.id, unlock: true }, "تم فك قفل الحساب")} className="btn-ghost px-3 py-1.5 text-xs"><LockOpen size={14} /> فك القفل</button>
                    )}
                    <button onClick={() => manage({ action: "updateUser", id: u.id, role: isAdmin ? "EMPLOYEE" : "ADMIN" }, "تم تعديل الدور")} className="btn-ghost px-3 py-1.5 text-xs">
                      تحويل إلى {isAdmin ? "موظف" : "مدير"}
                    </button>
                    <button onClick={() => manage({ action: "updateUser", id: u.id, isActive: !u.isActive }, u.isActive ? "تم تعطيل الحساب" : "تم تفعيل الحساب")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-extrabold ${u.isActive ? "bg-amber-500/15 text-amber-300" : "bg-emerald-600 text-white"}`}>
                      {u.isActive ? "تعطيل" : "تفعيل"}
                    </button>
                    <button disabled={busy} onClick={() => {
                      if (!confirm(`حذف المستخدم "${u.displayName}" (@${u.username}) نهائياً؟\nسيتم الاحتفاظ بكل المبيعات والسجلات التي أنشأها.`)) return;
                      manage({ action: "deleteUser", id: u.id }, `تم حذف ${u.displayName}`);
                    }} className="inline-flex items-center gap-1 rounded-xl bg-red-500/15 px-3 py-1.5 text-xs font-extrabold text-red-300 hover:bg-red-500/25">
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= PLATFORMS TAB ================= */}
      {tab === "platforms" && (
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-black text-white">المنصات الرقمية وشعاراتها</h2>
              <p className="text-xs font-semibold text-slate-400">اضغط ✏️ لتعديل اسم المنصة، شعارها، طريقة تسليمها، أو حد تنبيه المخزون.</p>
            </div>
            <button onClick={() => setPlatModal({ name: "", color: "#0f172a", imageUrl: "", isActive: true, deliveryMode: "INSTANT_INVENTORY", requiresCustomerEmail: false, extraFieldLabel: "", isLifetime: false, lowStockThreshold: 3 })} className="btn-gold text-xs">
              <Plus size={16} /> إضافة منصة جديدة
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.platforms.map((p: any) => {
              const dm = String(p.deliveryMode || "INSTANT_INVENTORY").toUpperCase();
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <PlatformLogo src={p.imageUrl} name={p.name} color={p.color} size={48} />
                    <div className="min-w-0">
                      <div className="truncate font-extrabold text-white">{p.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={p.isActive ? "green" : "slate"}>{p.isActive ? "مفعّلة" : "مخفية"}</Badge>
                        {dm === "LINK_ONLY" ? (
                          <Badge tone="blue">🔗 رابط فقط</Badge>
                        ) : dm === "ON_DEMAND_EMAIL" || dm === "ON_DEMAND" ? (
                          <Badge tone="gold">⚡ تفعيل إيميل</Badge>
                        ) : (
                          <Badge tone="slate">📦 مخزون (تنبيه ≤ {p.lowStockThreshold ?? 3})</Badge>
                        )}
                        {p.isLifetime && <Badge tone="gold">♾️ دائم</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => setPlatModal({ ...p, lowStockThreshold: p.lowStockThreshold ?? 3 })} className="btn-ghost px-2.5 py-2 text-xs" title="تعديل"><Pencil size={15} /></button>
                    <button onClick={() => manage({ action: "upsertPlatform", ...p, isActive: !p.isActive }, "تم تحديث المنصة")}
                      className="btn-ghost px-2.5 py-2 text-xs">{p.isActive ? "إخفاء" : "تفعيل"}</button>
                    <button disabled={busy} onClick={() => {
                      if (!confirm(`حذف المنصة "${p.name}" نهائياً؟ (لا يمكن حذفها إن كان عليها حسابات في المخزون)`)) return;
                      manage({ action: "deletePlatform", id: p.id }, `تم حذف ${p.name}`);
                    }} className="rounded-xl bg-red-500/15 p-2 text-red-300 hover:bg-red-500/25" title="حذف"><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= BANKS TAB ================= */}
      {tab === "banks" && (
        <div className="card space-y-4 p-5">
          <h2 className="font-black text-white">البنوك ووسائل الدفع</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.paymentMethods.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[.03] p-3.5">
                <div className="flex items-center gap-2"><span className="font-extrabold text-white">{b.name}</span><Badge tone={b.isActive ? "green" : "slate"}>{b.isActive ? "مفعّل" : "مخفي"}</Badge></div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => manage({ action: "upsertBank", id: b.id, name: b.name, isActive: !b.isActive }, "تم التحديث")} className="btn-ghost px-3 py-1.5 text-xs">{b.isActive ? "إخفاء" : "تفعيل"}</button>
                  <button disabled={busy} onClick={() => {
                    if (!confirm(`حذف البنك "${b.name}"؟\n(إن كان مرتبطاً بسندات قديمة سيتم إخفاؤه فقط حفاظاً على السجل المالي)`)) return;
                    manage({ action: "deleteBank", id: b.id }, `تم حذف ${b.name}`);
                  }} className="rounded-xl bg-red-500/15 p-2 text-red-300 hover:bg-red-500/25" title="حذف"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2.5 border-t border-white/10 pt-4">
            <input className="field flex-1" placeholder="بنك جديد (مثال: الكريمي، النجم، جوالي…)" value={newBank} onChange={(e) => setNewBank(e.target.value)} />
            <button onClick={async () => { if (!newBank.trim()) return; if (await manage({ action: "upsertBank", name: newBank }, "تمت إضافة البنك")) setNewBank(""); }} className="btn-gold">إضافة</button>
          </div>
        </div>
      )}

      {/* ================= WHATSAPP TAB ================= */}
      {tab === "whatsapp" && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-black text-white">قوالب رسائل الواتساب</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">المتغيرات المتاحة: <code className="rounded bg-white/10 px-1.5 py-0.5 text-amber-300">{"{{name}} {{platform}} {{end_date}} {{days}} {{email}} {{password}} {{profile}} {{pin}} {{link}} {{note}} {{credentials}}"}</code></p>
          </div>
          <div>
            <label className="label">١) رسالة تذكير انتهاء الاشتراك (قبل يومين)</label>
            <textarea rows={4} className="field" value={tplExp} onChange={(e) => setTplExp(e.target.value)} />
          </div>
          <div>
            <label className="label">٢) رسالة تسليم بيانات حساب جاهز من المخزون (نتفلكس، شاهد…)</label>
            <textarea rows={5} className="field" value={tplCred} onChange={(e) => setTplCred(e.target.value)} />
          </div>
          <div>
            <label className="label">٣) رسالة تأكيد تفعيل اشتراك عند الطلب (يوتيوب بريميوم…)</label>
            <textarea rows={4} className="field" value={tplAct} onChange={(e) => setTplAct(e.target.value)} />
          </div>
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-200">
            وضع الإرسال الحالي: <b>قائمة ذكية مجانية بنقرة واحدة (wa.me)</b> — وللإرسال الخلفي التلقائي الكامل أضف <code className="text-white">WHATSAPP_TOKEN</code> و <code className="text-white">WHATSAPP_PHONE_ID</code> في إعدادات السيرفر.
          </div>
          <button disabled={busy} onClick={() => manage({ action: "saveSettings", settings: { whatsapp_expiry_template: tplExp, whatsapp_credentials_template: tplCred, whatsapp_activation_template: tplAct } }, "تم حفظ القوالب")} className="btn-gold">حفظ القوالب</button>

          {data.whatsappLogs?.length > 0 && (
            <div className="border-t border-white/10 pt-4">
              <h3 className="mb-2 text-sm font-black text-white">آخر الرسائل المسجلة ({data.whatsappLogs.length})</h3>
              <div className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                {data.whatsappLogs.slice(0, 20).map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2">
                    <span className="truncate font-semibold text-slate-300">{l.phone} — {l.message.slice(0, 60)}…</span>
                    <Badge tone={l.status === "SENT" ? "green" : "amber"}>{l.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= SMTP TAB ================= */}
      {tab === "smtp" && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-black text-white">✉️ إعدادات البريد الإلكتروني</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">يُستخدم لإرسال رموز استعادة كلمة المرور وتنبيهات الطلبات الجديدة لبريدك.</p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">📧 بريد المدير لاستقبال تنبيهات الطلبات</label>
              <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="admin@gmail.com" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} />
            </div>
            <div><label className="label">خادم الإرسال (SMTP Host)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></div>
            <div><label className="label">المنفذ (Port)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></div>
            <div><label className="label">بريد المرسل (Gmail)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="store@gmail.com" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} /></div>
            <div>
              <label className="label">كلمة مرور التطبيقات (App Password — 16 حرفاً)</label>
              <input type="password" className="field" dir="ltr" style={{ textAlign: "left" }} placeholder={smtpHasSavedPass ? "•••••••• (محفوظة ومشفرة — اتركها فارغة للإبقاء عليها)" : "xxxx xxxx xxxx xxxx"} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3.5 text-xs font-semibold leading-relaxed text-amber-200">
            💡 في حساب Gmail فعّل التحقق بخطوتين ثم من <b>App Passwords</b> أنشئ كلمة مرور من 16 حرفاً والصقها أعلاه — تُشفَّر بـ AES-256 قبل الحفظ.
          </div>
          <button disabled={busy} onClick={() => manage({ action: "saveSettings", settings: {
            admin_alert_email: alertEmail.trim(), smtp_host: smtpHost.trim(), smtp_port: smtpPort.trim(),
            smtp_user: smtpUser.trim(), ...(smtpPass.trim() ? { smtp_pass: smtpPass.trim().replace(/\s/g, "") } : {}),
          } }, "تم حفظ إعدادات البريد")} className="btn-gold">حفظ إعدادات البريد</button>
        </div>
      )}

      {/* ================= PUSH TAB ================= */}
      {tab === "push" && (
        <div className="card space-y-4 p-5">
          <div>
            <h2 className="font-black text-white">🔔 إشعارات الجوال وسطح المكتب الفورية</h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">تصلك إشعارات منبثقة بصوت تنبيه حتى لو كان المتصفح مغلقاً فور رفع طلب جديد أو شحن محفظة.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-white">حالة هذا الجهاز:</span>
                {pushStatus?.subscribed ? <Badge tone="green"><CheckCircle2 size={12} /> مفعَّل</Badge> : <Badge tone="amber">غير مفعَّل بعد</Badge>}
                <Badge tone="blue">أجهزة مسجّلة لحسابك: {pushStatus?.count ?? 0}</Badge>
              </div>
              <div className="text-xs font-semibold text-slate-400">
                {!pushStatus?.supported ? "هذا المتصفح لا يدعم Web Push — ثبّت التطبيق على الشاشة الرئيسية أولاً (أندرويد كروم أو آيفون iOS 16.4+)."
                  : pushStatus.permission === "denied" ? "تم حظر الإشعارات من إعدادات المتصفح — اسمح بها من قفل العنوان أعلى الصفحة ثم أعد المحاولة."
                  : "فعّل الزر المقابل ليبدأ هذا الجهاز باستقبال الإشعارات الفورية."}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!pushStatus?.subscribed ? (
                <button disabled={busy || !pushStatus?.supported} onClick={async () => {
                  setBusy(true); setMsg("");
                  const r = await enablePushOnThisDevice();
                  setBusy(false);
                  setMsg(r.ok ? "✓ تم تفعيل الإشعارات الفورية على هذا الجهاز" : "⚠️ " + (r.reason || "تعذر التفعيل"));
                  playAlertSound();
                  refreshPushStatus();
                }} className="btn-gold text-xs"><Bell size={15} /> تفعيل على هذا الجهاز</button>
              ) : (
                <button disabled={busy} onClick={async () => {
                  setBusy(true); await disablePushOnThisDevice(); setBusy(false);
                  setMsg("✓ تم إيقاف الإشعارات على هذا الجهاز"); refreshPushStatus();
                }} className="btn-ghost text-xs">إيقاف على هذا الجهاز</button>
              )}
              <button disabled={busy} onClick={async () => {
                setBusy(true); setMsg("");
                try {
                  playAlertSound();
                  const r = await api("/api/push", { method: "POST", body: JSON.stringify({ action: "test" }) });
                  setMsg(r.sent > 0 ? `✓ أُرسل إشعار تجريبي إلى ${r.sent} جهاز` : "✓ أُنشئ تنبيه تجريبي (فعّل الإشعارات على الجهاز أولاً ليصل خارج المتصفح)");
                } catch (e: any) { setMsg("⚠️ " + e.message); }
                finally { setBusy(false); }
              }} className="btn-primary text-xs"><Send size={14} /> إرسال إشعار تجريبي الآن</button>
            </div>
          </div>
          <div className="rounded-xl bg-white/[.04] p-3.5 text-xs font-semibold leading-relaxed text-slate-300">
            📱 <b>لتثبيت التطبيق على الجوال:</b> من كروم (أندرويد) اضغط زر «تثبيت التطبيق» العائم أو من قائمة النقاط الثلاث اختر «إضافة إلى الشاشة الرئيسية». على آيفون افتح الموقع في Safari ثم زر المشاركة ← «إضافة إلى الشاشة الرئيسية».
          </div>
        </div>
      )}

      {/* ================= MODALS ================= */}

      <Modal
        open={!!walletModal}
        onClose={() => setWalletModal(null)}
        title={walletModal?.mode === "deduct" ? `➖ تسوية / خصم من محفظة ${walletModal?.user?.displayName}` : `💳 شحن محفظة ${walletModal?.user?.displayName}`}
      >
        {walletModal && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3">
              <div>
                <div className="text-xs font-bold text-slate-300">{walletModal.user.displayName} (@{walletModal.user.username})</div>
                <div className="text-[11px] font-semibold text-slate-400">الرصيد الحالي المتاح</div>
              </div>
              <div className="font-mono text-lg font-black text-amber-300">{money(walletModal.user.walletBalance || 0)}</div>
            </div>

            {walletModal.mode === "topup" && (
              <div>
                <label className="label">مبالغ شحن سريعة (ر.ي)</label>
                <div className="flex flex-wrap gap-2">
                  {TOPUP_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWalletModal({ ...walletModal, amount: String(preset) })}
                      className={`rounded-xl border px-3 py-1.5 font-mono text-xs font-black transition ${
                        Number(walletModal.amount) === preset
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                          : "border-white/10 bg-white/[.03] text-slate-300 hover:border-white/25"
                      }`}
                    >
                      +{preset.toLocaleString("ar-YE")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">المبلغ (ريال يمني) <span className="text-red-400">*</span></label>
              <input
                className="field font-mono text-lg font-black text-amber-300"
                inputMode="numeric"
                placeholder="مثال: 20000"
                value={walletModal.amount}
                onChange={(e) => setWalletModal({ ...walletModal, amount: e.target.value.replace(/[^\d]/g, "") })}
              />
            </div>

            <div>
              <label className="label">ملاحظة العملية (تظهر في سجل الموظف)</label>
              <input
                className="field"
                placeholder={walletModal.mode === "topup" ? "مثال: إيداع نقدي / حوالة الكريمي" : "مثال: تسوية رصيد"}
                value={walletModal.note}
                onChange={(e) => setWalletModal({ ...walletModal, note: e.target.value })}
              />
            </div>

            {Number(walletModal.amount) > 0 && (
              <div className="rounded-xl bg-white/[.04] px-3.5 py-2.5 text-center text-xs font-bold text-slate-300">
                الرصيد المتوقع بعد العملية:{" "}
                <b className="font-mono text-white">
                  {money(
                    walletModal.mode === "topup"
                      ? Number(walletModal.user.walletBalance || 0) + Number(walletModal.amount)
                      : Math.max(0, Number(walletModal.user.walletBalance || 0) - Number(walletModal.amount))
                  )}
                </b>
              </div>
            )}

            <button
              type="button"
              disabled={busy || !walletModal.amount || Number(walletModal.amount) <= 0}
              onClick={submitWalletAdjust}
              className={walletModal.mode === "deduct" ? "btn-danger w-full" : "btn-gold w-full"}
            >
              {busy ? "جارٍ التنفيذ…" : walletModal.mode === "deduct" ? "تأكيد الخصم من المحفظة" : "✓ تأكيد شحن المحفظة الآن"}
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!statementUser} onClose={() => setStatementUser(null)} title={`📜 كشف محفظة: ${statementUser?.displayName || ""}`} wide>
        {statementLoading ? (
          <Spinner />
        ) : statementTxs.length === 0 ? (
          <p className="py-10 text-center text-sm font-bold text-slate-400">لا توجد حركات مسجلة لهذا المستخدم بعد.</p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {statementTxs.map((tx: any) => {
              const isCredit = tx.type === "TOPUP" || tx.type === "REFUND";
              const label =
                tx.type === "TOPUP" ? "شحن رصيد" :
                tx.type === "REFUND" ? "استرداد طلب" :
                tx.type === "DEDUCT" ? "تسوية خصم" : "شراء اشتراك";
              return (
                <div key={tx.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3.5 py-2.5 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={tx.type === "REFUND" ? "blue" : isCredit ? "green" : "red"}>{label}</Badge>
                      {tx.rentalId && <span className="font-mono text-slate-400">طلب #{tx.rentalId}</span>}
                    </div>
                    <div className="mt-1 font-semibold text-slate-300">{tx.note || "—"}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{fmtDateTime(tx.createdAt)}{tx.createdByName ? ` • بواسطة: ${tx.createdByName}` : ""}</div>
                  </div>
                  <div className="text-left font-mono">
                    <div dir="ltr" className={`text-sm font-black ${isCredit ? "text-emerald-300" : "text-red-300"}`}>
                      {isCredit ? "+" : "-"}{Number(tx.amount).toLocaleString("ar-YE")}
                    </div>
                    <div className="text-[11px] text-slate-400">الرصيد: {Number(tx.balanceAfter).toLocaleString("ar-YE")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal open={!!permModal} onClose={() => setPermModal(null)} title={`🛡️ صلاحيات الموظف: ${permModal?.user?.displayName || ""}`}>
        {permModal && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-400">حدد الصلاحيات المسموحة لهذا الموظف بدقة:</p>
            <div className="space-y-2">
              {(Object.values(PERMISSIONS) as PermissionKey[]).map((key) => {
                const info = PERMISSION_LABELS[key];
                const checked = !!permModal.perms[key];
                return (
                  <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${checked ? "border-[#63a8ff]/40 bg-[#2f7bff]/10" : "border-white/10 bg-white/[.02]"}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[#2f7bff]"
                      checked={checked}
                      onChange={(e) => setPermModal({ ...permModal, perms: { ...permModal.perms, [key]: e.target.checked } })}
                    />
                    <div>
                      <div className="text-xs font-black text-white">{info.title}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{info.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <button
              disabled={busy}
              onClick={async () => {
                if (await manage({ action: "updateUser", id: permModal.user.id, permissions: permModal.perms }, `تم تحديث صلاحيات ${permModal.user.displayName}`)) {
                  setPermModal(null);
                }
              }}
              className="btn-gold mt-2 w-full"
            >
              حفظ الصلاحيات
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!platModal} onClose={() => setPlatModal(null)} title={platModal?.id ? `✏️ تعديل منصة: ${platModal.name}` : "➕ إضافة منصة جديدة"}>
        {platModal && (
          <div className="space-y-3.5">
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.03] p-3.5">
              <PlatformLogo src={platModal.imageUrl} name={platModal.name || "؟"} color={platModal.color} size={64} />
              <div className="flex flex-1 flex-wrap gap-2">
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try { const dataUrl = await compressLogo(f); setPlatModal((m: any) => ({ ...m, imageUrl: dataUrl })); } catch (er: any) { setMsg("⚠️ " + er.message); }
                }} />
                <button type="button" onClick={() => logoInputRef.current?.click()} className="btn-ghost px-3 py-2 text-xs">
                  <Upload size={14} /> {platModal.imageUrl ? "تغيير الشعار" : "رفع صورة شعار"}
                </button>
                {platModal.imageUrl && (
                  <button type="button" onClick={() => setPlatModal({ ...platModal, imageUrl: "" })} className="inline-flex items-center gap-1 rounded-xl border border-red-400/30 px-2.5 py-2 text-xs font-bold text-red-300">
                    <X size={13} /> إزالة الصورة
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="label">اسم المنصة</label>
              <input className="field" placeholder="مثال: شاهد VIP، كرانشي رول، سبوتيفاي…" value={platModal.name || ""} onChange={(e) => setPlatModal({ ...platModal, name: e.target.value })} />
            </div>
            <div>
              <label className="label">لون احتياطي (عند عدم وجود صورة)</label>
              <input type="color" className="h-11 w-full cursor-pointer rounded-xl border border-white/15 bg-[#090f1d] p-1" value={platModal.color || "#0f172a"} onChange={(e) => setPlatModal({ ...platModal, color: e.target.value })} />
            </div>
            <div>
              <label className="label">طريقة التسليم عند البيع</label>
              <select className="field" value={platModal.deliveryMode === "ON_DEMAND" ? "ON_DEMAND_EMAIL" : (platModal.deliveryMode || "INSTANT_INVENTORY")} onChange={(e) => {
                const dm = e.target.value;
                setPlatModal({
                  ...platModal,
                  deliveryMode: dm,
                  requiresCustomerEmail: dm === "ON_DEMAND_EMAIL" ? true : dm === "LINK_ONLY" ? false : platModal.requiresCustomerEmail,
                });
              }}>
                <option value="INSTANT_INVENTORY">📦 مخزون فوري — يسحب حساب/بروفايل/كود جاهز من المخزون</option>
                <option value="ON_DEMAND_EMAIL">⚡ تفعيل على إيميل العميل — يرسل إشعاراً للمدير مع إيميل العميل</option>
                <option value="LINK_ONLY">🔗 إرسال رابط فقط — يضع المدير رابط الاشتراك وينسخه الموظف للعميل</option>
              </select>
            </div>
            {(platModal.deliveryMode === "INSTANT_INVENTORY" || !platModal.deliveryMode) && (
              <div>
                <label className="label">حد التنبيه لانخفاض المخزون (تنبيه عند بقاء هذا العدد أو أقل)</label>
                <input
                  className="field font-mono"
                  inputMode="numeric"
                  value={platModal.lowStockThreshold ?? 3}
                  onChange={(e) => setPlatModal({ ...platModal, lowStockThreshold: Number(e.target.value.replace(/\D/g, "") || 0) })}
                />
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-extrabold text-amber-300">
              <input type="checkbox" checked={!!platModal.isLifetime} onChange={(e) => setPlatModal({ ...platModal, isLifetime: e.target.checked })} />
              ♾️ اشتراك دائم مدى الحياة (بدون مدة ولا تاريخ انتهاء — مثل كانفا برو)
            </label>
            {platModal.deliveryMode !== "LINK_ONLY" && (
              <>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-white/[.04] px-3.5 py-2.5 text-xs font-bold text-slate-300">
                  <input type="checkbox" checked={!!platModal.requiresCustomerEmail} disabled={platModal.deliveryMode === "ON_DEMAND_EMAIL"}
                    onChange={(e) => setPlatModal({ ...platModal, requiresCustomerEmail: e.target.checked })} />
                  طلب البريد الإلكتروني للعميل إلزامياً في شاشة البيع
                </label>
                <div>
                  <label className="label">حقل إضافي اختياري من العميل (اتركه فارغاً إن لم يلزم)</label>
                  <input className="field" placeholder="مثال: اسم حساب العميل أو بلد المتجر…" value={platModal.extraFieldLabel || ""} onChange={(e) => setPlatModal({ ...platModal, extraFieldLabel: e.target.value })} />
                </div>
              </>
            )}
            <button disabled={busy || !platModal.name?.trim()} onClick={async () => {
              if (await manage({ action: "upsertPlatform", ...platModal }, platModal.id ? "تم حفظ تعديلات المنصة" : "تمت إضافة المنصة")) setPlatModal(null);
            }} className="btn-gold w-full">حفظ المنصة</button>
          </div>
        )}
      </Modal>

      <Modal open={!!userForm} onClose={() => setUserForm(null)} title="إضافة موظف / موزع جديد">
        <div className="space-y-3">
          <div><label className="label">الاسم الظاهر</label><input className="field" placeholder="مثال: محمد علي" value={userForm?.displayName || ""} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} /></div>
          <div><label className="label">اسم الدخول (إنجليزي بدون مسافات)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="mohammed" value={userForm?.username || ""} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></div>
          <div><label className="label">كلمة المرور (6 أحرف على الأقل)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={userForm?.password || ""} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></div>
          <div>
            <label className="label">الدور</label>
            <select className="field" value={userForm?.role || "EMPLOYEE"} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              <option value="EMPLOYEE">موظف مبيعات (نقطة البيع + محفظة خاصة)</option>
              <option value="USER">موزع معتمد (نقطة البيع + محفظة خاصة)</option>
              <option value="ADMIN">مدير النظام (كل الصلاحيات)</option>
            </select>
          </div>
          <div>
            <label className="label">رصيد افتتاحي للمحفظة (اختياري — ر.ي)</label>
            <input className="field font-mono text-amber-300" inputMode="numeric" placeholder="0" value={userForm?.initialBalance || ""} onChange={(e) => setUserForm({ ...userForm, openWallet: true, initialBalance: e.target.value.replace(/\D/g, "") })} />
          </div>
          <button disabled={busy} onClick={async () => { if (await manage({ action: "createUser", ...userForm }, "تم إنشاء الحساب وتجهيز محفظته")) setUserForm(null); }} className="btn-gold w-full">إنشاء الحساب</button>
        </div>
      </Modal>

      <Modal open={!!pwReset} onClose={() => setPwReset(null)} title={`تغيير كلمة مرور: ${pwReset?.name}`}>
        <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="كلمة المرور الجديدة" value={pwReset?.pw || ""} onChange={(e) => setPwReset(pwReset ? { ...pwReset, pw: e.target.value } : null)} />
        <button disabled={busy} onClick={async () => { if (pwReset && await manage({ action: "updateUser", id: pwReset.id, password: pwReset.pw }, "تم تحديث كلمة المرور")) setPwReset(null); }} className="btn-gold mt-4 w-full">حفظ</button>
      </Modal>
    </div>
  );
}
