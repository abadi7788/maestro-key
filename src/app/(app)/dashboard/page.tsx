"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import {
  AlertTriangle, ArrowLeft, BellRing, Boxes, CheckCircle2, Clock, DollarSign, KeyRound,
  PackageOpen, RefreshCw, ShoppingCart, TrendingUp, Users, Wallet, Zap,
} from "lucide-react";
import { api, fetchMe, money, fmtDate, type Me } from "@/lib/client";
import { isAdminRole } from "@/lib/roles";
import { Spinner, StatCard, Badge, rentalBadge } from "@/components/ui";

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<any>(null);
  const [empData, setEmpData] = useState<{ renewals: any[]; mine: any[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const user = await fetchMe();
      if (!user) return;
      setMe(user);
      if (isAdminRole(user.role)) {
        setData(await api("/api/admin-data?view=dashboard"));
      } else {
        const [ren, mine] = await Promise.all([
          api("/api/rentals?view=renewals").catch(() => ({ rentals: [] })),
          api("/api/rentals?view=mine").catch(() => ({ rentals: [] })),
        ]);
        setEmpData({ renewals: ren.rentals || [], mine: mine.rentals || [] });
      }
    } catch (e: any) {
      setErr(e?.message || "تعذر تحميل بيانات لوحة التحكم — تحقق من الاتصال وأعد المحاولة");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 25000);

  async function runNow() {
    setRunning(true); setMsg("");
    try {
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "runDailyJob" }) });
      setMsg(`✓ تم فحص الاشتراكات: أُنهي ${r.endedCount} اشتراك، وجُهزت ${r.alertsSent} رسالة تنبيه انتهاء.`);
      await load();
    } catch (e: any) { setMsg("⚠️ " + e.message); }
    finally { setRunning(false); }
  }

  if (err && !me) {
    return (
      <div className="card space-y-3 p-6 text-center">
        <p className="font-extrabold text-red-300">⚠️ {err}</p>
        <button onClick={load} className="btn-primary mx-auto"><RefreshCw size={16} /> إعادة المحاولة</button>
      </div>
    );
  }

  if (!me) return <Spinner />;

  if (!isAdminRole(me.role)) {
    if (!empData) return <Spinner />;
    const todayMine = empData.mine.filter((r) => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
    return (
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0f172a] via-[#13203d] to-[#0b1325] p-6 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-amber-300">مرحباً {me.displayName} 👋</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight">بوابة المبيعات والتجديدات</h1>
              <p className="mt-1 text-sm text-slate-300">سجّل مبيعاتك فوراً عبر المحفظة أو السند البنكي وتابع اشتراكات عملائك.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-right">
                <div className="text-[11px] font-bold text-amber-200">رصيد محفظتك المتاح</div>
                <div className="font-mono text-lg font-black text-white">{money(me.walletBalance || 0)}</div>
              </div>
              <Link href="/sale" className="btn-gold shadow-lg shadow-amber-500/20">
                <ShoppingCart size={17} /> بيع / تجديد جديد
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard label="رصيد المحفظة" value={money(me.walletBalance || 0)} sub="للشراء والاعتماد الفوري" icon={<Wallet size={20} />} tone="text-amber-300 bg-amber-400/15" />
          <StatCard label="عملياتي اليوم" value={todayMine} sub={`الإجمالي: ${empData.mine.length}`} icon={<TrendingUp size={20} />} tone="text-emerald-300 bg-emerald-500/15" />
          <StatCard label="تجديدات مستحقة" value={empData.renewals.length} sub="تنتهي خلال يومين أو منتهية" icon={<Clock size={20} />} tone="text-sky-300 bg-sky-500/15" />
          <StatCard label="عمليات نشطة" value={empData.mine.filter((r) => r.status === "ACTIVE").length} sub="اشتراكات سارية" icon={<CheckCircle2 size={20} />} tone="text-purple-300 bg-purple-500/15" />
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-black text-white">أحدث عملياتي</h2>
            <Link href="/my-sales" className="text-xs font-extrabold text-[#63a8ff] hover:underline">عرض الكل ←</Link>
          </div>
          {empData.mine.length === 0 ? (
            <p className="py-6 text-center text-sm font-semibold text-slate-400">لا توجد عمليات مسجلة بعد — ابدأ من زر «بيع / تجديد جديد».</p>
          ) : (
            <div className="space-y-2">
              {empData.mine.slice(0, 6).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white">{r.customerName}</span>
                    <span className="text-slate-400">• {r.platformName}</span>
                    {rentalBadge(r.status)}
                  </div>
                  <span className="font-semibold text-slate-400">{r.isLifetime ? "♾️ دائم" : `حتى ${fmtDate(r.endDate)}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data) return <Spinner />;
  const s = data.stats;
  const lowStock: Array<{ id: number; name: string; slots: number; threshold: number }> = data.lowStockPlatforms || [];
  const urgent = s.endedRentals + s.pendingPayments + s.needsPasswordChange + (s.pendingActivations || 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0f172a] via-[#13203d] to-[#0b1325] p-6 text-white shadow-xl sm:p-8">
        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
              <Zap size={13} /> متجر مايسترو كي — لوحة القيادة الذكية
            </div>
            <h1 className="mt-2.5 text-2xl font-black tracking-tight sm:text-3xl">نظرة شاملة ومباشرة</h1>
            <p className="mt-1 text-sm text-slate-400">إدارة الاشتراكات، المخزون، السندات، ومحافظ الموظفين في مكان واحد.</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button onClick={runNow} disabled={running} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-xs font-bold text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-50">
              <RefreshCw size={15} className={running ? "animate-spin" : ""} /> فحص التواريخ الآن
            </button>
            <Link href="/settings?tab=wallets" className="btn-ghost text-xs">
              <Wallet size={15} /> محافظ الموظفين
            </Link>
            <Link href="/sale" className="btn-gold shadow-lg shadow-amber-500/20">
              <ShoppingCart size={17} /> عملية بيع جديدة
            </Link>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-5 sm:grid-cols-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-400">مبيعات اليوم</div>
            <div className="mt-0.5 text-xl font-black text-white">{s.todaySales} <span className="text-xs font-normal text-slate-400">عملية</span></div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-400">الإيراد المؤكد</div>
            <div className="mt-0.5 text-xl font-black text-emerald-400">{money(s.revenueConfirmed)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-400">سندات قيد المراجعة</div>
            <div className="mt-0.5 text-xl font-black text-amber-300">{money(s.revenuePending)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-400">أرصدة محافظ الموظفين</div>
            <div className="mt-0.5 text-xl font-black text-sky-300">{money(s.walletTotalBalance || 0)}</div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${msg.startsWith("⚠️") ? "border border-red-400/30 bg-red-500/10 text-red-300" : "border border-emerald-400/30 bg-emerald-500/10 text-emerald-300"}`}>
          {msg}
        </div>
      )}

      {urgent > 0 ? (
        <Link href="/inbox" className="group block overflow-hidden rounded-2xl border border-red-400/35 bg-gradient-to-l from-red-500/15 via-[#141022] to-[#0d1526] p-5 shadow-sm transition hover:border-red-400/60 hover:shadow-md">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white shadow-md shadow-red-600/25">
                <BellRing size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-white">لديك {urgent} إجراء يحتاج تدخلك</span>
                  <Badge tone="red">عاجل</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-300">
                  {s.pendingActivations > 0 && <span>⚡ طلبات تفعيل/رابط: <b className="text-amber-300">{s.pendingActivations}</b></span>}
                  {s.pendingPayments > 0 && <span>• سندات للمراجعة: <b className="text-amber-300">{s.pendingPayments}</b></span>}
                  {s.endedRentals > 0 && <span>• اشتراكات انتهت: <b className="text-red-300">{s.endedRentals}</b></span>}
                  {s.needsPasswordChange > 0 && <span>• تغيير كلمة مرور: <b className="text-red-300">{s.needsPasswordChange}</b></span>}
                </div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-extrabold text-white transition group-hover:bg-red-700">
              افتح التنبيهات <ArrowLeft size={14} />
            </span>
          </div>
        </Link>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-5 py-4 text-emerald-300">
          <CheckCircle2 size={22} className="shrink-0 text-emerald-400" />
          <div className="text-sm font-bold">كل شيء منظّم — لا توجد سندات معلقة أو حسابات تنتظر تغيير كلمة المرور حالياً.</div>
        </div>
      )}

      {lowStock.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
          <div className="flex items-start gap-3">
            <PackageOpen size={22} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <div className="text-sm font-black text-amber-200">تنبيه المخزون الفوري</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {lowStock.map((p) => (
                  <Badge key={p.id} tone={p.slots === 0 ? "red" : "amber"}>
                    {p.name}: {p.slots === 0 ? "نافد (0)" : `متبقي ${p.slots}`}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Link href="/accounts" className="btn-gold px-3.5 py-2 text-xs">تغذية المخزون ←</Link>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-black text-slate-300">مؤشرات الأداء والمخزون</h2>
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="اشتراكات نشطة" value={s.activeRentals} sub={`مبيعات اليوم: ${s.todaySales}`} icon={<TrendingUp size={20} />} tone="text-emerald-300 bg-emerald-500/15" />
          <StatCard label="تنتهي خلال يومين" value={s.endingIn2Days} sub="تحتاج تذكير واتساب" icon={<Clock size={20} />} tone="text-amber-300 bg-amber-500/15" />
          <StatCard label="حسابات متاحة للبيع" value={s.accountsAvailable} sub={`من أصل ${s.accountsTotal} في المخزون`} icon={<Boxes size={20} />} tone="text-sky-300 bg-sky-500/15" />
          <StatCard label="بانتظار تغيير كلمة المرور" value={s.needsPasswordChange} sub="محجوبة تلقائياً عن البيع" icon={<KeyRound size={20} />} tone="text-red-300 bg-red-500/15" />
          <StatCard label="الإيراد المؤكد" value={money(s.revenueConfirmed)} sub={`معلّق للمراجعة: ${money(s.revenuePending)}`} icon={<DollarSign size={20} />} tone="text-emerald-300 bg-emerald-500/15" />
          <StatCard label="أرصدة المحافظ" value={money(s.walletTotalBalance || 0)} sub="محافظ الموظفين والموزعين" icon={<Wallet size={20} />} tone="text-amber-300 bg-amber-400/15" />
          <StatCard label="سندات تنتظر المراجعة" value={s.pendingPayments} sub="اضغط التنبيهات للاعتماد" icon={<AlertTriangle size={20} />} tone="text-amber-300 bg-amber-500/15" />
          <StatCard label="حسابات قاربت الانتهاء" value={s.accountsExpiringSoon} sub={`العملاء المسجلون: ${s.customers}`} icon={<Users size={20} />} tone="text-purple-300 bg-purple-500/15" />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-black text-slate-300">وصول سريع</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/accounts" className="card card-hover flex items-center gap-3 p-4 transition">
            <span className="rounded-xl bg-sky-500/15 p-2.5 text-sky-300"><Boxes size={18} /></span>
            <div>
              <div className="text-sm font-extrabold text-white">المخزون</div>
              <div className="text-[11px] text-slate-400">إضافة وتعديل الحسابات</div>
            </div>
          </Link>
          <Link href="/settings?tab=wallets" className="card card-hover flex items-center gap-3 p-4 transition">
            <span className="rounded-xl bg-amber-400/15 p-2.5 text-amber-300"><Wallet size={18} /></span>
            <div>
              <div className="text-sm font-extrabold text-white">شحن المحافظ</div>
              <div className="text-[11px] text-slate-400">أرصدة الموظفين والموزعين</div>
            </div>
          </Link>
          <Link href="/renewals" className="card card-hover flex items-center gap-3 p-4 transition">
            <span className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-300"><Clock size={18} /></span>
            <div>
              <div className="text-sm font-extrabold text-white">التجديدات</div>
              <div className="text-[11px] text-slate-400">متابعة المنتهية قريباً</div>
            </div>
          </Link>
          <Link href="/customers" className="card card-hover flex items-center gap-3 p-4 transition">
            <span className="rounded-xl bg-purple-500/15 p-2.5 text-purple-300"><Users size={18} /></span>
            <div>
              <div className="text-sm font-extrabold text-white">العملاء</div>
              <div className="text-[11px] text-slate-400">قاعدة البيانات والسجل</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
