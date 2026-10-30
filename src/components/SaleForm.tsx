"use client";
import { useEffect, useRef, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { Camera, CheckCircle2, Eye, History, KeyRound, Loader2, MessageCircle, Plus, RefreshCcw, Sparkles, UserCheck, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { api, compressImage, fmtDate, openWhatsapp, fetchMe, type Me } from "@/lib/client";
import { Badge, CopyBtn, PlatformLogo, Spinner } from "@/components/ui";

const QUICK_DURATIONS = [30, 60, 90, 180, 365];

export default function SaleForm({ prefillPhone = "" }: { prefillPhone?: string }) {
  const [meta, setMeta] = useState<any>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [platformId, setPlatformId] = useState<number | null>(null);
  const [saleType, setSaleType] = useState<"FULL" | "PROFILE">("PROFILE");
  const [phone, setPhone] = useState(prefillPhone);
  const [name, setName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerExtra, setCustomerExtra] = useState("");
  const [lookup, setLookup] = useState<any>(null);
  const [durationDays, setDurationDays] = useState(30);
  const [durationInput, setDurationInput] = useState("30");

  // الدفع
  const [paymentType, setPaymentType] = useState<"BANK" | "WALLET">("BANK");
  const [bankId, setBankId] = useState<number | null>(null);
  const [txRef, setTxRef] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState<{ dataUrl: string; name: string } | null>(null);

  const [aiState, setAiState] = useState<"idle" | "reading" | "ok" | "fail">("idle");
  const [aiNote, setAiNote] = useState("");
  const [forceNew, setForceNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const [instantCreds, setInstantCreds] = useState<any>(null);
  const [credLoading, setCredLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMe().then((u) => {
      setMe(u);
      // إذا كان لدى الموظف رصيد في المحفظة، يمكنه الاختيار بسهولة
    });
    api("/api/meta").then((m) => {
      setMeta(m);
      setBankId(m.paymentMethods[0]?.id ?? null);
    });
  }, []);

  useAutoRefresh(async () => {
    const [m, u] = await Promise.all([
      api("/api/meta").catch(() => null),
      fetchMe().catch(() => null),
    ]);
    if (m) setMeta(m);
    if (u) setMe(u);
  }, 25000);

  useEffect(() => {
    if (prefillPhone) {
      setPhone(prefillPhone);
      return;
    }
    if (typeof window !== "undefined") {
      const qPhone = new URLSearchParams(window.location.search).get("phone");
      if (qPhone) setPhone(qPhone);
    }
  }, [prefillPhone]);

  useEffect(() => {
    const clean = phone.replace(/\s/g, "");
    if (!platformId || clean.length < 7) { setLookup(null); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api(`/api/sales?phone=${encodeURIComponent(clean)}&platformId=${platformId}`);
        setLookup(d);
        if (d.customer && !name) setName(d.customer.name);
        setForceNew(false);
      } catch {}
    }, 320);
    return () => clearTimeout(t);
  }, [phone, platformId]);

  const selectedPlat = meta?.platforms?.find((p: any) => p.id === platformId);
  const rawMode = String(selectedPlat?.deliveryMode || "INSTANT_INVENTORY").toUpperCase();
  const mode: "INSTANT_INVENTORY" | "ON_DEMAND_EMAIL" | "LINK_ONLY" =
    rawMode === "LINK_ONLY" ? "LINK_ONLY" : rawMode === "ON_DEMAND_EMAIL" || rawMode === "ON_DEMAND" ? "ON_DEMAND_EMAIL" : "INSTANT_INVENTORY";
  const isOnDemand = mode !== "INSTANT_INVENTORY";
  const isLinkOnly = mode === "LINK_ONLY";
  const isLifetimePlat = !!selectedPlat?.isLifetime;
  const needsEmail = !isLinkOnly && (mode === "ON_DEMAND_EMAIL" || !!selectedPlat?.requiresCustomerEmail);
  const extraLabel: string | null = isLinkOnly ? null : (selectedPlat?.extraFieldLabel || null);

  function selectPlatform(p: any) {
    setPlatformId(p.id);
    const pMode = String(p.deliveryMode || "").toUpperCase();
    if (pMode === "ON_DEMAND" || pMode === "ON_DEMAND_EMAIL" || pMode === "LINK_ONLY") {
      setSaleType("FULL");
      return;
    }
    const bt = meta.availabilityByType?.[p.id];
    const nextType: "FULL" | "PROFILE" = (bt?.PROFILE?.slots ?? 0) > 0 ? "PROFILE" : "FULL";
    setSaleType(nextType);
    const suggested = meta.priceByType?.[p.id]?.[nextType];
    if (suggested) setAmount(String(suggested));
  }

  function changeSaleType(next: "FULL" | "PROFILE") {
    setSaleType(next);
    if (platformId) {
      const suggested = meta?.priceByType?.[platformId]?.[next];
      if (suggested) setAmount(String(suggested));
    }
  }

  async function onReceipt(file?: File) {
    if (!file) return;
    setErr(""); setAiState("reading"); setAiNote("الذكاء الاصطناعي يقرأ السند ويستخرج البيانات…");
    try {
      const dataUrl = await compressImage(file);
      setReceipt({ dataUrl, name: file.name });
      try {
        const r = await api("/api/ai/receipt", { method: "POST", body: JSON.stringify({ image: dataUrl }) });
        if (r?.available && r?.extracted) {
          const ex = r.extracted;
          const filled: string[] = [];
          if (ex.transactionRef) { setTxRef(String(ex.transactionRef)); filled.push("رقم العملية"); }
          if (ex.amount && ex.amount > 0) { setAmount(String(Math.round(ex.amount))); filled.push("المبلغ"); }
          if (ex.matchedBankId) { setBankId(Number(ex.matchedBankId)); filled.push("البنك"); }
          if (filled.length) {
            setAiState("ok");
            setAiNote(`✨ تم استخراج (${filled.join(" + ")}) تلقائياً${ex.bankName ? ` — ${ex.bankName}` : ""}. راجع الأرقام قبل التأكيد.`);
          } else {
            setAiState("fail");
            setAiNote("لم يتضح نص السند تلقائياً — أدخل رقم العملية والمبلغ يدوياً.");
          }
        } else {
          setAiState("idle"); setAiNote("");
        }
      } catch {
        setAiState("fail"); setAiNote("تعذرت القراءة التلقائية — أدخل البيانات يدوياً.");
      }
    } catch (e: any) { setAiState("idle"); setAiNote(""); setErr(e.message); }
  }

  async function submit() {
    setErr("");
    if (!platformId) return setErr("اختر المنصة أولاً");
    if (!name.trim() || !phone.trim()) return setErr("اسم العميل ورقم هاتفه مطلوبان");
    if (!isLifetimePlat && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) return setErr("أدخل عدد أيام صحيح (من 1 إلى 3650 يوماً)");
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) return setErr("أدخل البريد الإلكتروني الصحيح للعميل لتفعيل الاشتراك عليه");
    if (extraLabel && !customerExtra.trim()) return setErr(`أدخل (${extraLabel}) الخاص بالعميل`);

    const numAmount = Number(amount || 0);
    if (numAmount <= 0) return setErr("أدخل المبلغ المدفوع (يجب أن يكون أكبر من صفر)");

    if (paymentType === "BANK") {
      if (!bankId) return setErr("اختر وسيلة الدفع (البنك)");
      if (!txRef.trim()) return setErr("رقم العملية مطلوب — راجعه من صورة السند");
      if (!receipt) return setErr("صورة سند الدفع إلزامية عند الدفع عبر حوالة بنكية");
    } else if (paymentType === "WALLET") {
      if ((me?.walletBalance || 0) < numAmount) {
        return setErr(`رصيد محفظتك غير كافٍ (${(me?.walletBalance || 0).toLocaleString("ar-YE")} ر.ي). اطلب من المدير شحن رصيدك أو استخدم حوالة بنكية.`);
      }
    }

    setBusy(true);
    try {
      const r = await api("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          platformId,
          saleType,
          customerName: name,
          customerPhone: phone,
          durationDays,
          paymentType,
          paymentMethodId: paymentType === "BANK" ? bankId : null,
          transactionRef: paymentType === "BANK" ? txRef : `WALLET-${Date.now()}`,
          amount: numAmount,
          receiptImageData: paymentType === "BANK" ? receipt?.dataUrl : null,
          forceNewAccount: forceNew,
          customerEmail: customerEmail.trim() || undefined,
          customerExtra: customerExtra.trim() || undefined,
        }),
      });
      setResult(r);
      setInstantCreds(null);
      if (paymentType === "WALLET") {
        if (typeof r.walletBalanceAfter === "number") {
          setMe((prev) => prev ? { ...prev, walletBalance: r.walletBalanceAfter } : prev);
        } else {
          fetchMe().then(setMe);
        }
        try { window.dispatchEvent(new Event("maestro-wallet-updated")); } catch {}
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revealSoldCredentials() {
    if (!result?.rentalId) return;
    setCredLoading(true);
    setErr("");
    try {
      const d = await api(`/api/sales/credentials?rentalId=${result.rentalId}`);
      setInstantCreds(d);
    } catch (e: any) {
      setErr(e.message || "تعذر جلب بيانات الحساب");
    } finally {
      setCredLoading(false);
    }
  }

  function resetAll() {
    setResult(null); setInstantCreds(null); setPhone(""); setName(""); setCustomerEmail(""); setCustomerExtra("");
    setTxRef(""); setAmount(""); setReceipt(null); setLookup(null); setForceNew(false); setErr(""); setAiState("idle"); setAiNote("");
  }

  if (!meta) return <Spinner />;

  // ---------- شاشة النتيجة بعد الإرسال ----------
  if (result) {
    const rMode = result.deliveryMode || "INSTANT_INVENTORY";
    const onDemandRes = rMode !== "INSTANT_INVENTORY";
    const linkOnlyRes = rMode === "LINK_ONLY";
    const isWalletPaid = result.paymentType === "WALLET" || result.paymentStatus === "CONFIRMED";

    return (
      <div className="pop-in mx-auto max-w-xl">
        <div className="card overflow-hidden border-2 border-amber-400/50">
          <div className={`${isWalletPaid && !onDemandRes ? "bg-emerald-600" : "bg-[#050914]"} p-6 text-center text-white`}>
            <CheckCircle2 size={46} className={`mx-auto mb-2 ${isWalletPaid && !onDemandRes ? "text-white" : "text-amber-300"}`} />
            <h2 className="text-xl font-black">
              {isWalletPaid && !onDemandRes
                ? "تم خصم الرصيد وتأكيد الاشتراك فوراً! ⚡"
                : linkOnlyRes
                  ? "تم رفع طلب الرابط للمدير"
                  : onDemandRes
                    ? "تم إرسال طلب التفعيل للمدير"
                    : result.isRenewal
                      ? "تم تسجيل التجديد بنجاح!"
                      : "تم تسجيل الطلب وحجز الحساب!"}
            </h2>
            <p className="mt-1 text-xs text-white/85">
              {result.platform}
              {linkOnlyRes
                ? " — سيرسل لك المدير رابط الاشتراك هنا فور تجهيزه"
                : onDemandRes
                  ? ` — سيتم التفعيل على ${result.customerEmail || "إيميل العميل"}`
                  : ` — ${result.accountType === "FULL" ? "حساب كامل خاص" : `بروفايل رقم ${result.profileNo}`}`}
            </p>
          </div>
          <div className="space-y-3 p-6">
            {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-xs font-bold text-red-300">⚠️ {err}</div>}

            {isWalletPaid ? (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-center">
                <div className="text-sm font-black text-emerald-300">💳 تم الدفع والاعتماد عبر المحفظة بنجاح</div>
                {typeof result.walletBalanceAfter === "number" && (
                  <div className="mt-1 font-mono text-xs font-extrabold text-amber-300">
                    الرصيد المتبقي في محفظتك: {Number(result.walletBalanceAfter).toLocaleString("ar-YE")} ر.ي
                  </div>
                )}
                <p className="mt-1.5 text-xs font-semibold leading-relaxed text-emerald-200/80">
                  {onDemandRes
                    ? "تم تأكيد الدفع فوراً، وبانتظار المدير لإتمام التفعيل / إرسال الرابط."
                    : "الاشتراك مفعل الآن فوراً دون الحاجة لانتظار مراجعة السند."}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-center">
                <div className="text-sm font-black text-amber-300">⏳ بانتظار موافقة المدير</div>
                <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-300">
                  {linkOnlyRes
                    ? "وصل إشعار فوري للمدير مع السند. بمجرد وضع رابط الاشتراك ستجده جاهزاً للنسخ في صفحة "
                    : onDemandRes
                      ? "وصل إشعار فوري للمدير مع إيميل العميل والسند. بمجرد تفعيل الاشتراك ستظهر لك البيانات في صفحة "
                      : "تم حجز الحساب للعميل وإرسال السند للمدير. بعد الموافقة ستظهر لك بيانات الدخول في صفحة "}
                  <b className="text-white">«مبيعاتي»</b>.
                </p>
              </div>
            )}

            {/* إظهار بيانات الحساب فوراً عند الشراء من المخزون بالمحفظة */}
            {isWalletPaid && !onDemandRes && (
              !instantCreds ? (
                <button
                  type="button"
                  disabled={credLoading}
                  onClick={revealSoldCredentials}
                  className="btn-gold w-full py-3.5 text-sm"
                >
                  {credLoading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                  🔑 إظهار بيانات الحساب وإرسالها للعميل الآن
                </button>
              ) : (
                <div className="pop-in space-y-2.5 rounded-2xl border-2 border-amber-400/40 bg-white/[.03] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-300">🔓 بيانات اشتراك العميل الجاهزة للتسليم</span>
                    <Badge tone="green">مؤكد ✓</Badge>
                  </div>
                  {[
                    instantCreds.email && { k: "📧 الإيميل", v: instantCreds.email, ltr: true },
                    instantCreds.password && { k: "🔑 كلمة المرور", v: instantCreds.password, ltr: true },
                    instantCreds.licenseKey && { k: "🎟️ الكود / المفتاح", v: instantCreds.licenseKey, ltr: true },
                    instantCreds.link && { k: "🔗 رابط الدعوة / التفعيل", v: instantCreds.link, ltr: true },
                    instantCreds.profileName && { k: "👤 البروفايل المخصص", v: instantCreds.profileName },
                    instantCreds.pin && { k: "🔢 رمز PIN للبروفايل", v: instantCreds.pin, ltr: true },
                    instantCreds.note && { k: "📝 ملاحظة", v: instantCreds.note },
                  ].filter(Boolean).map((row: any) => (
                    <div key={row.k} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#070b14] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold text-slate-400">{row.k}</div>
                        <div dir={row.ltr ? "ltr" : "rtl"} className={`break-all font-mono text-xs font-bold text-white ${row.ltr ? "text-left" : ""}`}>{row.v}</div>
                      </div>
                      <CopyBtn text={String(row.v)} />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <CopyBtn text={instantCreds.whatsappText} label="نسخ رسالة التسليم الكاملة" />
                    <button
                      type="button"
                      onClick={() => openWhatsapp(instantCreds.customerPhone, instantCreds.whatsappText)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"
                    >
                      <MessageCircle size={15} /> إرسال عبر واتساب للعميل
                    </button>
                  </div>
                </div>
              )
            )}

            <div className="rounded-xl bg-white/[.04] px-3.5 py-2.5 text-center text-xs font-bold text-slate-300">
              {result.isLifetime ? "♾️ اشتراك دائم بدون تاريخ انتهاء" : <>المدة المطلوبة: <b className="text-white">{result.durationDays} يوم</b> {isWalletPaid && !onDemandRes ? `(حتى ${fmtDate(result.endDate)})` : "(تبدأ من لحظة التفعيل)"}</>}
            </div>

            <div className="grid gap-2.5 pt-1 sm:grid-cols-2">
              <Link href="/my-sales" className="btn-primary w-full"><History size={17} /> متابعة في «مبيعاتي»</Link>
              <button onClick={resetAll} className="btn-ghost w-full"><Plus size={18} /> عملية بيع جديدة</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- النموذج ----------
  const bt = platformId ? meta.availabilityByType?.[platformId] : null;
  const fullSlots = bt?.FULL?.slots ?? 0;
  const profileSlots = bt?.PROFILE?.slots ?? 0;
  const chosenSlots = isOnDemand ? 999 : (saleType === "FULL" ? fullSlots : profileSlots);
  const walletSufficient = (me?.walletBalance || 0) >= Number(amount || 0) && Number(amount || 0) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {err && <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">⚠️ {err}</div>}

      {/* 1. المنصة */}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-black text-white">١) اختر المنصة</h2>
          <span className="text-xs font-semibold text-slate-400">تظهر الأعداد المتاحة فقط دون كشف الحسابات</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {meta.platforms.map((p: any) => {
            const pMode = String(p.deliveryMode || "").toUpperCase();
            const pLink = pMode === "LINK_ONLY";
            const pOnDemand = pLink || pMode === "ON_DEMAND" || pMode === "ON_DEMAND_EMAIL";
            const t = meta.availabilityByType?.[p.id];
            const total = (t?.FULL?.slots ?? 0) + (t?.PROFILE?.slots ?? 0);
            const active = platformId === p.id;
            const outOfStock = !pOnDemand && total === 0 && !lookup?.renewable;
            return (
              <button key={p.id} type="button" disabled={outOfStock}
                onClick={() => selectPlatform(p)}
                className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-3.5 text-right transition ${active ? "border-amber-400 bg-amber-400/10 shadow-sm" : "border-white/10 bg-white/[.03] hover:border-white/25"} disabled:opacity-40`}>
                <div className="flex w-full items-center justify-between">
                  <PlatformLogo src={p.imageUrl} name={p.name} color={p.color} size={44} />
                  {pLink ? <Badge tone="blue">🔗 رابط</Badge>
                    : pOnDemand ? <Badge tone="gold">⚡ تفعيل فوري</Badge>
                    : <Badge tone={total > 0 ? "green" : "red"}>{total > 0 ? `${total} متاح` : "نافد"}</Badge>}
                </div>
                <div className="text-sm font-extrabold text-white">{p.name}</div>
                <div className="text-[11px] font-semibold text-slate-400">
                  {pLink ? "المدير يرسل رابط الاشتراك فقط"
                    : pOnDemand ? "تفعيل على إيميل العميل" : (
                    <>
                      {(t?.PROFILE?.slots ?? 0) > 0 && `بروفايل (${t.PROFILE.slots})`}
                      {(t?.PROFILE?.slots ?? 0) > 0 && (t?.FULL?.slots ?? 0) > 0 && " • "}
                      {(t?.FULL?.slots ?? 0) > 0 && `كامل (${t.FULL.slots})`}
                      {total === 0 && "لا يوجد مخزون"}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* اختيار نوع البيع: بروفايل أو حساب كامل */}
        {platformId && !isOnDemand && (
          <div className="mt-4 border-t border-dashed border-white/10 pt-4">
            <label className="label">نوع الاشتراك المباع للعميل</label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button type="button" disabled={profileSlots === 0 && !lookup?.renewable}
                onClick={() => changeSaleType("PROFILE")}
                className={`flex items-center gap-3 rounded-2xl border-2 p-3.5 text-right transition ${saleType === "PROFILE" ? "border-[#63a8ff] bg-[#2f7bff]/15 text-white" : "border-white/10 bg-white/[.03] hover:border-white/25"} disabled:opacity-40`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#63a8ff]"><Users size={20} /></span>
                <div className="flex-1">
                  <div className="text-sm font-black text-white">بروفايل واحد مشترك</div>
                  <div className="text-[11px] font-semibold text-slate-400">ملف داخل حساب يسع عدة عملاء • متاح: {profileSlots}</div>
                </div>
              </button>
              <button type="button" disabled={fullSlots === 0 && !lookup?.renewable}
                onClick={() => changeSaleType("FULL")}
                className={`flex items-center gap-3 rounded-2xl border-2 p-3.5 text-right transition ${saleType === "FULL" ? "border-[#63a8ff] bg-[#2f7bff]/15 text-white" : "border-white/10 bg-white/[.03] hover:border-white/25"} disabled:opacity-40`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-300"><UserCheck size={20} /></span>
                <div className="flex-1">
                  <div className="text-sm font-black text-white">حساب كامل خاص</div>
                  <div className="text-[11px] font-semibold text-slate-400">الحساب كله لعميل واحد فقط • متاح: {fullSlots}</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {platformId && isLinkOnly && (
          <div className="mt-4 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-xs font-bold text-sky-200">
            🔗 هذه المنصة تعمل بنظام <b>إرسال رابط فقط</b>: أدخل اسم العميل ورقمه والسند فقط — وسيضع المدير رابط التفعيل ليظهر لك في «مبيعاتي» وتنسخه للعميل.
          </div>
        )}
        {platformId && mode === "ON_DEMAND_EMAIL" && (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-bold text-amber-300">
            ⚡ هذه المنصة تعمل بنظام <b>التفعيل عند الطلب</b>: أدخل بريد العميل بالأسفل، وسيصله التفعيل بعد مراجعة المدير للطلب.
          </div>
        )}
      </section>

      {/* 2. العميل */}
      <section className="card p-5">
        <h2 className="mb-3 font-black text-white">٢) بيانات العميل</h2>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label">رقم الهاتف (مع رمز الدولة، بدون +)</label>
            <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="967771234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">اسم العميل</label>
            <input className="field" placeholder="الاسم الثلاثي" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {needsEmail && (
            <div className="sm:col-span-2">
              <label className="label">📧 البريد الإلكتروني للعميل <span className="text-red-400">(إلزامي لهذه المنصة)</span></label>
              <input type="email" className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="customer@gmail.com" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </div>
          )}
          {extraLabel && (
            <div className="sm:col-span-2">
              <label className="label">🔖 {extraLabel} <span className="text-red-400">(إلزامي)</span></label>
              <input className="field" placeholder={`أدخل ${extraLabel}`} value={customerExtra} onChange={(e) => setCustomerExtra(e.target.value)} />
            </div>
          )}
        </div>
        {lookup?.renewable && !isOnDemand && (
          <div className="mt-3.5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-emerald-300">
                <RefreshCcw size={17} /> عميل عائد — لديه اشتراك حالي على هذه المنصة
              </div>
              <button
                type="button"
                onClick={() => setForceNew((v) => !v)}
                className={`rounded-xl border px-3 py-1 text-xs font-extrabold transition ${
                  forceNew
                    ? "border-amber-400/40 bg-amber-400/15 text-amber-300"
                    : "border-white/15 bg-white/10 text-slate-200 hover:bg-white/15"
                }`}
              >
                {forceNew ? "✨ سيتم صرف حساب جديد (اضغط للعودة للتجديد)" : "بيع حساب جديد بدلاً من التجديد؟"}
              </button>
            </div>
            <p className="mt-1 text-xs font-semibold text-emerald-200/80">
              {forceNew
                ? "اخترت صرف حساب جديد مستقل للعميل بدلاً من تمديد اشتراكه السابق."
                : `تاريخ الانتهاء الحالي: ${fmtDate(lookup.renewable.endDate)} — سيتم تمديد نفس الحساب دون تغيير بياناته!`}
            </p>
          </div>
        )}
      </section>

      {/* 3. المدة */}
      <section className="card p-5">
        <h2 className="mb-3 font-black text-white">٣) مدة الاشتراك</h2>
        {isLifetimePlat ? (
          <div className="rounded-2xl border-2 border-amber-400/50 bg-amber-400/10 px-4 py-3.5 text-sm font-black text-amber-300">
            ♾️ اشتراك دائم مدى الحياة — لا ينتهي ولا يحتاج تجديداً.
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK_DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => { setDurationDays(d); setDurationInput(String(d)); }}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-black transition ${
                    durationDays === d
                      ? "border-amber-400 bg-amber-400/15 text-amber-200 shadow-sm"
                      : "border-white/10 bg-white/[.03] text-slate-300 hover:border-white/25"
                  }`}
                >
                  {d === 30 ? "شهر (30 يوم)" : d === 60 ? "شهران (60)" : d === 90 ? "3 أشهر (90)" : d === 180 ? "6 أشهر (180)" : "سنة (365)"}
                </button>
              ))}
            </div>
            <label className="label">أو أدخل عدد أيام مخصص</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                style={{ textAlign: "right" }}
                className="field pl-16 text-lg font-black"
                placeholder="مثال: 30"
                value={durationInput}
                onChange={(e) => {
                  const clean = e.target.value.replace(/[^\d]/g, "");
                  setDurationInput(clean);
                  setDurationDays(clean ? Math.min(3650, parseInt(clean, 10)) : 0);
                }}
              />
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-slate-400">يوم</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              {paymentType === "WALLET" && !isOnDemand
                ? "⚡ مع الدفع من المحفظة يبدأ احتساب المدة فوراً من هذه اللحظة."
                : "تبدأ المدة فعلياً من لحظة موافقة المدير / التفعيل."}
            </p>
          </div>
        )}
      </section>

      {/* 4. الدفع والسند */}
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-black text-white">٤) الدفع والسند</h2>
          <Badge tone={paymentType === "WALLET" ? "green" : "amber"}>
            {paymentType === "WALLET" ? "اعتماد فوري من المحفظة" : "مراجعة سند بنكي"}
          </Badge>
        </div>

        {/* التبديل بين الحوالة والمحفظة */}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setPaymentType("BANK")}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-3 transition ${
              paymentType === "BANK" ? "border-amber-400 bg-amber-400/10 text-white" : "border-white/10 bg-white/[.02] text-slate-400 hover:border-white/20"
            }`}
          >
            <Camera size={20} className={paymentType === "BANK" ? "text-amber-300" : ""} />
            <span className="text-xs font-black">حوالة بنكية (سند)</span>
          </button>

          <button
            type="button"
            onClick={() => setPaymentType("WALLET")}
            className={`flex flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 transition ${
              paymentType === "WALLET" ? "border-emerald-400 bg-emerald-400/10 text-white" : "border-white/10 bg-white/[.02] text-slate-400 hover:border-white/20"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Wallet size={20} className={paymentType === "WALLET" ? "text-emerald-300" : ""} />
              <span className="text-xs font-black">خصم من المحفظة</span>
            </div>
            <span className="font-mono text-[10px] font-extrabold text-amber-300">
              رصيدك: {Number(me?.walletBalance || 0).toLocaleString("ar-YE")} ر.ي
            </span>
          </button>
        </div>

        {/* حقل المبلغ */}
        <div className="mb-4">
          <label className="label">المبلغ المطلوب (ر.ي) <span className="text-red-400">*</span></label>
          <input
            className="field text-lg font-black text-amber-300"
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>

        {paymentType === "WALLET" ? (
          <div className={`rounded-2xl border p-4 text-center ${
            !amount || Number(amount) <= 0
              ? "border-white/10 bg-white/[.03]"
              : walletSufficient
                ? "border-emerald-400/30 bg-emerald-500/10"
                : "border-red-400/30 bg-red-500/10"
          }`}>
            <p className={`text-xs font-bold leading-relaxed ${
              !amount || Number(amount) <= 0
                ? "text-slate-300"
                : walletSufficient
                  ? "text-emerald-200"
                  : "text-red-300"
            }`}>
              {!amount || Number(amount) <= 0 ? (
                <>أدخل سعر البيع أعلاه ليتم خصمه من رصيد محفظتك ({Number(me?.walletBalance || 0).toLocaleString("ar-YE")} ر.ي).</>
              ) : walletSufficient ? (
                <>
                  ⚡ سيتم خصم <b className="text-white">{Number(amount).toLocaleString("ar-YE")} ر.ي</b> من محفظتك واعتماد الاشتراك فوراً.
                  <span className="mt-1 block font-mono text-[11px] text-amber-300">
                    سيصبح رصيدك بعد العملية: {(Number(me?.walletBalance || 0) - Number(amount)).toLocaleString("ar-YE")} ر.ي
                  </span>
                </>
              ) : (
                <>
                  ⚠️ رصيد محفظتك الحالي ({Number(me?.walletBalance || 0).toLocaleString("ar-YE")} ر.ي) أقل من المبلغ المطلوب ({Number(amount).toLocaleString("ar-YE")} ر.ي). اطلب من المدير شحن محفظتك أو اختر الدفع عبر حوالة بنكية.
                </>
              )}
            </p>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onReceipt(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className={`mb-3.5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 transition ${receipt ? "border-emerald-500 bg-emerald-500/10" : "border-white/15 bg-white/[.03] hover:border-amber-400"}`}>
              {receipt ? (
                <>
                  <img src={receipt.dataUrl} alt="معاينة السند" className="max-h-40 rounded-xl border border-white/10" />
                  <span className="text-xs font-extrabold text-emerald-300">✓ تم إرفاق السند ({receipt.name}) — اضغط للتغيير</span>
                </>
              ) : (
                <>
                  <Camera size={28} className="text-amber-300" />
                  <span className="text-sm font-extrabold text-white">صوّر أو اختر صورة سند التحويل أولاً</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300"><Sparkles size={13} /> يقرأ الذكاء الاصطناعي رقم العملية والبنك تلقائياً</span>
                </>
              )}
            </button>

            {aiState !== "idle" && (
              <div className={`mb-3.5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold ${
                aiState === "reading" ? "bg-amber-400/10 text-amber-200" : aiState === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-slate-300"}`}>
                {aiState === "reading" ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <Sparkles size={15} className="shrink-0" />}
                <span>{aiNote}</span>
              </div>
            )}

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className="label">البنك / وسيلة الدفع</label>
                <select className="field" value={bankId ?? ""} onChange={(e) => setBankId(Number(e.target.value))}>
                  {meta.paymentMethods.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">رقم العملية (مراجعة/تعديل)</label>
                <input className="field font-mono" dir="ltr" style={{ textAlign: "left" }} placeholder="TXN-998877" value={txRef} onChange={(e) => setTxRef(e.target.value)} />
              </div>
            </div>
          </>
        )}
      </section>

      <button
        type="button"
        disabled={busy || (!platformId) || (chosenSlots === 0 && !lookup?.renewable) || (paymentType === "WALLET" && !walletSufficient)}
        onClick={submit}
        className="btn-gold w-full py-4 text-base shadow-lg"
      >
        {busy ? "جارٍ التنفيذ…" : paymentType === "WALLET"
          ? "⚡ خصم من المحفظة واعتماد فوراً"
          : isLinkOnly ? "🔗 رفع طلب الرابط للمدير"
          : isOnDemand ? "⚡ إرسال طلب التفعيل للمدير"
          : (lookup?.renewable && !forceNew) ? "↻ تأكيد التجديد على نفس الحساب"
          : `✓ تأكيد البيع (${saleType === "FULL" ? "حساب كامل" : "بروفايل"})`}
      </button>
    </div>
  );
}
