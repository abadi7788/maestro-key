"use client";
import { useEffect, useRef, useState } from "react";
import { BellRing, Volume2 } from "lucide-react";
import { api } from "@/lib/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function playSound() {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  [880, 660, 990].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.2);
  });
  setTimeout(() => ctx.close().catch(() => {}), 1200);
}

export default function AlertWatcher() {
  const [toasts, setToasts] = useState<{ id: number; title: string; body: string }[]>([]);
  const [ready, setReady] = useState(false);
  const after = useRef(0);
  const primed = useRef(false);

  async function enable() {
    try {
      if ("Notification" in window) await Notification.requestPermission();
      const reg = await navigator.serviceWorker?.register("/sw.js");
      const keyRes = await fetch("/api/push");
      const { publicKey } = await keyRes.json();
      if (reg && publicKey && "PushManager" in window) {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
      }
      playSound();
      const boot = await api("/api/alerts?after=0");
      after.current = boot.latestId || 0;
      primed.current = true;
      localStorage.setItem("mk_alerts_after", String(after.current));
      localStorage.setItem("mk_alerts_on", "1");
      reg?.active?.postMessage({ type: "watch", after: after.current });
      navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "watch", after: after.current }));
      setReady(true);
    } catch {
      setReady(false);
    }
  }

  useEffect(() => {
    const saved = Number(localStorage.getItem("mk_alerts_after") || 0);
    if (saved) { after.current = saved; primed.current = true; }
    if (localStorage.getItem("mk_alerts_on") === "1" && Notification.permission === "granted") setReady(true);
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const clearBadge = async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const notes = await reg?.getNotifications();
        notes?.forEach((n) => n.close());
        if ("clearAppBadge" in navigator) await (navigator as any).clearAppBadge();
      } catch {}
    };
    clearBadge();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") clearBadge(); });
    navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "clear-badge") clearBadge(); });

    const tick = async () => {
      try {
        const data = await api(`/api/alerts?after=${after.current}`);
        if (!primed.current) {
          after.current = data.latestId || 0;
          primed.current = true;
          localStorage.setItem("mk_alerts_after", String(after.current));
          return;
        }
        const fresh = (data.alerts || []).filter((a: any) => a.id > after.current);
        if (!fresh.length) return;
        after.current = Math.max(...fresh.map((a: any) => a.id), data.latestId || 0);
        localStorage.setItem("mk_alerts_after", String(after.current));
        navigator.serviceWorker?.controller?.postMessage({ type: "watch", after: after.current });
        playSound();
        for (const a of fresh) {
          if ("Notification" in window && Notification.permission === "granted") {
            const reg = await navigator.serviceWorker?.ready;
            if (reg) {
              await reg.showNotification("مايسترو كي", {
                body: a.title + " — " + a.body,
                icon: "/icons/notification-white-v3-192.png",
                badge: "/icons/notification-badge-v3-96.png",
                tag: "maestro-key",
                silent: false,
                data: { href: a.href || "/inbox" },
              });
            }
          }
          setToasts((t) => [...t, a].slice(-4));
        }
      } catch {}
    };
    tick();
    const timer = setInterval(tick, 7000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {!ready && (
        <button onClick={enable} className="fixed top-3 left-3 z-[80] flex items-center gap-2 rounded-2xl bg-gradient-to-l from-[#2f7bff] to-[#ff3b5c] px-4 py-3 text-xs font-black text-white shadow-xl">
          <Volume2 size={16} /> تفعيل صوت الإشعارات
        </button>
      )}
      <div className="fixed top-3 left-1/2 z-[70] flex w-[min(94vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <button key={t.id} onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="rounded-2xl border border-white/10 bg-[#0c1426]/95 p-3 text-right text-white shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-black text-[#8fd0ff]"><BellRing size={15} /> {t.title}</div>
            <div className="mt-1 text-xs font-semibold leading-relaxed text-slate-300">{t.body}</div>
          </button>
        ))}
      </div>
    </>
  );
}
