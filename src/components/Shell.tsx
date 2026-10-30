"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, ShoppingCart, BellRing, Boxes, ReceiptText, Users, Trash2,
  Settings, ScrollText, LogOut, History, Menu, X, ShieldCheck, RefreshCcw, Wallet,
  ArrowDownLeft, ArrowUpRight, RotateCcw, ExternalLink, KeyRound,
} from "lucide-react";
import { api, fetchMe, fmtDateTime, money, type Me } from "@/lib/client";
import { isAdminRole, normalizeRole } from "@/lib/roles";
import BrandLogo from "@/components/BrandLogo";
import AlertWatcher from "@/components/AlertWatcher";
import { Badge, Modal, Spinner } from "@/components/ui";

type NavItem = { href: string; label: string; icon: ReactNode; adminOnly?: boolean; employeeOnly?: boolean; mobile?: boolean };

const NAV: NavItem[] = [
  { href: "/sale", label: "نقطة البيع", icon: <ShoppingCart size={20} />, mobile: true },
  { href: "/dashboard", label: "الرئيسية", icon: <LayoutDashboard size={20} />, mobile: true },
  { href: "/inbox", label: "التنبيهات والإجراءات", icon: <BellRing size={20} />, adminOnly: true, mobile: true },
  { href: "/renewals", label: "تجديدات مستحقة", icon: <RefreshCcw size={20} />, mobile: true },
  { href: "/accounts", label: "مخزون الحسابات", icon: <Boxes size={20} />, adminOnly: true, mobile: true },
  { href: "/rentals", label: "المبيعات والسندات", icon: <ReceiptText size={20} />, adminOnly: true },
  { href: "/customers", label: "العملاء", icon: <Users size={20} />, adminOnly: true },
  { href: "/trash", label: "سلة المحذوفات", icon: <Trash2 size={20} />, adminOnly: true },
  { href: "/my-sales", label: "مبيعاتي", icon: <History size={20} />, employeeOnly: true, mobile: true },
  { href: "/audit", label: "سجل التدقيق", icon: <ScrollText size={20} />, adminOnly: true },
  { href: "/settings", label: "الإعدادات والمحافظ", icon: <Settings size={20} />, adminOnly: true },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  // نافذة المحفظة وكشف الحساب
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletTxs, setWalletTxs] = useState<any[]>([]);

  // نافذة تغيير كلمة المرور الذاتي
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const refreshMeAndCounts = useCallback(async () => {
    const u = await fetchMe();
    if (!u) {
      router.replace("/login");
      return null;
    }
    setMe(u);
    if (isAdminRole(u.role)) {
      try {
        const [rent, dash] = await Promise.all([
          api("/api/rentals?view=all").catch(() => ({ rentals: [] })),
          api("/api/admin-data?view=dashboard").catch(() => ({ stats: { pendingPayments: 0, needsPasswordChange: 0, pendingActivations: 0 } })),
        ]);
        const ended = rent.rentals?.filter((r: any) => r.status === "ENDED").length || 0;
        const pendingAct = dash.stats?.pendingActivations || 0;
        setInboxCount(ended + pendingAct + (dash.stats?.pendingPayments || 0) + (dash.stats?.needsPasswordChange || 0));
      } catch {}
    }
    return u;
  }, [router]);

  useEffect(() => {
    refreshMeAndCounts().finally(() => setLoading(false));
  }, [pathname, refreshMeAndCounts]);

  useEffect(() => {
    const onWalletEvent = () => {
      void fetchMe().then((u) => { if (u) setMe(u); });
    };
    window.addEventListener("maestro-wallet-updated", onWalletEvent);
    return () => window.removeEventListener("maestro-wallet-updated", onWalletEvent);
  }, []);

  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      await refreshMeAndCounts();
      try { window.dispatchEvent(new Event("maestro-sync")); } catch {}
    };
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void tick();
    }, 25000);
    return () => clearInterval(t);
  }, [me, refreshMeAndCounts]);

  async function openWalletModal() {
    setWalletOpen(true);
    setWalletLoading(true);
    try {
      const [wData, freshMe] = await Promise.all([
        api("/api/wallet").catch(() => ({ balance: me?.walletBalance || 0, transactions: [] })),
        fetchMe().catch(() => null),
      ]);
      if (freshMe) setMe(freshMe);
      setWalletTxs(wData.transactions || []);
    } finally {
      setWalletLoading(false);
    }
  }

  if (loading) return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#070b14]">
      <BrandLogo size={112} />
      <p className="font-black text-white">Maestro Key…</p>
    </div>
  );
  if (!me) return null;

  const admin = isAdminRole(me.role);
  const normRole = normalizeRole(me.role);
  const roleTitle = admin ? "مدير النظام" : normRole === "USER" ? "موزع / مستخدم" : "موظف مبيعات";

  const visibleItems = NAV.filter((n) => {
    if (n.adminOnly && !admin) return false;
    if (n.employeeOnly && admin) return false;
    return true;
  });

  const mobileItems = admin
    ? visibleItems.filter((n) => ["/sale", "/dashboard", "/inbox", "/accounts"].includes(n.href))
    : visibleItems.filter((n) => ["/sale", "/my-sales", "/renewals", "/dashboard"].includes(n.href));

  async function logout() {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
    router.replace("/login");
  }

  const linkCls = (href: string) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
      pathname === href || pathname.startsWith(href + "/")
        ? "bg-[#2f7bff] text-white shadow-[0_0_18px_rgba(47,123,255,.35)]"
        : "text-slate-300 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[1500px]">
      <img src="/logo.png" alt="" aria-hidden className="pointer-events-none fixed left-1/2 top-1/2 z-0 h-[min(78vh,720px)] w-[min(78vh,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover opacity-[0.07]" />

      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 z-10 hidden h-dvh w-72 shrink-0 flex-col rounded-l-[28px] border border-white/10 bg-[#050914]/95 p-5 text-white backdrop-blur-xl lg:flex">
        <Link href={admin ? "/dashboard" : "/sale"} className="mb-2 flex items-center gap-3 px-1">
          <BrandLogo size={56} />
          <div>
            <div className="text-lg font-black leading-tight text-white">مايسترو كي</div>
            <div className="text-[11px] font-bold text-slate-400">MAESTRO KEY • اشتراكات رقمية</div>
          </div>
        </Link>

        {/* بطاقة معلومات الحساب والمحفظة */}
        <div className="mb-5 mt-4 rounded-2xl border border-white/10 bg-white/[.04] p-3.5">
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck size={16} className="text-[#5ba2ff]" />
            <span className="truncate text-sm font-extrabold">{me.displayName}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">@{me.username} — {roleTitle}</div>

          <button
            type="button"
            onClick={openWalletModal}
            title="اضغط لعرض كشف المحفظة وسجل الحركات"
            className="mt-2.5 flex w-full items-center justify-between rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-right transition hover:border-amber-400/50 hover:bg-amber-400/15 active:scale-[.99]"
          >
            <div className="flex items-center gap-2 text-amber-300">
              <Wallet size={15} />
              <span className="text-xs font-bold">المحفظة:</span>
            </div>
            <span className="font-mono text-xs font-black text-white">
              {Number(me.walletBalance || 0).toLocaleString("ar-YE")} ر.ي
            </span>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {visibleItems.map((n) => (
            <Link key={n.href} href={n.href} className={linkCls(n.href)}>
              {n.icon}<span className="flex-1">{n.label}</span>
              {n.href === "/inbox" && inboxCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">{inboxCount}</span>}
            </Link>
          ))}
        </nav>

        <div className="mt-4 flex flex-col gap-1.5">
          <button onClick={() => { setPwMsg(""); setPwOpen(true); }} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">
            <KeyRound size={16} /> تغيير كلمة المرور
          </button>
          <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-red-400 transition hover:bg-white/10">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="relative z-10 min-w-0 flex-1 pb-24 lg:pb-8">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center gap-2.5 border-b border-white/10 bg-[#050914]/95 px-4 py-3 text-white backdrop-blur lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg bg-white/10 p-2 text-white"><Menu size={20} /></button>
          <BrandLogo size={38} glow={false} />
          <div className="min-w-0 flex-1">
            <div className="font-black leading-none text-white">مايسترو كي</div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400">{me.displayName}</div>
          </div>
          <button
            type="button"
            onClick={openWalletModal}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-xs font-black text-amber-300"
          >
            <Wallet size={14} />
            <span className="font-mono">{Number(me.walletBalance || 0).toLocaleString("ar-YE")}</span>
          </button>
          {admin && inboxCount > 0 && (
            <Link href="/inbox" className="relative rounded-lg bg-white/10 p-2 text-white">
              <BellRing size={20} />
              <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black">{inboxCount}</span>
            </Link>
          )}
        </header>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs lg:hidden" onClick={() => setMenuOpen(false)}>
            <div className="pop-in flex h-full w-72 flex-col bg-[#050914] p-5 text-white" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BrandLogo size={40} glow={false} />
                  <div>
                    <div className="font-black text-white">{me.displayName}</div>
                    <div className="text-[11px] text-slate-400">@{me.username} • {roleTitle}</div>
                  </div>
                </div>
                <button onClick={() => setMenuOpen(false)} className="rounded-lg bg-white/10 p-2 text-white"><X size={18} /></button>
              </div>

              <button
                type="button"
                onClick={() => { setMenuOpen(false); openWalletModal(); }}
                className="mb-4 flex items-center justify-between rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-right"
              >
                <div>
                  <div className="text-[11px] text-slate-300">رصيد المحفظة المتاح</div>
                  <div className="mt-0.5 font-mono text-sm font-black text-amber-300">{Number(me.walletBalance || 0).toLocaleString("ar-YE")} ريال يمني</div>
                </div>
                <Wallet size={20} className="text-amber-300" />
              </button>

              <nav className="flex-1 space-y-1 overflow-y-auto">
                {visibleItems.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className={linkCls(n.href)}>
                    {n.icon}<span className="flex-1">{n.label}</span>
                    {n.href === "/inbox" && inboxCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">{inboxCount}</span>}
                  </Link>
                ))}
              </nav>

              <div className="mt-4 flex flex-col gap-1.5">
                <button onClick={() => { setMenuOpen(false); setPwMsg(""); setPwOpen(true); }} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-white/10">
                  <KeyRound size={16} /> تغيير كلمة المرور
                </button>
                <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-red-400">
                  <LogOut size={16} /> تسجيل الخروج
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">{children}</main>
        <AlertWatcher />
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#070b14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className={`mx-auto grid max-w-lg ${mobileItems.length <= 3 ? "grid-cols-3" : "grid-cols-4"}`}>
          {mobileItems.slice(0, 4).map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-extrabold ${active ? "text-[#63a8ff]" : "text-slate-500"}`}>
                {n.icon}
                {n.label.split(" ")[0] === "التنبيهات" ? "التنبيهات" : n.label}
                {n.href === "/inbox" && inboxCount > 0 && <span className="absolute left-1/2 top-1 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">{inboxCount}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* مودال تغيير كلمة المرور */}
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="🔑 تغيير كلمة المرور">
        {pwMsg && (
          <div className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${pwMsg.startsWith("✓") ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
            {pwMsg}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!currentPw || !newPw) return;
            setPwBusy(true); setPwMsg("");
            try {
              const res = await api("/api/auth", {
                method: "POST",
                body: JSON.stringify({ action: "change-password", currentPassword: currentPw, newPassword: newPw }),
              });
              if (res.ok) {
                setPwMsg("✓ تم تغيير كلمة المرور بنجاح وتسجيل العملية في سجل التدقيق");
                setCurrentPw(""); setNewPw("");
                setTimeout(() => setPwOpen(false), 1500);
              } else {
                setPwMsg(res.error || "⚠️ فشل تغيير كلمة المرور");
              }
            } catch (err: any) {
              setPwMsg("⚠️ " + (err.message || "حدث خطأ"));
            } finally {
              setPwBusy(false);
            }
          }}
          className="space-y-3"
        >
          <div>
            <label className="label">كلمة المرور الحالية</label>
            <input type="password" required className="field text-sm" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          </div>
          <div>
            <label className="label">كلمة المرور الجديدة (6 خانات على الأقل)</label>
            <input type="password" required minLength={6} className="field text-sm" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={pwBusy} className="btn-gold flex-1 py-2.5 text-xs">
              {pwBusy ? "جارٍ الحفظ..." : "حفظ التغيير"}
            </button>
            <button type="button" onClick={() => setPwOpen(false)} className="btn-ghost py-2.5 text-xs">
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      {/* Wallet Statement Modal */}
      <Modal open={walletOpen} onClose={() => setWalletOpen(false)} title="💳 محفظتي وسجل العمليات" wide>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-transparent p-5">
            <div>
              <div className="text-xs font-bold text-amber-200">الرصيد المتاح حالياً</div>
              <div className="mt-1 font-mono text-3xl font-black text-white">{money(me.walletBalance || 0)}</div>
              <p className="mt-1 text-xs font-semibold text-slate-400">
                {admin ? "يمكنك شحن وتسوية محافظ جميع الموظفين من صفحة الإعدادات." : "يُشحن الرصيد من المدير ويُستخدم للشراء والاعتماد الفوري في نقطة البيع."}
              </p>
            </div>
            {admin && (
              <Link
                href="/settings?tab=wallets"
                onClick={() => setWalletOpen(false)}
                className="btn-gold text-xs"
              >
                إدارة محافظ الموظفين <ExternalLink size={15} />
              </Link>
            )}
          </div>

          <div>
            <h4 className="mb-2.5 text-sm font-black text-white">آخر الحركات المالية</h4>
            {walletLoading ? (
              <Spinner text="جارٍ تحميل سجل المحفظة…" />
            ) : walletTxs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm font-bold text-slate-400">
                لا توجد حركات مسجلة في محفظتك حتى الآن.
              </div>
            ) : (
              <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {walletTxs.map((tx: any) => {
                  const isCredit = tx.type === "TOPUP" || tx.type === "REFUND";
                  const label =
                    tx.type === "TOPUP" ? "شحن رصيد" :
                    tx.type === "REFUND" ? "استرداد طلب" :
                    tx.type === "DEDUCT" ? "تسوية خصم" : "شراء اشتراك";
                  return (
                    <div key={tx.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3.5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          tx.type === "REFUND" ? "bg-sky-500/15 text-sky-300" :
                          isCredit ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
                        }`}>
                          {tx.type === "REFUND" ? <RotateCcw size={17} /> : isCredit ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={tx.type === "REFUND" ? "blue" : isCredit ? "green" : "red"}>{label}</Badge>
                            {tx.rentalId && <span className="font-mono text-[11px] font-bold text-slate-400">#{tx.rentalId}</span>}
                          </div>
                          <div className="mt-1 truncate text-xs font-semibold text-slate-300">{tx.note || "—"}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{fmtDateTime(tx.createdAt)}{tx.createdByName ? ` • بواسطة: ${tx.createdByName}` : ""}</div>
                        </div>
                      </div>
                      <div className="shrink-0 text-left">
                        <div dir="ltr" className={`font-mono text-sm font-black ${isCredit ? "text-emerald-300" : "text-red-300"}`}>
                          {isCredit ? "+" : "-"}{Number(tx.amount).toLocaleString("ar-YE")}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                          الرصيد: {Number(tx.balanceAfter).toLocaleString("ar-YE")}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
