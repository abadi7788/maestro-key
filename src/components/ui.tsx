"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, RefreshCcw, X } from "lucide-react";
import { api, fmtDate, daysLeft } from "@/lib/client";


export function PlatformLogo({ src, name, color, size = 48, className = "" }: { src?: string | null; name: string; color?: string; size?: number; className?: string }) {
  if (src) {
    return <img src={src} alt={name} className={`shrink-0 rounded-2xl object-cover shadow-md ${className}`} style={{ width: size, height: size }} />;
  }
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-2xl font-black text-white ${className}`} style={{ width: size, height: size, background: color || "#334155" }}>
      {(name || "؟").slice(0, 1)}
    </span>
  );
}

export function Badge({ tone = "slate", children }: { tone?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    slate: "bg-[#eef2fa] text-[#465677]",
    green: "bg-[#e6f8ee] text-[#0f7a4e] ring-1 ring-[#0f7a4e]/10",
    red: "bg-[#ffeaee] text-[#c11231] ring-1 ring-[#c11231]/10",
    amber: "bg-[#fff2dc] text-[#a76400] ring-1 ring-[#a76400]/10",
    blue: "bg-[#eaf3ff] text-[#174ea6] ring-1 ring-[#174ea6]/10",
    gold: "bg-[#eaf3ff] text-[#174ea6] ring-1 ring-[#174ea6]/10",
    dark: "bg-[#050914] text-white",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tones[tone] || tones.slate}`}>{children}</span>;
}

export function rentalBadge(status: string) {
  if (status === "ACTIVE") return <Badge tone="green">● نشط</Badge>;
  if (status === "ENDED") return <Badge tone="red">منتهي — بانتظار إجراء</Badge>;
  if (status === "CLOSED") return <Badge tone="slate">مغلق</Badge>;
  if (status === "REJECTED") return <Badge tone="red">ملغي — سند مرفوض</Badge>;
  return <Badge>{status}</Badge>;
}
export function paymentBadge(status: string) {
  if (status === "CONFIRMED") return <Badge tone="green">سند مؤكد ✓</Badge>;
  if (status === "PENDING") return <Badge tone="amber">سند بانتظار المراجعة</Badge>;
  return <Badge tone="red">سند مرفوض</Badge>;
}
export function accountBadge(status: string) {
  if (status === "AVAILABLE") return <Badge tone="green">متاح للبيع</Badge>;
  if (status === "RENTED") return <Badge tone="blue">مؤجَّر بالكامل</Badge>;
  if (status === "NEEDS_PASSWORD_CHANGE") return <Badge tone="red">يحتاج تغيير كلمة مرور</Badge>;
  return <Badge>{status}</Badge>;
}

export function CopyBtn({ text, label = "نسخ" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch {} }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-white/15 active:scale-95">
      {ok ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />} {ok ? "تم النسخ" : label}
    </button>
  );
}

export function Spinner({ text = "جارٍ التحميل…" }: { text?: string }) {
  return <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500"><Loader2 className="animate-spin" size={28} /><p className="text-sm font-bold">{text}</p></div>;
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 border-dashed px-6 py-14 text-center">
      <div className="text-slate-300">{icon}</div>
      <p className="font-extrabold text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className={`pop-in mb-20 max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c1426] p-6 pb-8 shadow-2xl sm:mb-0 sm:max-h-[90dvh] sm:rounded-[28px] ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-lg font-black tracking-tight text-white">{title}</h3>
          <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-slate-300 transition hover:bg-white/15 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ReceiptButton({ paymentId, refText }: { paymentId: number; refText?: string }) {
  const [open, setOpen] = useState(false); const [img, setImg] = useState(""); const [loading, setLoading] = useState(false); const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="text-xs font-extrabold text-sky-700 underline decoration-dotted underline-offset-4 hover:text-sky-900"
        onClick={async () => { setOpen(true); setLoading(true); setErr(""); try { const d = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "receipt", paymentId }) }); setImg(d.image || ""); if (!d.image) setErr("لا توجد صورة مرفقة"); } catch (e: any) { setErr(e.message || "للمدير فقط"); } finally { setLoading(false); } }}>
        🧾 عرض السند {refText ? `(${refText})` : ""}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="صورة سند الدفع" wide>
        {loading ? <Spinner /> : err ? <p className="py-8 text-center font-bold text-red-600">{err}</p> : img ? <img src={img} alt="سند دفع" className="mx-auto max-h-[70dvh] w-auto rounded-xl border" /> : null}
        <p className="mt-3 text-center text-xs text-slate-400">صورة حساسة — تُعرض للمدير فقط عند الطلب ويُسجَّل عرضها في سجل التدقيق.</p>
      </Modal>
    </>
  );
}

export function StatCard({ label, value, sub, icon, tone = "text-slate-700 bg-slate-100" }: { label: string; value: ReactNode; sub?: string; icon: ReactNode; tone?: string }) {
  return (
    <div className="card p-4">
      <div className={`mb-3 inline-flex rounded-xl p-2.5 ${tone}`}>{icon}</div>
      <div className="text-2xl font-black leading-none text-slate-900">{value}</div>
      <div className="mt-1.5 text-[13px] font-bold text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function DueCard({ r }: { r: any }) {
  const left = daysLeft(r.endDate);
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold">{r.customerName}</div>
          <div className="text-xs font-semibold text-slate-500">{r.platformName} • <span dir="ltr">{r.customerPhone}</span></div>
        </div>
        {r.status === "ENDED" ? <Badge tone="red">انتهى {fmtDate(r.endDate)}</Badge> : left <= 0 ? <Badge tone="red">ينتهي اليوم</Badge> : <Badge tone="amber">بقي {left} يوم</Badge>}
      </div>
      <div className="mt-2 flex items-center gap-2">{rentalBadge(r.status)}{r.whatsappAlertSent && <Badge tone="blue">أُرسل تنبيه واتساب ✓</Badge>}</div>
      <Link href={`/sale?phone=${encodeURIComponent(r.customerPhone)}&platformId=${r.platformId}`} className="btn-primary mt-3.5 w-full py-2.5 text-sm"><RefreshCcw size={16} /> تسجيل تجديد — اربط السند وفعّل</Link>
    </div>
  );
}

