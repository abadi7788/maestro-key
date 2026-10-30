"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Volume2, X } from "lucide-react";
import { api } from "@/lib/client";
import { playNotifySound, unlockNotifySound } from "@/lib/notify-sound";

type AlertItem = {
  id: number;
  title: string;
  body: string;
  href?: string | null;
  kind?: string | null;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const AFTER_KEY = "mk_alerts_after";
const ON_KEY = "mk_alerts_on";
const READ_KEY = "mk_alerts_read";
const MAX_TOASTS = 3;
const MAX_HISTORY = 20;
const TOAST_MS = 6000;
const POLL_MS = 25000;



export default function AlertWatcher() {
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [history, setHistory] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const after = useRef(0);
  const primed = useRef(false);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((all) => all.filter((x) => x.id !== id));
  }, []);

  const pushToast = useCallback(
    (a: AlertItem) => {
      setToasts((all) => [...all.filter((x) => x.id !== a.id), a].slice(-MAX_TOASTS));
      const prev = timers.current.get(a.id);
      if (prev) clearTimeout(prev);
      timers.current.set(a.id, setTimeout(() => dismissToast(a.id), TOAST_MS));
    },
    [dismissToast],
  );

  const go = useCallback((href?: string | null) => {
    window.location.href = href || "/inbox";
  }, []);

  const markAllRead = useCallback(() => {
    setUnread(0);
    try {
      const maxId = Math.max(after.current, ...history.map((h) => h.id), 0);
      localStorage.setItem(READ_KEY, String(maxId));
    } catch {}
  }, [history]);

  const togglePanel = useCallback(() => {
    setOpen((v) => {
      if (!v) {
        // فتح اللوحة = قراءة الكل
        setUnread(0);
        try {
          const maxId = Math.max(
            after.current,
            ...historyRef.current.map((h) => h.id),
            0,
          );
          localStorage.setItem(READ_KEY, String(maxId));
        } catch {}
      }
      return !v;
    });
  }, []);

  const historyRef = useRef<AlertItem[]>([]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  async function enable() {
    if (enabling) return;
    setEnabling(true);
    try {
      unlockNotifySound();
      if ("Notification" in window) await Notification.requestPermission();
      const reg = await navigator.serviceWorker?.register("/sw.js");
      const keyRes = await fetch("/api/push");
      const { publicKey } = await keyRes.json();
      if (reg && publicKey && "PushManager" in window) {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub),
        });
      }
      playNotifySound();
      const boot = await api("/api/alerts?after=0");
      after.current = boot.latestId || 0;
      primed.current = true;
      try {
        localStorage.setItem(AFTER_KEY, String(after.current));
        localStorage.setItem(ON_KEY, "1");
      } catch {}
      reg?.active?.postMessage({ type: "watch", after: after.current });
      navigator.serviceWorker?.ready.then((r) =>
        r.active?.postMessage({ type: "watch", after: after.current }),
      );
      setReady(true);
    } catch {
      setReady(false);
    } finally {
      setEnabling(false);
    }
  }

  useEffect(() => {
    let readId = 0;
    try {
      const saved = Number(localStorage.getItem(AFTER_KEY) || 0);
      readId = Number(localStorage.getItem(READ_KEY) || 0);
      if (saved) {
        after.current = saved;
        primed.current = true;
      }
    } catch {}
    try {
      if (
        localStorage.getItem(ON_KEY) === "1" &&
        Notification.permission === "granted"
      )
        setReady(true);
    } catch {}
    navigator.serviceWorker?.register("/sw.js").catch(() => {});

    const clearBadge = async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const notes = await reg?.getNotifications();
        notes?.forEach((n) => n.close());
        if ("clearAppBadge" in navigator)
          await (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge();
      } catch {}
    };
    clearBadge();
    const onVis = () => {
      if (document.visibilityState === "visible") clearBadge();
    };
    document.addEventListener("visibilitychange", onVis);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "clear-badge") clearBadge();
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);

    const showSystemNotification = async (a: AlertItem) => {
      try {
        if (!("Notification" in window) || Notification.permission !== "granted")
          return;
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        await reg.showNotification("مايسترو كي", {
          body: a.title + " — " + a.body,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/badge-72x72.png",
          tag: "maestro-key",
          silent: false,
          data: { href: a.href || "/inbox" },
        });
      } catch {}
    };

    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const data = await api(`/api/alerts?after=${after.current}`);

        const rows: AlertItem[] = data.alerts || [];
        if (!primed.current) {
          // أول تشغيل: اعرض السجل دون ضجيج، ولا تعتبر القديم "غير مقروء"
          after.current = data.latestId || 0;
          primed.current = true;
          setHistory(rows.slice(-MAX_HISTORY).reverse());
          try {
            localStorage.setItem(AFTER_KEY, String(after.current));
            localStorage.setItem(READ_KEY, String(after.current));
          } catch {}
          return;
        }
        const fresh = rows.filter((a) => a.id > after.current);
        if (!fresh.length) return;
        after.current = Math.max(...fresh.map((a) => a.id), data.latestId || 0);
        try {
          localStorage.setItem(AFTER_KEY, String(after.current));
        } catch {}
        navigator.serviceWorker?.controller?.postMessage({
          type: "watch",
          after: after.current,
        });
        setHistory((h) =>
          [...fresh.slice().reverse(), ...h]
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, MAX_HISTORY),
        );
        setUnread((u) => Math.min(99, u + fresh.length));
        if (document.visibilityState === "visible") {
          // التطبيق مفتوح: صوت + تنبيه منبثق داخل الصفحة
          playNotifySound();
          fresh.forEach(pushToast);
        } else {
          // التطبيق في الخلفية: إشعار نظام (يظهر في الشريط حتى لو التبويب مخفي)
          for (const a of fresh) await showSystemNotification(a);
        }
      } catch {}
    };

    // تحميل أولي للسجل + بدء الاستطلاع
    (async () => {
      try {
        const data = await api("/api/alerts?after=0");
        const rows: AlertItem[] = data.alerts || [];
        setHistory(rows.slice(-MAX_HISTORY).reverse());
        if (!primed.current) {
          after.current = data.latestId || 0;
          primed.current = true;
          try {
            localStorage.setItem(AFTER_KEY, String(after.current));
            if (!localStorage.getItem(READ_KEY))
              localStorage.setItem(READ_KEY, String(after.current));
            else {
              const unreadBacklog = rows.filter((a) => a.id > readId).length;
              if (unreadBacklog > 0) setUnread(Math.min(99, unreadBacklog));
            }
          } catch {}
          return;
        }
      } catch {}
    })();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeText = unread > 99 ? "99+" : String(unread);

  return (
    <>
      {/* زر الجرس العائم مع شارة العداد */}
      <div className="fixed bottom-24 left-4 z-[80] flex flex-col items-start gap-2 lg:bottom-6">
        {open && (
          <div className="w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0c1426]/98 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <BellRing size={16} className="text-[#8fd0ff]" />
                التنبيهات
                {unread > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                    {badgeText} جديد
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  title="تحديد الكل كمقروء"
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <CheckCheck size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="إغلاق"
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {history.length === 0 && (
                <p className="px-3 py-8 text-center text-xs font-bold text-slate-500">
                  لا توجد تنبيهات بعد — ستصلك هنا فور وصول أي جديد
                </p>
              )}
              {history.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    markAllRead();
                    go(a.href);
                  }}
                  className="mb-1 w-full rounded-xl px-3 py-2.5 text-right transition hover:bg-white/[.06]"
                >
                  <div className="flex items-center gap-2 text-[13px] font-black text-[#8fd0ff]">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#2f7bff]" />
                    <span className="truncate">{a.title}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-300">
                    {a.body}
                  </div>
                </button>
              ))}
            </div>
            {!ready && (
              <div className="border-t border-white/10 p-3">
                <button
                  type="button"
                  onClick={enable}
                  disabled={enabling}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#2f7bff] to-[#ff3b5c] px-4 py-2.5 text-xs font-black text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  <Volume2 size={15} />
                  {enabling ? "جارٍ التفعيل…" : "تفعيل صوت وإشعارات النظام"}
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={togglePanel}
          title="التنبيهات"
          aria-label="التنبيهات"
          className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-[#16233f] to-[#0c1426] text-white shadow-[0_10px_30px_rgba(0,0,0,.45)] transition hover:scale-105 active:scale-95"
        >
          <Bell size={20} className={unread > 0 ? "text-[#ffd166]" : "text-slate-300"} />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white shadow-lg ring-2 ring-[#0c1426]">
              {badgeText}
            </span>
          ) : (
            !ready && (
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 shadow ring-2 ring-[#0c1426]" />
            )
          )}
        </button>
      </div>

      {/* التنبيهات المنبثقة أعلى الصفحة — تختفي تلقائياً وتدعم النقر للانتقال */}
      <div className="pointer-events-none fixed top-3 left-1/2 z-[70] flex w-[min(94vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              dismissToast(t.id);
              go(t.href);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                dismissToast(t.id);
                go(t.href);
              }
            }}
            className="pointer-events-auto cursor-pointer rounded-2xl border border-white/10 bg-[#0c1426]/97 p-3 text-right text-white shadow-2xl backdrop-blur transition hover:border-[#2f7bff]/50 active:scale-[.99]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-black text-[#8fd0ff]">
                <BellRing size={15} className="shrink-0" />
                <span className="truncate">{t.title}</span>
              </div>
              <span
                role="button"
                tabIndex={-1}
                aria-label="إغلاق التنبيه"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(t.id);
                }}
                className="shrink-0 rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-300">
              {t.body}
            </div>
            <div className="mt-1 text-[10px] font-bold text-slate-500">
              اضغط للانتقال ←
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
