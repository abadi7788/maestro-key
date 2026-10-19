"use client";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail, User } from "lucide-react";
import { api } from "@/lib/client";

const ADMIN_EMAIL = "almaystrwbady@gmail.com";

export default function LoginPage() {
  const [mode, setMode] = useState<"choose" | "staff" | "admin-email" | "admin-code" | "admin-pass">("choose");
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function staffLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/auth", { method: "POST", body: JSON.stringify({ username, password }) });
      window.location.replace("/sale");
    } catch (e: any) {
      setErr(e.message || "تعذر الدخول");
      setBusy(false);
    }
  }

  async function sendCode() {
    setBusy(true); setErr(""); setInfo("");
    try {
      const d = await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "send-code", email }) });
      setInfo(d.message || "تم إرسال الكود");
      setMode("admin-code");
    } catch (e: any) {
      setErr(e.message || "تعذر إرسال الكود");
    } finally { setBusy(false); }
  }

  async function setAdminPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "set-password", email, code, password }) });
      window.location.replace("/dashboard");
    } catch (e: any) {
      setErr(e.message || "تعذر حفظ كلمة المرور");
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#03040a] px-4 py-10">
      <img src="/logo.png" alt="" aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[min(92vh,760px)] w-[min(92vh,760px)] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover opacity-[0.14]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,99,255,.22),transparent_46%),linear-gradient(180deg,#03040a_0%,#071224_60%,#14060d_100%)]" />

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <img src="/logo.png" alt="Maestro Key" className="mx-auto h-[150px] w-[150px] rounded-full object-cover ring-2 ring-white/20 shadow-[0_0_46px_rgba(20,99,255,.45)]" />
          <p className="mt-4 text-[11px] font-black tracking-[.42em] text-[#57c8ff]">MAESTRO <span className="text-[#ff4055]">KEY</span></p>
          <h1 className="mt-2 text-[32px] font-black text-white">مايسترو كي</h1>
        </div>

        <div className="rounded-[26px] border border-white/10 bg-[#050914]/90 p-6 shadow-[0_35px_90px_rgba(0,0,0,.55)] backdrop-blur-xl">
          <h2 className="text-center text-lg font-black text-white">تسجيل الدخول</h2>
          {err && <div className="mt-4 rounded-2xl border border-[#ff2438]/35 bg-[#ff2438]/10 px-4 py-3 text-center text-[13px] font-bold text-red-200">{err}</div>}
          {info && <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-center text-[13px] font-bold text-emerald-200">{info}</div>}

          {mode === "choose" && (
            <div className="mt-6 grid gap-3">
              <button onClick={() => { setErr(""); setMode("admin-email"); }} className="rounded-2xl bg-gradient-to-l from-[#1463ff] to-[#ff2438] py-4 text-[16px] font-black text-white">دخول الأدمن</button>
              <button onClick={() => { setErr(""); setMode("staff"); }} className="rounded-2xl border border-white/15 bg-white/[.04] py-4 text-[16px] font-black text-white">دخول الموظف</button>
            </div>
          )}

          {mode === "admin-email" && (
            <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await api("/api/auth", { method: "POST", body: JSON.stringify({ email, password }) }); window.location.replace("/dashboard"); } catch (err: any) { setErr(err.message || "تعذر الدخول"); setBusy(false); } }} className="mt-6 space-y-3">
              <div className="relative">
                <Mail size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#57c8ff]" />
                <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 pr-12 pl-4 text-left text-white outline-none focus:border-[#27c4ff]" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد" required />
              </div>
              <div className="relative">
                <LockKeyhole size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#ff4055]" />
                <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 pr-12 pl-12 text-white outline-none" dir="ltr" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" required />
                <button type="button" onClick={() => setShow(!show)} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#1463ff] via-[#7b61ff] to-[#ff2438] py-4 font-black text-white disabled:opacity-60">
                {busy ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />} دخول
              </button>
              <button type="button" onClick={sendCode} className="w-full py-2 text-sm font-bold text-[#8fd0ff]">إرسال كود لتغيير كلمة المرور</button>
              <button type="button" onClick={() => setMode("choose")} className="w-full py-2 text-sm font-bold text-slate-400">رجوع</button>
            </form>
          )}

          {mode === "admin-code" && (
            <form onSubmit={(e) => { e.preventDefault(); setMode("admin-pass"); }} className="mt-6 space-y-3">
              <p className="text-center text-sm font-semibold text-slate-300">أدخل الكود الذي وصل إلى بريدك</p>
              <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 text-center text-2xl tracking-[.4em] text-white outline-none" dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" required />
              <button className="w-full rounded-2xl bg-[#1463ff] py-4 font-black text-white">متابعة لتسجيل كلمة المرور</button>
              <button type="button" onClick={sendCode} className="w-full py-2 text-sm font-bold text-[#8fd0ff]">إعادة إرسال الكود</button>
            </form>
          )}

          {mode === "admin-pass" && (
            <form onSubmit={setAdminPassword} className="mt-6 space-y-3">
              <p className="text-center text-sm font-semibold text-slate-300">سجّل كلمة مرور الإدارة. بعدها تنشئ حسابات الموظفين من الداخل.</p>
              <div className="relative">
                <LockKeyhole size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#ff4055]" />
                <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 pr-12 pl-12 text-white outline-none" dir="ltr" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور الجديدة" required />
                <button type="button" onClick={() => setShow(!show)} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#1463ff] to-[#ff2438] py-4 font-black text-white disabled:opacity-60">
                {busy ? <Loader2 className="animate-spin" size={18} /> : null} حفظ كلمة المرور والدخول
              </button>
            </form>
          )}

          {mode === "staff" && (
            <form onSubmit={staffLogin} className="mt-6 space-y-3">
              <div className="relative">
                <User size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#57c8ff]" />
                <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 pr-12 pl-4 text-white outline-none" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم المستخدم" required />
              </div>
              <div className="relative">
                <LockKeyhole size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#ff4055]" />
                <input className="w-full rounded-2xl border border-white/10 bg-white/[.06] py-4 pr-12 pl-12 text-white outline-none" dir="ltr" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" required />
                <button type="button" onClick={() => setShow(!show)} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              <button disabled={busy} className="w-full rounded-2xl bg-white py-4 font-black text-[#050914] disabled:opacity-60">{busy ? "جارٍ الدخول…" : "دخول"}</button>
              <button type="button" onClick={() => setMode("choose")} className="w-full py-2 text-sm font-bold text-slate-400">رجوع</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
