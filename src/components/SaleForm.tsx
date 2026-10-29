"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera, CheckCircle2, ChevronLeft, ImagePlus, Landmark, Loader2, Lock,
  Phone, Search, ShoppingCart, Sparkles, Trash2, User, Wallet, XCircle, RefreshCcw, Plus,
  Crown, UserRound, ScanLine, ArrowLeft, Zap, Hand, Coins,
} from "lucide-react";
import { api, fileToDataUrl, fmtDate, daysLeft, waLink, fetchMe } from "@/lib/client";
import { Badge, CopyBtn, PlatformLogo, Spinner, rentalBadge } from "@/components/ui";
import { normalizeDeliveryMode } from "@/lib/delivery";

type Meta = any;

export default function SaleForm() {
  const [meta, setMeta] = useState<Meta>(null);
  const [me, setMe] = useState<any>(null);
  const [platformId, setPlatformId] = useState<number>(0);
  const [phone, setPhone] = useState(""); const [name, setName] = useState("");
  const [lookup, setLookup] = useState<any>(null); const [looking, setLooking] = useState(false);
  const [duration, setDuration] = useState(0); const [amount, setAmount] = useState("");
  const [accountType, setAccountType] = useState<"FULL" | "PROFILE">("PROFILE");
  
  // Payment Type: RECEIPT (Bank Transfer) or WALLET
  const [paymentType, setPaymentType] = useState<"RECEIPT" | "WALLET">("RECEIPT");
  const [bankId, setBankId] = useState<number>(0); const [ref, setRef] = useState("");
  const [receipt, setReceipt] = useState(""); const [forceNew, setForceNew] = useState(false);
  const [customerEmail, setCustomerEmail] = useState(""); const [customerExtra, setCustomerExtra] = useState("");
  const [deliverySource, setDeliverySource] = useState<"AUTO" | "MANUAL">("AUTO");
  const [manualEmail, setManualEmail] = useState(""); const [manualPassword, setManualPassword] = useState("");
  const [manualLink, setManualLink] = useState(""); const [manualCode, setManualCode] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualProfileName, setManualProfileName] = useState("");
  const [manualPin, setManualPin] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);
  const [scan, setScan] = useState<"idle" | "reading" | "ok" | "fail">("idle");
  const [scanNote, setScanNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMe().then((u) => setMe(u)).catch(() => {});
    api("/api/meta").then((m) => {
      setMeta(m);
      const q = new URLSearchParams(window.location.search);
      const qp = q.get("phone"); const qplat = Number(q.get("platformId") || 0);
      if (qp) setPhone(qp);
      if (qplat) setPlatformId(qplat);
      else if (m.platforms?.[0]) setPlatformId(m.platforms[0].id);
      if (m.paymentMethods?.[0]) setBankId(m.paymentMethods[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onSync = async () => {
      const [m, u] = await Promise.all([
        api("/api/meta").catch(() => null),
        fetchMe().catch(() => null)
      ]);
      if (m) setMeta(m);
      if (u) setMe(u);
    };
    window.addEventListener("maestro-sync", onSync);
    return () => window.removeEventListener("maestro-sync", onSync);
  }, []);

  useEffect(() => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 7) { setLookup(null); return; }
    setLooking(true);
    const t = setTimeout(async () => {
      try { const d = await api(`/api/sales?phone=${encodeURIComponent(clean)}`); setLookup(d); if (d.customer) setName(d.customer.name); }
      catch {} finally { setLooking(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [phone]);

  const renewable = useMemo(() => {
    if (!lookup?.rentals || !platformId) return null;
    return lookup.rentals.find((r: any) => r.platformId === platformId && r.status === "ACTIVE")
      || lookup.rentals.find((r: any) => r.platformId === platformId && r.status === "ENDED") || null;
  }, [lookup, platformId]);
  const effectiveForceNew = deliverySource === "MANUAL" || forceNew || (!!renewable && !!renewable.accountType && renewable.accountType !== accountType);

  useEffect(() => {
    const hinted = meta?.priceByType?.[platformId]?.[accountType];
    if (hinted) setAmount(String(hinted));
  }, [platformId, accountType, meta]);

  useEffect(() => {
    if (!meta || !platformId) return;
    const cur = meta.availabilityByType?.[platformId]?.[accountType]?.slots ?? 0;
    const otherType = accountType === "FULL" ? "PROFILE" : "FULL";
    const other = meta.availabilityByType?.[platformId]?.[otherType]?.slots ?? 0;
    if (cur === 0 && other > 0) setAccountType(otherType);
  }, [meta, platformId, accountType]);

  const plat = meta?.platforms?.find((p: any) => p.id === platformId) || null;
  const deliveryMode = normalizeDeliveryMode(plat?.deliveryMode);
  const isInstant = deliveryMode === "INSTANT_INVENTORY";
  const isEmailMode = deliveryMode === "ON_DEMAND_EMAIL";
  const isLinkMode = deliveryMode === "LINK_ONLY";
  const isLifetime = !!plat?.isLifetime;
  const emailRequired = isEmailMode || (isInstant && !!plat?.requiresCustomerEmail);

  if (!meta) return <Spinner text="جارٍ تجهيز نقطة البيع…" />;

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("الملف يجب أن يكون صورة سند"); return; }
    const dataUrl = await fileToDataUrl(file);
    setReceipt(dataUrl);
    setScan("reading"); setScanNote("جارٍ قراءة السند بالذكاء الاصطناعي…");
    try {
      const d = await api("/api/ai/receipt", {
        method: "POST",
        body: JSON.stringify({ image: dataUrl, banks: (meta?.paymentMethods || []).map((x: any) => ({ id: x.id, name: x.name })) }),
      });
      if (d.transactionRef) setRef(d.transactionRef);
      if (d.amount) setAmount(String(d.amount));
      if (d.bankId) setBankId(Number(d.bankId));
      const parts = [d.bankName && `البنك: ${d.bankName}`, d.transactionRef && `رقم العملية: ${d.transactionRef}`, d.amount && `المبلغ: ${Number(d.amount).toLocaleString("ar-YE")} ر.ي`].filter(Boolean);
      setScan("ok");
      setScanNote(parts.length ? `تم استخراج: ${parts.join(" • ")} — راجع قبل التأكيد` : "قُرئت الصورة. أكمل الحقول يدوياً إن لزم.");
    } catch (e: any) {
      setScan("fail");
      setScanNote(e.message || "تعذر قراءة السند — أكمل البيانات يدوياً");
    }
  }

  async function submit() {
    setErr("");
    const numericAmount = Number(amount || 0);
    if (!platformId) return setErr("اختر المنصة");
    if (phone.replace(/\D/g, "").length < 7) return setErr("أدخل رقم واتساب العميل");
    if (!lookup?.customer && !name.trim()) return setErr("أدخل اسم العميل الجديد");

    if (paymentType === "WALLET") {
      const walletBal = Number(me?.walletBalance || 0);
      if (numericAmount <= 0) return setErr("حدد مبلغ الطلب أولاً للخصم من المحفظة");
      if (walletBal < numericAmount) return setErr(`رصيد محفظتك غير كافٍ (${walletBal.toLocaleString()} ر.ي) والمطلوب (${numericAmount.toLocaleString()} ر.ي)`);
    } else {
      if (!bankId || !ref.trim()) return setErr("اختر البنك وأدخل رقم العملية");
      if (!receipt) return setErr("📸 إرفاق صورة السند إلزامي قبل سحب الاشتراك");
    }

    if (emailRequired && !customerEmail.trim()) return setErr("هذا الاشتراك يتطلب إيميل العميل للتفعيل — اطلبه من العميل وأدخله");
    if (!isLifetime && (!duration || duration < 1)) return setErr("أدخل مدة الاشتراك بالأيام");
    if (deliverySource === "MANUAL" && !manualEmail.trim() && !manualPassword && !manualLink.trim() && !manualCode.trim()) {
      return setErr("أدخل بيانات التسليم اليدوي (إيميل أو كلمة مرور أو رابط أو كود على الأقل)");
    }
    if (deliverySource === "AUTO" && isInstant && (effectiveForceNew || !renewable)) {
      const availableForType = meta?.availabilityByType?.[platformId]?.[accountType]?.slots ?? 0;
      if (availableForType <= 0) return setErr(accountType === "PROFILE" ? "لا يوجد ملف / بروفايل متاح لهذه المنصة حالياً" : "لا يوجد حساب كامل متاح لهذه المنصة حالياً");
    }

    setBusy(true);
    try {
      const d = await api("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          platformId, durationDays: duration, customerName: name, customerPhone: phone,
          paymentType,
          paymentMethodId: paymentType === "WALLET" ? null : bankId, 
          transactionRef: paymentType === "WALLET" ? `WALLET-${Date.now().toString().slice(-6)}` : ref.trim(), 
          amount: numericAmount,
          receiptImageData: paymentType === "WALLET" ? null : receipt, 
          mode: effectiveForceNew ? "NEW" : "AUTO", 
          accountType,
          customerEmail: customerEmail.trim(), customerExtra: customerExtra.trim(),
          deliverySource,
          manualEmail: manualEmail.trim(), manualPassword, manualLink: manualLink.trim(),
          manualCode: manualCode.trim(), manualNote: manualNote.trim(),
          manualProfileName: accountType === "PROFILE" ? manualProfileName.trim() : null,
          manualPin: accountType === "PROFILE" ? manualPin.trim() : null,
        }),
      });
      setResult(d); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  function reset() {
    setResult(null); setPhone(""); setName(""); setLookup(null); setRef(""); setReceipt(""); 
    setForceNew(false); setCustomerEmail(""); setCustomerExtra(""); setDeliverySource("AUTO"); 
    setManualEmail(""); setManualPassword(""); setManualLink(""); setManualCode(""); setManualNote(""); 
    setManualProfileName(""); setManualPin("");
    setAmount(""); setDuration(0); setErr(""); setScan("idle"); setScanNote(""); 
  }

  // ---------------- SUBMITTED VIEW ----------------
  if (result) {
    if (result.manual && result.delivered) {
      const d = result.delivered;
      const isFull = result.accountType === "FULL" || accountType === "FULL";
      const rows = [
        { l: "📧 الإيميل", v: d.email },
        { l: "🔑 كلمة المرور", v: d.password },
        (!isFull && d.profileName) ? { l: "👤 الملف / البروفايل", v: d.profileName } : null,
        (!isFull && d.pin) ? { l: "🔒 رمز PIN", v: d.pin } : null,
        { l: "🔗 الرابط", v: d.link },
        { l: "🎟️ الكود", v: d.code },
        { l: "📝 ملاحظة", v: d.note },
      ].filter(Boolean) as { l: string; v: string }[];

      return (
        <div className="pop-in mx-auto max-w-2xl">
          <div className="card-deep overflow-hidden">
            <div className="relative px-7 py-10 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#26c281] to-[#0b6e4f] shadow-[0_16px_40px_rgba(38,194,129,.4)]">
                <CheckCircle2 size={44} strokeWidth={2.2} className="text-white" />
              </div>
              <h2 className="mt-5 text-3xl font-black tracking-tight text-white">تم التسليم اليدوي بنجاح</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-relaxed text-slate-300">{result.message}</p>
            </div>
            <div className="space-y-4 px-6 pb-7">
              <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-xs font-bold text-slate-400">العميل</span>
                  <span className="text-sm font-extrabold text-white">{result.customer.name} • <span dir="ltr" className="font-mono">{result.customer.phone}</span></span>
                </div>
                <div className="my-2 h-px bg-white/10" />
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-xs font-bold text-slate-400">الطلب</span>
                  <span className="text-sm font-extrabold text-white">{result.platformName} — {isFull ? "حساب كامل" : "بروفايل مستقل"} — {result.isLifetime ? "دائم ♾️" : `${result.durationDays} يوم`}</span>
                </div>
              </div>
              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.l} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-3 py-2.5">
                    <div className="min-w-0 flex-1"><div className="text-[11px] font-bold text-slate-400">{row.l}</div><div dir="ltr" className="truncate text-left font-mono text-[15px] font-bold text-white">{row.v}</div></div>
                    <CopyBtn text={row.v} />
                  </div>
                ))}
              </div>
              <a href={waLink(result.customer.phone, result.whatsappMessage)} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-5 py-3.5 font-extrabold text-white transition hover:bg-[#178a45]">
                إرسال البيانات للعميل عبر واتساب
              </a>
              <div className="flex justify-center"><CopyBtn text={result.whatsappMessage} label="نسخ رسالة الواتساب كاملة" /></div>
              <button onClick={reset} className="btn-primary w-full"><Plus size={18} /> عملية بيع جديدة</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="pop-in mx-auto max-w-2xl">
        <div className="card-deep hero-lock overflow-hidden">
          <div className="relative px-7 py-10 text-center">
            <div className="relative">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#2f7bff] to-[#174ea6] shadow-[0_16px_40px_rgba(47,123,255,.4)]">
                <CheckCircle2 size={44} strokeWidth={2.2} className="text-white" />
              </div>
            </div>
            <h2 className="mt-5 text-3xl font-black tracking-tight text-white">
              {paymentType === "WALLET" ? "تم تأكيد وسحب الطلب بنجاح" : "تم إرسال الطلب إلى المدير"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-relaxed text-slate-300">{result.message}</p>
          </div>

          <div className="space-y-4 px-6 pb-7">
            <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-xs font-bold text-slate-400">العميل</span>
                <span className="text-sm font-extrabold text-white">{result.customer.name} • <span dir="ltr" className="font-mono">{result.customer.phone}</span></span>
              </div>
              <div className="my-2 h-px bg-white/10" />
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-xs font-bold text-slate-400">الطلب</span>
                <span className="text-sm font-extrabold text-white">{result.platformName} — {result.accountType === "FULL" ? "حساب كامل" : "ملف / بروفايل"} — {result.isLifetime ? "دائم ♾️" : `${result.durationDays} يوم`}</span>
              </div>
            </div>

            <div className="relative rounded-2xl border border-white/15 bg-gradient-to-br from-white/[.06] to-white/[.02] p-6 text-center">
              {paymentType === "WALLET" ? (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 backdrop-blur">
                    <CheckCircle2 size={28} className="text-emerald-400" />
                  </div>
                  <p className="mt-3 text-base font-black text-white">تم الخصم المباشر من رصيد المحفظة</p>
                  <p className="mx-auto mt-2 max-w-md text-[13px] font-semibold leading-[1.9] text-slate-300">
                    تم اعتماد العملية فوراً وسحب الاشتراك دون الحاجة لمراجعة السند البنكي. يمكنك مراجعة البيانات في <b className="text-white">«مبيعاتي»</b>.
                  </p>
                </>
              ) : (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
                    <Lock size={28} className="text-[#5ba2ff]" />
                  </div>
                  <p className="mt-3 text-base font-black text-white">بيانات الحساب مقفلة بانتظار السند</p>
                  <p className="mx-auto mt-2 max-w-md text-[13px] font-semibold leading-[1.9] text-slate-300">
                    لن تظهر البيانات قبل <b className="text-white">تأكيد المدير للسند</b>.
                    بعد التأكيد افتح <b className="text-white">«مبيعاتي»</b> واضغط «عرض بيانات الحساب» لإرسالها للعميل.
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="/my-sales" className="btn-gold flex-1">
                متابعة حالة الطلب في مبيعاتي <ArrowLeft size={18} />
              </Link>
              <button onClick={reset} className="btn-primary flex-1">
                <Plus size={18} /> عملية بيع جديدة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- MAIN FORM ----------------
  const slots = (pid: number) => meta.availability?.[pid]?.slots ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5 stagger">
      {/* Step 1: platform */}
      <section className="card card-hover overflow-hidden">
        <div className="border-b border-white/10 bg-white/[.03] px-6 py-5">
          <div className="section-head">
            <span className="step-num">١</span>
            <div>
              <h3 className="section-title">اختر المنصة ونوع الحساب</h3>
              <p className="section-sub">يظهر عدد الأماكن المتاحة — يتم حجب كلمة المرور حتى إتمام الدفع والتأكيد.</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {meta.platforms.map((p: any) => {
              const s = slots(p.id); const active = platformId === p.id;
              const pm = normalizeDeliveryMode(p.deliveryMode);
              return (
                <button key={p.id} type="button" onClick={() => setPlatformId(p.id)}
                  className={`choice ${active ? "choice-selected-blue" : ""} ${pm === "INSTANT_INVENTORY" && s === 0 ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <PlatformLogo src={p.imageUrl} name={p.name} color={p.color} size={64} />
                    {active && <CheckCircle2 size={18} className="text-white" />}
                  </div>
                  <div className="mt-3 text-[13px] font-extrabold leading-tight">{p.name}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pm === "LINK_ONLY"
                      ? <span className={`pill ${active ? "bg-white/15 text-white" : "pill-blue"}`}>🔗 تسليم برابط</span>
                      : pm === "ON_DEMAND_EMAIL"
                        ? <span className={`pill ${active ? "bg-white/15 text-white" : "pill-amber"}`}>📧 تفعيل على الإيميل</span>
                        : s > 0
                          ? <span className={`pill ${active ? "bg-white/15 text-white" : "pill-green"}`}>متاح: {s} مكان</span>
                          : <span className={`pill ${active ? "bg-white/15 text-white/70" : "pill-red"}`}>غير متاح حالياً</span>}
                    {p.isLifetime && <span className="pill pill-gold">♾️ دائم</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {isInstant && <div className="divider" />}

          {isInstant && (
          <div>
            <h4 className="flex items-center gap-2 text-sm font-black text-white">
              <Sparkles size={16} className="text-[#1e5eff]" />
              اختر نوع الاشتراك
            </h4>
            <p className="mt-1 text-xs font-semibold text-slate-400">حدد هل الاشتراك حساب كامل بدون PIN أو ملف بروفايل مشترك بـ PIN.</p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                { type: "FULL", icon: <Crown size={22} />, title: "حساب كامل", desc: "إيميل + باسورد بدون رمز PIN للعميل الواحد" },
                { type: "PROFILE", icon: <UserRound size={22} />, title: "ملف / بروفايل", desc: "ملف مخصص مع PIN مستقل داخل حساب مشترك" },
              ] as const).map((opt) => {
                const count = meta.availabilityByType?.[platformId]?.[opt.type]?.slots ?? 0;
                const active = accountType === opt.type;
                return (
                  <button key={opt.type} type="button" disabled={count <= 0} onClick={() => setAccountType(opt.type)}
                    className={`choice ${active ? "choice-selected" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? "bg-white/15 text-white" : "bg-[#2f7bff]/15 text-[#63a8ff]"}`}>
                          {opt.icon}
                        </div>
                        <div>
                          <div className="text-[15px] font-black">{opt.title}</div>
                          <p className={`mt-1 max-w-[220px] text-[12px] font-semibold leading-relaxed ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.desc}</p>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {count > 0
                          ? <span className={`pill ${active ? "bg-[#5ba2ff] text-white" : "pill-green"}`}>متاح: {count}</span>
                          : <span className="pill pill-red">غير متاح</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          <div className="divider" />

          <div>
            <h4 className="flex items-center gap-2 text-sm font-black text-white">
              <Zap size={16} className="text-[#f5d67b]" />
              طريقة الصرف
            </h4>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setDeliverySource("AUTO")}
                className={`choice ${deliverySource === "AUTO" ? "choice-selected-blue" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${deliverySource === "AUTO" ? "bg-white/15 text-white" : "bg-[#2f7bff]/15 text-[#63a8ff]"}`}>
                    <Zap size={22} />
                  </div>
                  <div>
                    <div className="text-[15px] font-black">صرف تلقائي من المخزون</div>
                    <p className="mt-1 max-w-[240px] text-[12px] font-semibold text-slate-400">يسحب النظام الحساب المتاح تلقائياً.</p>
                  </div>
                </div>
              </button>
              <button type="button" onClick={() => setDeliverySource("MANUAL")}
                className={`choice ${deliverySource === "MANUAL" ? "choice-selected" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${deliverySource === "MANUAL" ? "bg-white/15 text-white" : "bg-[#c99327]/15 text-[#f5d67b]"}`}>
                    <Hand size={22} />
                  </div>
                  <div>
                    <div className="text-[15px] font-black">تسليم يدوي فوري</div>
                    <p className="mt-1 max-w-[240px] text-[12px] font-semibold text-slate-400">تدخل بيانات الحساب بنفسك للعميل.</p>
                  </div>
                </div>
              </button>
            </div>

            {deliverySource === "MANUAL" && (
              <div className="pop-in mt-3 grid gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/5 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2 text-[12px] font-bold text-amber-200">أدخل بيانات التسليم اليدوي:</div>
                <div><label className="label">📧 الإيميل</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} /></div>
                <div><label className="label">🔑 كلمة المرور</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} /></div>
                
                {accountType === "PROFILE" && (
                  <>
                    <div><label className="label">👤 اسم البروفايل</label><input className="field" placeholder="بروفايل 1" value={manualProfileName} onChange={(e) => setManualProfileName(e.target.value)} /></div>
                    <div><label className="label">🔒 رمز PIN الخاص بالبروفايل</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="1234" value={manualPin} onChange={(e) => setManualPin(e.target.value)} /></div>
                  </>
                )}

                <div><label className="label">🔗 الرابط (إن وجد)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="https://..." value={manualLink} onChange={(e) => setManualLink(e.target.value)} /></div>
                <div><label className="label">🎟️ الكود (إن وجد)</label><input className="field" dir="ltr" style={{ textAlign: "left" }} value={manualCode} onChange={(e) => setManualCode(e.target.value)} /></div>
                <div className="sm:col-span-2"><label className="label">📝 ملاحظة (اختياري)</label><input className="field" value={manualNote} onChange={(e) => setManualNote(e.target.value)} /></div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Step 2: customer */}
      <section className="card card-hover overflow-hidden">
        <div className="border-b border-white/10 bg-white/[.03] px-6 py-5">
          <div className="section-head">
            <span className="step-num">٢</span>
            <div>
              <h3 className="section-title">بيانات المشترك</h3>
              <p className="section-sub">رقم واتساب العميل للتحقق من الاشتراكات السابقة والتجديد.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="label">📱 رقم واتساب العميل</label>
            <input className="field" dir="ltr" style={{ textAlign: "left" }} inputMode="tel" placeholder="777123456" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {looking && <p className="mt-2 text-xs font-bold text-[#63a8ff]">جارٍ البحث عن الرقم…</p>}
          </div>

          {lookup?.customer ? (
            <div className="pop-in overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent">
              <div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/25 px-5 py-3">
                <span className="pill pill-green">عميل معروف ✓</span>
                <span className="text-[15px] font-black text-white">{lookup.customer.name}</span>
              </div>
              <div className="space-y-3 px-5 py-4">
                {lookup.rentals.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-extrabold text-slate-400">اشتراكاته السابقة</p>
                    {lookup.rentals.slice(0, 4).map((r: any) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[.04] px-3.5 py-2.5 text-xs font-bold">
                        <span className="font-black text-white">{r.platformName}</span>
                        {r.accountType && <span className={`pill ${r.accountType === "FULL" ? "pill-amber" : "pill-blue"}`}>{r.accountType === "FULL" ? "حساب كامل" : "ملف / بروفايل"}</span>}
                        {rentalBadge(r.status)}
                        <span className="text-slate-400">حتى {fmtDate(r.endDate)}{r.status === "ACTIVE" && ` (بقي ${daysLeft(r.endDate)} يوم)`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : phone.replace(/\D/g, "").length >= 7 && !looking ? (
            <div className="pop-in rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.04] to-transparent px-5 py-4">
              <div className="mt-2">
                <label className="label">👤 اسم العميل</label>
                <div className="relative">
                  <User size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="field pr-11" placeholder="مثال: محمد عبدالله" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
            </div>
          ) : null}

          {(emailRequired || (plat?.extraFieldLabel && !isLinkMode)) && (
            <div className="pop-in space-y-3 rounded-2xl border border-[#5ba2ff]/30 bg-gradient-to-br from-[#2c6dff]/10 to-transparent px-5 py-4">
              {emailRequired && (
                <div>
                  <label className="label">📧 إيميل العميل (للتفعيل) <span className="text-[#ff5769]">إلزامي</span></label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} type="email" placeholder="customer@gmail.com" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                </div>
              )}
              {plat?.extraFieldLabel && !isLinkMode && (
                <div>
                  <label className="label">{plat.extraFieldLabel}</label>
                  <input className="field" placeholder={plat.extraFieldLabel} value={customerExtra} onChange={(e) => setCustomerExtra(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Step 3: duration */}
      <section className="card card-hover overflow-hidden">
        <div className="border-b border-white/10 bg-white/[.03] px-6 py-5">
          <div className="section-head">
            <span className="step-num">٣</span>
            <div>
              <h3 className="section-title">المدة والمبلغ</h3>
              <p className="section-sub">حدد مدة الاشتراك بالأيام وسعر العملية بالريال اليمني.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <div>
            <label className="label">⏳ مدة الاشتراك (أيام)</label>
            {isLifetime ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#c99327]/40 bg-[#c99327]/10 px-4 py-3.5 text-sm font-black text-[#f5d67b]">♾️ اشتراك دائم</div>
            ) : (
              <input className="field" inputMode="numeric" min={1} placeholder="مثال: 30" value={duration || ""} onChange={(e) => setDuration(Number(e.target.value.replace(/\D/g, "")) || 0)} />
            )}
          </div>
          <div>
            <label className="label">💵 السعر (ريال يمني)</label>
            <input className="field" inputMode="numeric" placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
      </section>

      {/* Step 4: Payment Method (Receipt vs Wallet) */}
      <section className="card card-hover overflow-hidden border-[#2f7bff]/25">
        <div className="border-b border-[#2f7bff]/30 bg-[#2f7bff]/10 px-6 py-5">
          <div className="section-head">
            <span className="step-num step-num-dark">٤</span>
            <div>
              <h3 className="section-title">طريقة الدفع والتأكيد</h3>
              <p className="section-sub">اختر الخصم المباشر من المحفظة أو إرفاق سند بنكي للمدير.</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {/* تبديل طريقة الدفع */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentType("RECEIPT")}
              className={`choice ${paymentType === "RECEIPT" ? "choice-selected-blue" : ""}`}
            >
              <div className="flex items-center gap-2.5">
                <Camera size={20} className={paymentType === "RECEIPT" ? "text-white" : "text-[#5ba2ff]"} />
                <div className="text-right">
                  <div className="text-[13px] font-black">سند بنكي / تحويل</div>
                  <div className="text-[11px] text-slate-400">إرفاق صورة السند ورقم الحوالة</div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPaymentType("WALLET")}
              className={`choice ${paymentType === "WALLET" ? "choice-selected" : ""}`}
            >
              <div className="flex items-center gap-2.5">
                <Wallet size={20} className={paymentType === "WALLET" ? "text-white" : "text-amber-400"} />
                <div className="text-right">
                  <div className="text-[13px] font-black">خصم من المحفظة</div>
                  <div className="text-[11px] text-amber-300 font-mono">
                    المتاح: {Number(me?.walletBalance || 0).toLocaleString()} ر.ي
                  </div>
                </div>
              </div>
            </button>
          </div>

          {paymentType === "WALLET" ? (
            <div className="pop-in rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-amber-300">الدفع عبر رصيد المحفظة المسبق</div>
                  <div className="text-xs text-slate-300 mt-0.5">سيتم خصم {Number(amount || 0).toLocaleString()} ر.ي فوراً واعتماد الحساب تلقائياً.</div>
                </div>
                <Coins size={28} className="text-amber-400" />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="label"><Landmark size={14} className="ml-1 inline text-[#1e5eff]" /> البنك / وسيلة الدفع</label>
                <div className="flex flex-wrap gap-2">
                  {meta.paymentMethods.map((b: any) => {
                    const active = bankId === b.id;
                    return (
                      <button key={b.id} type="button" onClick={() => setBankId(b.id)}
                        className={`rounded-xl border-2 px-4 py-2.5 text-[13px] font-extrabold transition active:scale-[.98] ${
                          active ? "border-[#63a8ff] bg-[#2f7bff] text-white shadow-lg shadow-[#2f7bff]/30" : "border-white/10 bg-white/[.04] text-slate-300 hover:border-[#63a8ff]/50 hover:text-white"
                        }`}>{b.name}</button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label"><Wallet size={14} className="ml-1 inline text-[#1e5eff]" /> رقم الحوالة / العملية</label>
                  <input className="field" dir="ltr" style={{ textAlign: "left" }} placeholder="مثال: KRM-884120" value={ref} onChange={(e) => setRef(e.target.value)} />
                </div>

                <div>
                  <label className="label">📸 صورة السند (كاميرا أو ألبوم)</label>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                  {receipt ? (
                    <div className="group relative overflow-hidden rounded-xl border-2 border-[#26c281]">
                      <img src={receipt} alt="السند" className="h-[110px] w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#26c281] px-2.5 py-1 text-[11px] font-black text-white">
                          {scan === "reading" ? "جارٍ القراءة…" : "تم إرفاق السند ✓"}
                        </span>
                      </div>
                      <button type="button" onClick={() => { setReceipt(""); setScan("idle"); setScanNote(""); }}
                        className="absolute left-2 top-2 rounded-full bg-red-500 p-1.5 text-white shadow-lg transition hover:scale-110">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="flex h-[110px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#b9c8e2] bg-gradient-to-b from-white/[.03] to-[#2f7bff]/10 text-[#174ea6] transition hover:border-[#1e5eff] hover:from-[#2f7bff]/15 active:scale-[.99]">
                      <div className="flex items-center gap-1.5">
                        <Camera size={20} />
                        <ImagePlus size={16} className="opacity-60" />
                      </div>
                      <div className="text-[12px] font-extrabold">تصوير / رفع صورة السند</div>
                    </button>
                  )}
                </div>
              </div>

              {scan !== "idle" && (
                <div className={`pop-in rounded-xl border px-4 py-3 text-xs font-bold ${
                  scan === "reading" ? "border-[#b9d7ff] bg-[#eaf3ff] text-[#174ea6]"
                  : scan === "ok" ? "border-[#bfe7d0] bg-[#e6f8ee] text-[#0f7a4e]"
                  : "border-[#ffe1b0] bg-[#fff2dc] text-[#a76400]"
                }`}>
                  <div className="flex items-start gap-2">
                    {scan === "reading" && <Loader2 size={14} className="mt-0.5 animate-spin" />}
                    {scan === "ok" && <CheckCircle2 size={14} className="mt-0.5" />}
                    {scan === "fail" && <XCircle size={14} className="mt-0.5" />}
                    <span>{scanNote}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Error display */}
      {err && (
        <div className="pop-in flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4">
          <XCircle size={20} className="mt-0.5 shrink-0 text-[#c11231]" />
          <div>
            <div className="text-[13px] font-black text-[#c11231]">تعذر إتمام الطلب</div>
            <div className="mt-1 text-[12.5px] font-semibold leading-relaxed text-red-200">{err}</div>
          </div>
        </div>
      )}

      {/* Submit button */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-[#0a1224] via-[#050914] to-[#0b1226] p-2">
        <button onClick={submit} disabled={busy}
          className="relative flex w-full items-center justify-center gap-3 rounded-[14px] bg-gradient-to-l from-[#63a8ff] to-[#2f7bff] px-6 py-5 text-lg font-black text-white shadow-[0_8px_28px_rgba(255,255,255,.15)] transition hover:bg-[#f2f6ff] active:scale-[.99] disabled:opacity-60">
          {busy ? <Loader2 size={22} className="animate-spin text-[#1e5eff]" /> : <ShoppingCart size={22} className="text-[#1e5eff]" />}
          <span>
            {paymentType === "WALLET" ? "خصم من المحفظة وتأكيد الطلب فوراً" : (renewable && !effectiveForceNew ? "إرسال طلب التجديد والسند للمدير" : "إرسال الطلب والسند للمدير")}
          </span>
          <ChevronLeft size={22} className="text-[#1e5eff]" />
        </button>
      </div>
    </div>
  );
}
