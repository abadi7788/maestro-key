"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard, ShoppingCart, BellRing, Boxes, ReceiptText, Users, Trash2,
  Settings, ScrollText, LogOut, History, Menu, X, ShieldCheck, RefreshCcw, Wallet,
  KeyRound, UserPen, Camera, Loader2
} from "lucide-react";

import {
  api,
  avatarFileToDataUrl,
  broadcastMeUpdate,
  clearClientCache,
  fetchMe,
  getCached,
  getCachedMe,
  setCached,
  subscribeMe,
  type Me,
} from "@/lib/client";
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
  { href: "/customers", label: "العملاء", icon: <Users size={20} />, adminOnly: true },
  { href: "/trash", label: "سلة المحذوفات", icon: <Trash2 size={20} />, adminOnly: true },
  { href: "/my-sales", label: "طلباتي", icon: <History size={20} />, mobile: true },
  { href: "/audit", label: "سجل التدقيق", icon: <ScrollText size={20} />, adminOnly: true },
  { href: "/settings", label: "الإعدادات", icon: <Settings size={20} />, adminOnly: true },
];

const BADGE_URL = "/api/admin-data?view=badge";

function UserAvatar({
  avatarUrl,
  displayName,
  size = 40,
}: {
  avatarUrl?: string | null;
  displayName?: string | null;
  size?: number;
}) {
  const initial = (displayName || "U").trim().slice(0, 1).toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || "المستخدم"}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full border border-white/20 object-cover shadow-md"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full border border-[#5ba2ff]/35 bg-gradient-to-br from-[#1b2d52] to-[#0c1426] text-sm font-black text-[#8fd0ff] shadow-inner"
    >
      {initial}
    </span>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(() => getCachedMe());
  const [loading, setLoading] = useState<boolean>(() => !getCachedMe());
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState<number>(() => getCached<{ inboxCount: number }>(BADGE_URL)?.inboxCount ?? 0);

  // تغيير كلمة المرور
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  // تعديل الملف الشخصي (الاسم والصورة الشخصية لجميع المستخدمين)
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [avatarCompressing, setAvatarCompressing] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  function openProfileModal() {
    setProfileName(me?.displayName || "");
    setProfileAvatar(me?.avatarUrl || null);
    setAvatarChanged(false);
    setProfileMsg("");
    setMenuOpen(false);
    setProfileOpen(true);
  }

  async function handleAvatarSelect(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileMsg("⚠️ يرجى اختيار ملف صورة صالح (JPG / PNG / WebP)");
      return;
    }
    setAvatarCompressing(true);
    setProfileMsg("");
    try {
      const compressed = await avatarFileToDataUrl(file);
      setProfileAvatar(compressed);
      setAvatarChanged(true);
    } catch {
      setProfileMsg("⚠️ تعذر معالجة الصورة المختارة");
    } finally {
      setAvatarCompressing(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = profileName.trim();
    if (trimmed.length < 2) {
      setProfileMsg("⚠️ الاسم المعروض يجب أن يكون حرفين على الأقل");
      return;
    }
    setProfileBusy(true);
    setProfileMsg("");
    try {
      const payload: Record<string, unknown> = {
        action: "update-profile",
        displayName: trimmed,
      };
      if (avatarChanged) {
        payload.avatarUrl = profileAvatar;
      }
      const res = await api<{ ok: boolean; user?: Me; message?: string }>("/api/auth", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.ok && res.user) {
        broadcastMeUpdate(res.user);
        setMe(res.user);
        setProfileMsg("✓ تم حفظ الاسم والصورة الشخصية بنجاح");
        setTimeout(() => setProfileOpen(false), 900);
      } else {
        setProfileMsg("⚠️ تعذر حفظ التعديلات");
      }
    } catch (err: any) {
      setProfileMsg("⚠️ " + (err?.message || "حدث خطأ أثناء الحفظ"));
    } finally {
      setProfileBusy(false);
    }
  }

  // اشتراك فوري في تحديثات المستخدم (الرصيد، الاسم، الصورة) عبر كامل التطبيق
  useEffect(() => {
    return subscribeMe((updated) => {
      setMe(updated);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe(true).then(async (u) => {
      if (cancelled) return;
      if (!u) {
        clearClientCache();
        router.replace("/login");
        return;
      }
      setMe(u);
      setLoading(false);
      if (isAdminRole(u.role) && pathname !== "/inbox") {
        try {
          const badge = await api<{ inboxCount: number }>(BADGE_URL);
          if (!cancelled) {
            const cnt = badge?.inboxCount ?? 0;
            setCached(BADGE_URL, { inboxCount: cnt });
            setInboxCount(cnt);
          }
        } catch {}
      }
    });
    return () => { cancelled = true; };
    // Run on mount only — avoids re-querying /api/auth + dashboard on every tab navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pathname === "/inbox") setInboxCount(0);
  }, [pathname]);

  useEffect(() => {
    const handleInboxRead = (e: any) => {
      const cnt = e?.detail?.count;
      const next = pathname === "/inbox" ? 0 : (typeof cnt === "number" ? cnt : 0);
      setInboxCount(next);
      setCached(BADGE_URL, { inboxCount: next });
    };
    window.addEventListener("maestro-inbox-read", handleInboxRead);
    return () => window.removeEventListener("maestro-inbox-read", handleInboxRead);
  }, [pathname]);

  // مزامنة دورية + عند عودة التركيز للتطبيق لضمان تطابق رصيد المحفظة والملف الشخصي دائماً
  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      void fetchMe(true).catch(() => null);
      if (isAdminRole(me.role)) {
        if (pathname === "/inbox") {
          setInboxCount(0);
        } else {
          try {
            const badge = await api<{ inboxCount: number }>(BADGE_URL);
            const cnt = badge?.inboxCount ?? 0;
            setCached(BADGE_URL, { inboxCount: cnt });
            setInboxCount(cnt);
          } catch {}
        }
      }
      try { window.dispatchEvent(new Event("maestro-sync")); } catch {}
    };
    const onFocusOrVis = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void fetchMe(true).catch(() => null);
      }
    };
    window.addEventListener("focus", onFocusOrVis);
    document.addEventListener("visibilitychange", onFocusOrVis);
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void tick();
    }, 25000);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocusOrVis);
      document.removeEventListener("visibilitychange", onFocusOrVis);
    };
  }, [me?.id, me?.role, pathname]);

  if (loading) return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#070b14]">
      <BrandLogo size={112} />
      <p className="font-black text-white">Maestro Key…</p>
    </div>
  );
  if (!me) return null;

  const isUser = me.role === "USER" || (!isAdminRole(me.role) && me.role !== "STAFF");

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
    clearClientCache();
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) }).catch(() => {});
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
    : me.role === "STAFF" || me.role === "EMPLOYEE"
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

        {/* بطاقة معلومات الحساب والصورة الشخصية والمحفظة */}
        <div className="mb-5 mt-4 rounded-2xl bg-white/5 p-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openProfileModal}
              title="تعديل الاسم والصورة الشخصية"
              className="group relative shrink-0 rounded-full focus:outline-none"
            >
              <UserAvatar avatarUrl={me.avatarUrl} displayName={me.displayName} size={44} />
              <span className="absolute -bottom-0.5 -left-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#2f7bff] text-white shadow ring-2 ring-[#050914] transition group-hover:scale-110">
                <Camera size={10} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-white">
                <ShieldCheck size={14} className="shrink-0 text-[#5ba2ff]" />
                <span className="truncate text-sm font-extrabold">{me.displayName}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-400">@{me.username} — {roleTitle}</div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2">
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
          <button onClick={openProfileModal} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-sky-300 transition hover:bg-white/10 hover:text-white">
            <UserPen size={16} /> تعديل الملف الشخصي
          </button>
          <button onClick={() => setPwOpen(true)} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">
            <KeyRound size={16} /> تغيير كلمة المرور
          </button>
          <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-bold text-red-400 transition hover:bg-white/10">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* مودال تعديل الملف الشخصي (الاسم والصورة الشخصية) */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setProfileOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c1426] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPen className="text-[#5ba2ff]" size={20} />
                <h3 className="text-base font-black text-white">تعديل الملف الشخصي</h3>
              </div>
              <button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {profileMsg && (
              <div className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${profileMsg.startsWith("✓") ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                {profileMsg}
              </div>
            )}

            <form onSubmit={saveProfile} className="space-y-4">
              {/* معاينة ورفع الصورة الشخصية */}
              <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[.03] p-4">
                <div className="relative">
                  <UserAvatar avatarUrl={profileAvatar} displayName={profileName || me.displayName} size={84} />
                  <button
                    type="button"
                    disabled={avatarCompressing}
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute -bottom-1 -left-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#2f7bff] text-white shadow-lg ring-2 ring-[#0c1426] transition hover:brightness-110"
                    title="اختيار صورة جديدة"
                  >
                    {avatarCompressing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  </button>
                </div>

                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleAvatarSelect(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={avatarCompressing}
                    onClick={() => avatarInputRef.current?.click()}
                    className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-xs font-extrabold text-sky-200 transition hover:bg-sky-500/25"
                  >
                    {avatarCompressing ? "جارٍ ضغط الصورة..." : profileAvatar ? "تغيير الصورة" : "رفع صورة شخصية"}
                  </button>
                  {profileAvatar && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileAvatar(null);
                        setAvatarChanged(true);
                      }}
                      className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs font-extrabold text-red-300 transition hover:bg-red-500/20"
                    >
                      حذف الصورة
                    </button>
                  )}
                </div>
                <p className="text-center text-[11px] font-semibold text-slate-400">
                  يتم ضغط الصورة تلقائياً لتعمل بسرعة فائقة دون استهلاك مساحة.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-300">الاسم المعروض (Display Name)</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  className="field text-sm"
                  placeholder="اكتب اسمك هنا"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={profileBusy || avatarCompressing} className="btn-gold flex-1 py-2.5 text-xs">
                  {profileBusy ? "جارٍ الحفظ..." : "حفظ التعديلات"}
                </button>
                <button type="button" onClick={() => setProfileOpen(false)} className="btn-ghost py-2.5 text-xs">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <button type="submit" disabled={pwBusy} className="btn-gold flex-1 py-2.5 text-xs">
                  {pwBusy ? "جارِ الحفظ..." : "حفظ التغيير"}
                </button>
                <button type="button" onClick={() => setPwOpen(false)} className="btn-ghost py-2.5 text-xs">
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
        <header className="sticky top-0 z-40 flex items-center gap-2.5 border-b border-white/10 bg-[#050914] px-3.5 py-2.5 text-white lg:hidden">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg bg-white/10 p-2 text-white"><Menu size={20} /></button>
          <button
            type="button"
            onClick={openProfileModal}
            title="تعديل الملف الشخصي"
            className="shrink-0 rounded-full"
          >
            <UserAvatar avatarUrl={me.avatarUrl} displayName={me.displayName} size={36} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black leading-tight text-white">{me.displayName}</div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
              <Wallet size={11} />
              <span className="font-mono">{Number(me.walletBalance || 0).toLocaleString()} ر.ي</span>
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
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs lg:hidden" onClick={() => setMenuOpen(false)}>
            <div className="pop-in flex h-full max-h-[100dvh] w-72 flex-col overflow-y-auto overscroll-contain bg-[#050914] p-5 pb-36 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BrandLogo size={38} glow={false} />
                  <span className="font-black text-white">مايسترو كي</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="rounded-lg bg-white/10 p-2 text-white"><X size={18} /></button>
              </div>

              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[.04] p-3">
                <div className="flex items-center gap-2.5">
                  <UserAvatar avatarUrl={me.avatarUrl} displayName={me.displayName} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-white">{me.displayName}</div>
                    <div className="truncate text-[11px] text-slate-400">@{me.username} — {roleTitle}</div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                  <span className="text-[11px] font-bold text-amber-200">الرصيد المتاح:</span>
                  <span className="font-mono text-xs font-black text-amber-300">{Number(me.walletBalance || 0).toLocaleString()} ر.ي</span>
                </div>
              </div>

              <nav className="flex-1 space-y-1">
                {visibleItems.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className={linkCls(n.href)}>
                    {n.icon}<span className="flex-1">{n.label}</span>
                    {n.href === "/inbox" && inboxCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black text-white">{inboxCount}</span>}
                  </Link>
                ))}
              </nav>

              <div className="mt-6 flex flex-col gap-1.5 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={openProfileModal}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold text-sky-300 transition hover:bg-white/10 hover:text-white"
                >
                  <UserPen size={18} /> تعديل الملف الشخصي
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPwOpen(true);
                  }}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                  <KeyRound size={18} /> تغيير كلمة المرور
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold text-red-400 transition hover:bg-white/10"
                >
                  <LogOut size={18} /> تسجيل الخروج
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
    </div>
  );
}
