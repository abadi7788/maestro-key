"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, ShoppingCart, BellRing, Boxes, ReceiptText, Users, Trash2,
  Settings, ScrollText, LogOut, History, Menu, X, ShieldCheck, RefreshCcw, Wallet,
  KeyRound
} from "lucide-react";


import { api, fetchMe, type Me } from "@/lib/client";
import { isAdminRole } from "@/lib/roles";
import BrandLogo from "@/components/BrandLogo";
import AlertWatcher from "@/components/AlertWatcher";

type NavItem = { href: string; label: string; icon: ReactNode; adminOnly?: boolean; staffOnly?: boolean; mobile?: boolean };

const NAV: NavItem[] = [
  { href: "/sale", label: "شراء / تجديد", icon: <ShoppingCart size={20} />, mobile: true },
  { href: "/dashboard", label: "الرئيسية", icon: <LayoutDashboard size={20} />, adminOnly: true, mobile: true },
  { href: "/inbox", label: "التنبيهات والإجراءات", icon: <BellRing size={20} />, adminOnly: true, mobile: true },
  { href: "/renewals", label: "تجديدات مستحقة", icon: <RefreshCcw size={20} />, mobile: true },
  { href: "/accounts", label: "مخزون الحسابات", icon: <Boxes size={20} />, adminOnly: true, mobile: true },
  { href: "/rentals", label: "المبيعات والسندات", icon: <ReceiptText size={20} />, adminOnly: true },
  { href: "/customers", label: "العملاء والمحافظ", icon: <Users size={20} />, adminOnly: true },
  { href: "/trash", label: "سلة المحذوفات", icon: <Trash2 size={20} />, adminOnly: true },
  { href: "/my-sales", label: "طلباتي", icon: <History size={20} />, mobile: true },
  { href: "/audit", label: "سجل التدقيق", icon: <ScrollText size={20} />, adminOnly: true },
  { href: "/settings", label: "الإعدادات", icon: <Settings size={20} />, adminOnly: true },
];

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [me, setMe] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false); const [inboxCount, setInboxCount] = useState(0);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    fetchMe().then(async (u) => {
      if (!u) { router.replace("/login"); return; }
      setMe(u); setLoading(false);
      if (isAdminRole(u.role)) {
        try {
          const [rent, dash] = await Promise.all([
            api("/api/rentals?view=all").catch(() => ({ rentals: [] })),
            api("/api/admin-data?view=dashboard").catch(() => ({ stats: { pendingPayments: 0, needsPasswordChange: 0 } }))
          ]);
          const ended = rent.rentals?.filter((r: any) => r.status === "ENDED").length || 0;
          setInboxCount(ended + (dash.stats?.pendingPayments || 0) + (dash.stats?.needsPasswordChange || 0));
        } catch {}
      }
    });
  }, [pathname, router]);

  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      if (isAdminRole(me.role)) {
        try {
          const [rent, dash] = await Promise.all([
            api("/api/rentals?view=all").catch(() => ({ rentals: [] })),
            api("/api/admin-data?view=dashboard").catch(() => ({ stats: { pendingPayments: 0, needsPasswordChange: 0 } }))
          ]);
          const ended = rent.rentals?.filter((r: any) => r.status === "ENDED").length || 0;
          setInboxCount(ended + (dash.stats?.pendingPayments || 0) + (dash.stats?.needsPasswordChange || 0));
        } catch {}
      }
      try { window.dispatchEvent(new Event("maestro-sync")); } catch {}
    };
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void tick();
    }, 25000);
    return () => clearInterval(t);
  }, [me]);


  if (loading) return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#070b14]">
      <BrandLogo size={112} />
      <p className="font-black text-white">Maestro Key…</p>
    </div>
  );
  if (!me) return null;

  const isUser = me.role === "USER" || (!isAdminRole(me.role) && me.role !== "STAFF");

  // تصنيف الروابط حسب الصلاحيات بدقة
  const visibleItems = NAV.filter((n) => {
    if (n.adminOnly && !isAdminRole(me.role)) return false;
    if (isUser && (n.href === "/rentals" || n.href === "/dashboard" || n.href === "/customers")) return false;
    if (isAdminRole(me.role) && n.href === "/my-sales") return false;
    return true;
  });

  const mobileItems = isAdminRole(me.role)
    ? visibleItems.filter((n) => ["/sale", "/dashboard", "/inbox", "/accounts"].includes(n.href))
    : isUser
    ? visibleItems.filter((n) => ["/sale", "/renewals", "/my-sales"].includes(n.href))
    : visibleItems.filter((n) => ["/sale", "/renewals", "/my-sales", "/dashboard"].includes(n.href));

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

  const roleTitle = isAdminRole(me.role) 
    ? "مدير النظام" 
    : me.role === "STAFF" 
    ? "موظف مبيعات" 
    : "عميل المتجر";

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[1500px]">
      <img src="/logo.png" alt="" aria-hidden className="pointer-events-none fixed left-1/2 top-1/2 z-0 h-[min(78vh,720px)] w-[min(78vh,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover opacity-[0.07]" />
      
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 z-10 hidden h-dvh w-72 shrink-0 flex-col rounded-l-[28px] border border-white/10 bg-[#050914]/95 p-5 text-white backdrop-blur-xl lg:flex">
        <Link href="/sale" className="mb-2 flex items-center gap-3 px-1">
          <BrandLogo size={56} />
          <div>
            <div className="text-lg font-black leading-tight text-white">مايسترو كي</div>
            <div className="text-[11px] font-bold text-slate-400">MAESTRO KEY • اشتراكات رقمية</div>
          </div>
        </Link>

        {/* بطاقة معلومات الحساب والمحفظة */}
        <div className="mb-5 mt-4 rounded-2xl bg-white/5 p-3.5">
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck size={16} className="text-[#5ba2ff]" />
            <span className="text-sm font-extrabold">{me.displayName}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">@{me.username} — {roleTitle}</div>
          
          {/* إظهار المحفظة لجميع الرتب وتحديداً المستخدم العادي */}
          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2">
            <div className="flex items-center gap-2 text-amber-300">
              <Wallet size={15} />
              <span className="text-xs font-bold">رصيد المحفظة:</span>
            </div>
            <span className="font-mono text-xs font-black text-white">
              {Number(me.walletBalance || 0).toLocaleString()} ر.ي
            </span>
          </div>
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
          <button onClick={() => setPwOpen(true)} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">
            <KeyRound size={16} /> تغيير كلمة المرور
          </button>
          <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-red-400 transition hover:bg-white/10">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </div>
      </aside>



      {/* مودال تغيير كلمة المرور */}
      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPwOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c1426] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="text-amber-400" size={20} />
              <h3 className="text-base font-black text-white">تغيير كلمة المرور</h3>
            </div>
            {pwMsg && (
              <div className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${pwMsg.startsWith("✓") ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                {pwMsg}
              </div>
            )}
            <form onSubmit={async (e) => {
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
            }} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">كلمة المرور الحالية</label>
                <input type="password" required className="field text-sm" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">كلمة المرور الجديدة (6 خانات على الأقل)</label>
                <input type="password" required minLength={6} className="field text-sm" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={pwBusy} className="btn-gold flex-1 text-xs py-2.5">
                  {pwBusy ? "جارِ الحفظ..." : "حفظ التغيير"}
                </button>
                <button type="button" onClick={() => setPwOpen(false)} className="btn-ghost text-xs py-2.5">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="relative z-10 min-w-0 flex-1 pb-24 lg:pb-8">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/10 bg-[#050914] px-4 py-3 text-white lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg bg-white/10 p-2 text-white"><Menu size={20} /></button>
          <BrandLogo size={40} glow={false} />
          <div className="flex-1 min-w-0">
            <div className="font-black leading-none text-white">مايسترو كي</div>
            <div className="truncate text-[11px] text-slate-400">
              {me.displayName}
            </div>
          </div>

          {isAdminRole(me.role) && inboxCount > 0 && (
            <Link href="/inbox" className="relative rounded-lg bg-white/10 p-2 text-white">
              <BellRing size={20} />
              <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black">{inboxCount}</span>
            </Link>
          )}
        </header>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)}>
            <div className="pop-in h-full w-72 bg-[#050914] p-5 text-white" onClick={(e) => e.stopPropagation()}>
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BrandLogo size={40} glow={false} />
                  <span className="font-black text-white">القائمة</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="rounded-lg bg-white/10 p-2 text-white"><X size={18} /></button>
              </div>

              <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
                <div className="text-[11px] text-slate-400">الرصيد المتاح:</div>
                <div className="text-sm font-black text-amber-300">{Number(me.walletBalance || 0).toLocaleString()} ريال يمني</div>
              </div>

              <nav className="space-y-1">
                {visibleItems.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className={linkCls(n.href)}>
                    {n.icon}<span className="flex-1">{n.label}</span>
                    {n.href === "/inbox" && inboxCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">{inboxCount}</span>}
                  </Link>
                ))}
              </nav>
              <button onClick={logout} className="mt-6 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold text-red-400"><LogOut size={20} /> تسجيل الخروج</button>


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
    </div>
  );
}
