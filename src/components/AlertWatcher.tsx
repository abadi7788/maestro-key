"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Volume2, VolumeX, X } from "lucide-react";
import { api } from "@/lib/client";
import {
  installSoundUnlockHandlers,
  isNotifySoundEnabled,
  playNotifySound,
  setNotifySoundEnabled,
  unlockNotifySound,
} from "@/lib/notify-sound";
import { registerPwaWorker } from "@/lib/pwa-client";

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
const MAX_TOASTS = 4;
const MAX_HISTORY = 25;
const TOAST_MS = 7000;
const POLL_MS = 15000;

export default function AlertWatcher() {
  const [toasts, setToasts] = useState<AlertItem[]>([]);
  const [history, setHistory] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [soundOn, setSoundOn] = useState<boolean>(() => isNotifySoundEnabled());
  const after = useRef(0);
  const primed = useRef(false);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const historyRef = useRef<AlertItem[]>([]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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
      const maxId = Math.max(after.current, ...historyRef.current.map((h) => h.id), 0);
      localStorage.setItem(READ_KEY, String(maxId));
    } catch {}
  }, []);

  const togglePanel = useCallback(() => {
    void unlockNotifySound();
    setOpen((v) => {
      if (!v) {
        setUnread(0);
        try {
          const maxId = Math.max(after.current, ...historyRef.current.map((h) => h.id), 0);
          localStorage.setItem(READ_KEY, String(maxId));
        } catch {}
      }
      return !v;
    });
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    setNotifySoundEnabled(next);
    if (next) {
      void unlockNotifySound().then(() => playNotifySound({ force: true }));
    }
  }, [soundOn]);

  useEffect(() => {
    const onInboxRead = () => {
      setUnread(0);
      try {
        const maxId = Math.max(after.current, ...historyRef.current.map((h) => h.id), 0);
        localStorage.setItem(READ_KEY, String(maxId));
      } catch {}
    };
    window.addEventListener("maestro-inbox-read", onInboxRead);
    return () => window.removeEventListener("maestro-inbox-read", onInboxRead);
  }, []);

  async function enable() {
    if (enabling) return;
    setEnabling(true);
    try {
      await unlockNotifySound();
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      const reg = await registerPwaWorker();
      const keyRes = await fetch("/api/push");
      const { publicKey } = await keyRes.json();
      if (reg && publicKey && "PushManager" in window && Notification.permission === "granted") {
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub),
        });
      }
      setNotifySoundEnabled(true);
      setSoundOn(true);
      void playNotifySound({ force: true });

      const boot = await api("/api/alerts?after=0");
      const rows: AlertItem[] = boot.alerts || [];
      setHistory(rows.slice(-MAX_HISTORY).reverse());
      after.current = boot.latestId || 0;
      primed.current = true;
      try {
        localStorage.setItem(AFTER_KEY, String(after.current));
        localStorage.setItem(ON_KEY, "1");
      } catch {}
      reg?.active?.postMessage({ type: "watch", after: after.current });
      setReady(true);
    } catch {
      setReady(false);
    } finally {
      setEnabling(false);
    }
  }

  useEffect(() => {
    const uninstallAudioUnlock = installSoundUnlockHandlers();

    let readId = 0;
    try {
      const saved = Number(localStorage.getItem(AFTER_KEY) || 0);
      readId = Number(localStorage.getItem(READ_KEY) || 0);
      if (saved > 0) {
        after.current = saved;
        primed.current = true;
      }
    } catch {}

    try {
      if (
        localStorage.getItem(ON_KEY) === "1" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        setReady(true);
      }
    } catch {}

    const syncBackgroundPush = async () => {
      try {
        const reg = await registerPwaWorker();
        if (!reg || !("Notification" in window) || Notification.permission !== "granted") return;
        if (!("PushManager" in window)) return;
        const keyRes = await fetch("/api/push");
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        if (sub) {
          await fetch("/api/push", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(sub),
          });
          setReady(true);
        }
      } catch (err) {
        console.warn("Background push sync:", err);
      }
    };
    void syncBackgroundPush();

    const clearBadge = async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        const notes = await reg?.getNotifications();
        notes?.forEach((n) => n.close());
        if ("clearAppBadge" in navigator) {
          await (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge();
        }
      } catch {}
    };
    void clearBadge();

    const showSystemNotification = async (a: AlertItem) => {
      try {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        await reg.showNotification(a.title || "مايسترو كي", {
          body: a.body,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/badge-72x72.png",
          tag: `maestro-key-${a.id}`,
          silent: false,
          data: { href: a.href || "/inbox" },
        });
      } catch {}
    };

    const handleFreshAlerts = async (fresh: AlertItem[], latestId?: number) => {
      if (!fresh.length) return;
      after.current = Math.max(...fresh.map((a) => a.id), latestId || 0);
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

      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void playNotifySound();
        fresh.forEach(pushToast);
      } else {
        for (const a of fresh) await showSystemNotification(a);
      }
    };

    const tick = async () => {
      try {
        const data = await api(`/api/alerts?after=${after.current}`);
        const rows: AlertItem[] = data.alerts || [];
        if (!primed.current) {
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
        await handleFreshAlerts(fresh, data.latestId);
      } catch {}
    };

    // تحميل أولي للسجل + التحقق فوراً من أي تنبيهات جديدة وصلت منذ آخر حفظ
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
            if (!localStorage.getItem(READ_KEY)) {
              localStorage.setItem(READ_KEY, String(after.current));
            } else {
              const unreadBacklog = rows.filter((a) => a.id > readId).length;
              if (unreadBacklog > 0) setUnread(Math.min(99, unreadBacklog));
            }
          } catch {}
          return;
        }

        const freshSinceLast = rows.filter((a) => a.id > after.current);
        if (freshSinceLast.length > 0) {
          await handleFreshAlerts(freshSinceLast, data.latestId);
        } else {
          const unreadBacklog = rows.filter((a) => a.id > readId).length;
          if (unreadBacklog > 0) setUnread(Math.min(99, unreadBacklog));
        }
      } catch {}
    })();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void clearBadge();
        void tick();
      }
    };
    const onFocus = () => {
      void tick();
    };
    const onPing = () => {
      void tick();
    };
    const onSwMsg = (e: MessageEvent) => {
      if (e.data?.type === "clear-badge") void clearBadge();
      if (e.data?.type === "push-received") {
        void tick();
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void playNotifySound();
        }
      }
      if (e.data?.type === "navigate" && e.data?.href) {
        window.location.href = String(e.data.href);
      }
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("maestro-sync", onPing);
    window.addEventListener("maestro-alert-ping", onPing);
    navigator.serviceWorker?.addEventListener("message", onSwMsg);

    const timer = setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      uninstallAudioUnlock();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("maestro-sync", onPing);
      window.removeEventListener("maestro-alert-ping", onPing);
      navigator.serviceWorker?.removeEventListener("message", onSwMsg);
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
          <div className="w-[min(92vw,370px)] overflow-hidden rounded-2xl border border-white/15 bg-[#0c1426]/98 shadow-2xl backdrop-blur">
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
                  onClick={toggleSound}
                  title={soundOn ? "إيقاف صوت الإشعارات" : "تفعيل صوت الإشعارات"}
                  className={`rounded-lg p-1.5 transition ${
                    soundOn
                      ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      : "text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
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
                  {enabling ? "جارٍ التفعيل…" : "تفعيل إشعارات المتصفح والهاتف"}
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

      {/* التنبيهات المنبثقة أعلى الصفحة — مرئية بوضوح وتختفي تلقائياً وتدعم النقر للانتقال */}
      <div className="pointer-events-none fixed top-3 left-1/2 z-[95] flex w-[min(94vw,430px)] -translate-x-1/2 flex-col gap-2">
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
            className="pointer-events-auto cursor-pointer rounded-2xl border border-[#2f7bff]/40 bg-[#0c1426]/98 p-3.5 text-right text-white shadow-[0_14px_38px_rgba(0,0,0,.65)] backdrop-blur transition hover:border-[#2f7bff] active:scale-[.99]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-black text-[#8fd0ff]">
                <BellRing size={16} className="shrink-0 text-amber-300" />
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
                className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-slate-200">
              {t.body}
            </div>
            <div className="mt-1.5 text-[10px] font-bold text-slate-400">
              اضغط للانتقال ←
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
