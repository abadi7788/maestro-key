"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import {
  AlarmClock, ArrowLeft, BellRing, Boxes, CheckCircle2, CreditCard, KeyRound, Landmark, Play, ReceiptText,
  RefreshCcw, ShieldAlert, ShoppingCart, TrendingUp, Users, Wallet,
} from "lucide-react";
import { api, cachedApi, fetchMe, fmtDate, getCached, getCachedMe, money, daysLeft, setCached, type Me } from "@/lib/client";
import { isAdminRole, isEmployeeRole } from "@/lib/roles";
import { Badge, PlatformLogo, Spinner, StatCard, DueCard, rentalBadge, paymentBadge } from "@/components/ui";

export default function DashboardPage() {

  const [me, setMe] = useState<Me | null>(() => getCachedMe());
  const [data, setData] = useState<any>(() => getCached("/api/admin-data?view=dashboard"));
  const [meta, setMeta] = useState<any>(() => getCached("/api/meta"));
  const [rentals, setRentals] = useState<any[]>(() => {
    const u = getCachedMe();
    const cached = getCached<any>(u && isAdminRole(u.role) ? "/api/rentals?view=all" : "/api/rentals?view=mine");
    return cached?.rentals || [];
  });
  const [due, setDue] = useState<any[]>(() => getCached<any>("/api/rentals?view=due")?.rentals || []);
  const [jobMsg, setJobMsg] = useState(""); const [busy, setBusy] = useState(false);

  async function load(user: Me, force = false) {
    if (isAdminRole(user.role)) {
      const [m, d, r] = await Promise.all([
        cachedApi("/api/meta", undefined, { force }).catch(() => null),
        cachedApi("/api/admin-data?view=dashboard", undefined, { force }).catch(() => null),
        cachedApi("/api/rentals?view=all", undefined, { force }).catch(() => null),
      ]);
      if (m) setMeta(m);
      if (d) setData(d);
      if (r?.rentals) setRentals(r.rentals);
    } else {
      const [m, d2, mine] = await Promise.all([
        cachedApi("/api/meta", undefined, { force }).catch(() => null),
        cachedApi("/api/rentals?view=due", undefined, { force }).catch(() => null),
        cachedApi("/api/rentals?view=mine", undefined, { force }).catch(() => null),
      ]);
      if (m) setMeta(m);
      if (d2?.rentals) setDue(d2.rentals);
      if (mine?.rentals) setRentals(mine.rentals);
    }
  }
  useEffect(() => {
    fetchMe().then((u) => {
      setMe(u);
      if (u) void load(u);
    });
  }, []);
  useAutoRefresh(() => { if (me) return load(me, true); }, 25000);


  async function runJob() {
    setBusy(true);
    try {
      const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "runDailyJob" }) });
      setJobMsg(`تم: انتهى ${d.endedCount} اشتراك، وأُرسل/جُهّز ${d.alertsSent} تنبيه واتساب قبل الانتهاء بيومين.`);
      if (me) void load(me, true);
    }
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

          {/* التحقق المالي والحسابي اليومي للمدير (Daily Financial Reconciliation) */}
          {data?.dailyReconciliation && (
            <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0c1426] p-5 sm:p-6 shadow-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-black text-white sm:text-lg">
                    <Landmark size={20} className="text-amber-400" />
                    التحقق المالي والحسابي اليومي (الإغلاق اليومي)
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 font-semibold">
                    ملخص مبيعات اليوم المفصلة حسب طريقة الدفع ولكل موظف لتسهيل المطابقة والمحاسبة اليومية.
                  </p>
                </div>
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-300">
                  {data.dailyReconciliation.todaySalesCount} عمليات اليوم
                </div>
              </div>

              {/* بطاقات الإجمالي حسب طريقة الدفع */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <Wallet size={16} />
                    إجمالي مبيعات المحفظة اليوم
                  </div>
                  <div className="mt-2 text-xl font-black text-white">
                    {money(data.dailyReconciliation.todayWalletTotal)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 font-semibold">خصم فوري مباشر من أرصدة المحافظ</div>
                </div>

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
                    <CreditCard size={16} />
                    إجمالي مبيعات السندات / نقداً
                  </div>
                  <div className="mt-2 text-xl font-black text-white">
                    {money(data.dailyReconciliation.todayReceiptTotal)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 font-semibold">حوالات بنكية وسندات دفع مؤكدة</div>
                </div>

                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <TrendingUp size={16} />
                    صافي إجمالي مبيعات اليوم
                  </div>
                  <div className="mt-2 text-xl font-black text-emerald-400">
                    {money(data.dailyReconciliation.todayTotalAmount)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 font-semibold">المجموع الكلي المقبوض لليوم</div>
                </div>
              </div>

              {/* جدول تفصيل مبيعات الموظفين */}
              {data.dailyReconciliation.staffReconciliation?.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-black text-slate-300">تفصيل المبيعات حسب الموظف:</h3>
                  <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[.02]">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[.04] text-slate-400 font-extrabold">
                          <th className="p-3">الموظف / المستخدم</th>
                          <th className="p-3">عدد العمليات</th>
                          <th className="p-3">مدفوعات المحفظة</th>
                          <th className="p-3">مدفوعات السندات</th>
                          <th className="p-3 font-black text-white">إجمالي المبيعات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data.dailyReconciliation.staffReconciliation.map((u: any) => (
                          <tr key={u.userId} className="hover:bg-white/[.02] transition">
                            <td className="p-3 font-extrabold text-white">
                              {u.name} <span className="text-[11px] font-normal text-slate-500">(@{u.username})</span>
                            </td>
                            <td className="p-3 font-bold text-slate-300">{u.salesCount}</td>
                            <td className="p-3 font-mono font-bold text-amber-300">{money(u.walletAmount)}</td>
                            <td className="p-3 font-mono font-bold text-blue-300">{money(u.receiptAmount)}</td>
                            <td className="p-3 font-mono font-black text-emerald-400">{money(u.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {!isAdminRole(me.role) && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            <StatCard 
              label="رصيد محفظتي المتاح" 
              value={`${Number(me.walletBalance || 0).toLocaleString()} ر.ي`} 
              sub="للشراء المباشر والاعتماد الفوري" 
              icon={<Wallet size={20} />} 
              tone="bg-emerald-100 text-emerald-300" 
            />
            <StatCard 
              label="إجمالي مبيعاتي" 
              value={rentals.length} 
              sub="عمليات مسجلة باسمك" 
              icon={<ShoppingCart size={20} />} 
              tone="bg-sky-100 text-[#174ea6]" 
            />
            <StatCard 
              label="تجديدات مستحقة لعملائي" 
              value={due.length} 
              sub="تحتاج تنبيه أو تجديد" 
              icon={<RefreshCcw size={20} />} 
              tone="bg-amber-100 text-amber-700" 
            />
          </div>

          <div className="mb-3 flex items-center justify-between pt-2">
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

