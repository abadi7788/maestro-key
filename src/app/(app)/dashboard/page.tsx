"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import {
  AlarmClock, ArrowLeft, BellRing, Boxes, CheckCircle2, KeyRound, Play, ReceiptText,
  RefreshCcw, ShieldAlert, ShoppingCart, TrendingUp, Users, Wallet,
} from "lucide-react";
import { api, fetchMe, fmtDate, money, daysLeft, type Me } from "@/lib/client";
import { isAdminRole, isEmployeeRole } from "@/lib/roles";
import { Badge, PlatformLogo, Spinner, StatCard, DueCard, rentalBadge, paymentBadge } from "@/components/ui";

export default function DashboardPage() {

  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<any>(null); const [meta, setMeta] = useState<any>(null);
  const [rentals, setRentals] = useState<any[]>([]); const [due, setDue] = useState<any[]>([]);
  const [jobMsg, setJobMsg] = useState(""); const [busy, setBusy] = useState(false);

  async function load(user: Me) {
    const m = await api("/api/meta").catch(() => null); setMeta(m);
    if (isAdminRole(user.role)) {
      const [d, r] = await Promise.all([api("/api/admin-data?view=dashboard"), api("/api/rentals?view=all")]);
      setData(d); setRentals(r.rentals);
    } else {
      const [d2, mine] = await Promise.all([api("/api/rentals?view=due"), api("/api/rentals?view=mine")]);
      setDue(d2.rentals); setRentals(mine.rentals);
    }
  }
  useEffect(() => { fetchMe().then((u) => { setMe(u); if (u) load(u); }); }, []);
  // مزامنة تلقائية كل 25 ثانية لتفادي استنزاف موارد السيرفر وقاعدة البيانات
  useAutoRefresh(() => { if (me) return load(me); }, 25000);


  async function runJob() {
    setBusy(true);
    try { const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "runDailyJob" }) }); setJobMsg(`تم: انتهى ${d.endedCount} اشتراك، وأُرسل/جُهّز ${d.alertsSent} تنبيه واتساب قبل الانتهاء بيومين.`); if (me) load(me); }
    catch (e: any) { setJobMsg(e.message); } finally { setBusy(false); }
  }

  if (!me || !meta) return <Spinner />;
  const s = data?.stats;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="overflow-hidden rounded-3xl bg-[#0e1526] p-6 text-white sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#174ea6]"><KeyRound size={20} /><span className="text-sm font-extrabold">متجر مايسترو كي</span></div>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">أهلاً {me.displayName} 👋</h1>
            <p className="mt-1 max-w-xl text-sm font-semibold leading-relaxed text-slate-600">
              {isAdminRole(me.role) ? "عندك كل الصلاحيات: المخزون، مراجعة السندات، إجراءات الانتهاء، المحذوفات، وسجل التدقيق." : "واجهتك للبيع والتجديد فقط. اربط كل عملية بسند — وسيظهر لك الحساب المسحوب فوراً لإرساله للعميل."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/sale" className="btn-gold shadow-lg"><ShoppingCart size={19} /> بيع / تجديد جديد</Link>
            {isAdminRole(me.role) && <button onClick={runJob} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-white10 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-white20"><Play size={17} /> تشغيل المهمة اليومية الآن</button>}
          </div>
        </div>
        {jobMsg && <div className="mt-4 rounded-xl bg-emerald-500/100/15 px-4 py-3 text-sm font-bold text-emerald-200">✓ {jobMsg}</div>}
        {/* availability strip */}
        <div className="no-scrollbar mt-6 flex gap-2.5 overflow-x-auto pb-1">
          {meta.platforms.map((p: any) => {
            const slots = meta.availability?.[p.id]?.slots ?? 0;
            return (
              <div key={p.id} className="flex shrink-0 items-center gap-2.5 rounded-2xl bg-white5 px-3.5 py-2.5">
                <PlatformLogo src={p.imageUrl} name={p.name} color={p.color} size={36} />
                <div><div className="text-xs font-extrabold leading-none">{p.name}</div><div className={`mt-1 text-[11px] font-bold ${slots ? "text-emerald-300" : "text-red-300"}`}>{slots ? `${slots} مكان متاح` : "لا يوجد متاح"}</div></div>
              </div>
            );
          })}
        </div>
      </div>

      {isAdminRole(me.role) && s && (
        <>
          {(s.endedRentals > 0 || s.pendingPayments > 0 || s.needsPasswordChange > 0) && (
            <Link href="/inbox" className="flex items-center gap-3 rounded-3xl border-2 border-red-200 bg-red-500/10 p-4.5 px-5 py-4 transition hover:bg-red-100">
              <span className="rounded-2xl bg-red-600 p-3 text-white"><BellRing size={22} /></span>
              <div className="flex-1">
                <div className="font-black text-red-300">عندك إجراءات بانتظارك</div>
                <div className="text-sm font-semibold text-red-300">{s.endedRentals} اشتراك انتهى • {s.pendingPayments} سند للمراجعة • {s.needsPasswordChange} حساب يحتاج تغيير كلمة مرور</div>
              </div>
              <ArrowLeft className="text-red-500" />
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <StatCard label="اشتراكات نشطة" value={s.activeRentals} sub={`${s.endingIn2Days} تنتهي خلال يومين`} icon={<CheckCircle2 size={20} />} tone="bg-emerald-100 text-emerald-300" />
            <StatCard label="حسابات في المخزون" value={s.accountsTotal} sub={`${s.accountsAvailable} متاح • ${s.accountsRented} مؤجَّر بالكامل`} icon={<Boxes size={20} />} tone="bg-sky-100 text-[#174ea6]" />
            <StatCard label="إيرادات مؤكدة" value={money(s.revenueConfirmed)} sub={`${money(s.revenuePending)} بانتظار التأكيد`} icon={<Wallet size={20} />} tone="bg-[#eaf3ff] text-[#2563eb]" />
            <StatCard label="العملاء" value={s.customers} sub={`مبيعات اليوم: ${s.todaySales}`} icon={<Users size={20} />} tone="bg-violet-100 text-violet-700" />
            <StatCard label="اشتراكات انتهت" value={s.endedRentals} sub="تحتاج إزالة بروفايل أو تغيير كلمة مرور" icon={<AlarmClock size={20} />} tone="bg-red-100 text-red-300" />
            <StatCard label="سندات للمراجعة" value={s.pendingPayments} sub="راجع واعتمد أو ارفض" icon={<ReceiptText size={20} />} tone="bg-amber-100 text-amber-700" />
            <StatCard label="حسابات توشك صلاحيتها" value={s.accountsExpiringSoon} sub="صلاحية الحساب نفسه تنتهي خلال 30 يوم" icon={<ShieldAlert size={20} />} tone="bg-orange-100 text-orange-700" />
            <StatCard label="بانتظار تغيير كلمة مرور" value={s.needsPasswordChange} sub="لن تُباع قبل تغيير كلمتها يدوياً" icon={<KeyRound size={20} />} tone="bg-slate-200 text-slate-200" />
          </div>
        </>
      )}

      {isEmployeeRole(me.role) && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-black"><RefreshCcw size={20} className="text-[#2563eb]" /> تجديدات مستحقة ({due.length})</h2>
            <Link href="/renewals" className="text-sm font-extrabold text-[#2563eb]">عرض الكل ←</Link>
          </div>
          {due.length === 0 ? <div className="card p-5 text-center font-bold text-slate-500">لا توجد تجديدات مستحقة الآن 🎉</div> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {due.slice(0, 4).map((r: any) => <DueCard key={r.id} r={r} />)}
            </div>
          )}
        </section>
      )}

      {/* Recent rentals */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black"><TrendingUp size={20} className="text-[#2563eb]" /> {isAdminRole(me.role) ? "أحدث العمليات" : "أحدث عملياتي"}</h2>
          <Link href={isAdminRole(me.role) ? "/rentals" : "/my-sales"} className="text-sm font-extrabold text-[#2563eb]">عرض الكل ←</Link>
        </div>
        <div className="space-y-2.5">
          {rentals.slice(0, 6).map((r: any) => (
            <div key={r.id} className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
              <PlatformLogo src={r.platformImage} name={r.platformName} color={r.platformColor} size={42} />
              <div className="min-w-[140px] flex-1">
                <div className="font-extrabold leading-tight">{r.customerName}</div>
                <div className="text-xs font-semibold text-slate-500">{r.platformName} • {r.isLifetime ? "اشتراك دائم ♾️" : <>حتى {fmtDate(r.endDate)}</>} {isAdminRole(me.role) && `• باع: ${r.sellerName}`}</div>
              </div>
              {rentalBadge(r.status)}
              {r.payments?.[0] && paymentBadge(r.payments[0].status)}
            </div>
          ))}
          {rentals.length === 0 && <div className="card p-6 text-center font-bold text-slate-500">لا توجد عمليات بعد — ابدأ أول عملية بيع.</div>}
        </div>
      </section>
    </div>
  );
}

