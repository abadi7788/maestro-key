"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, CheckCheck, Send, Volume2, VolumeX, X } from "lucide-react";
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

function arrayBufferToBase64Url(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function detectIosNonStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  if (!isIos) return false;
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return !standalone;
}

const AFTER_KEY = "mk_alerts_after";
const ON_KEY = "mk_alerts_on";
const READ_KEY = "mk_alerts_read";
const NUDGE_DISMISS_KEY = "mk_push_nudge_dismissed";
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
  const [permState, setPermState] = useState<NotificationPermission | "unsupported">("default");
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusNote, setStatusNote] = useState("");
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

  /**
   * مزامنة اشتراك Web Push والتحقق من تطابق مفتاح VAPID الحالي:
   * إذا كان المتصفح يحمل اشتراكاً قديماً بمفتاح مختلف، يتم استبداله فوراً باشتراك جديد.
   */
  const ensurePushSubscription = useCallback(async (requestPrompt: boolean): Promise<{ ok: boolean; reason?: string }> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { ok: false, reason: "المتصفح لا يدعم إشعارات الويب" };
    }

    if (detectIosNonStandalone()) {
      setIosNeedsInstall(true);
      return { ok: false, reason: "على الآيفون: اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية» أولاً" };
    }

    let perm = Notification.permission;
    setPermState(perm);

    if (perm === "default" && requestPrompt) {
      perm = await Notification.requestPermission();
      setPermState(perm);
    }

    if (perm === "denied") {
      setReady(false);
      return { ok: false, reason: "الإشعارات محظورة من إعدادات المتصفح لهذا الموقع" };
    }
    if (perm !== "granted") {
      setReady(false);
      return { ok: false, reason: "يلزم الموافقة على إذن الإشعارات" };
    }

    const reg = await registerPwaWorker();
    if (!reg || !("PushManager" in window)) {
      return { ok: false, reason: "خدمة الخلفية (Service Worker) غير متوفرة حالياً" };
    }

    const keyRes = await fetch("/api/push", { cache: "no-store" });
    const keyData = await keyRes.json().catch(() => ({}));
    const publicKey = String(keyData?.publicKey || "").trim();
    if (!publicKey) {
      return { ok: false, reason: "تعذر جلب مفتاح الإشعارات من الخادم" };
    }

    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const existingKey = arrayBufferToBase64Url(sub.options?.applicationServerKey);
      if (existingKey && existingKey !== publicKey) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const saveRes = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });

    if (!saveRes.ok) {
      return { ok: false, reason: "فشل حفظ اشتراك الجهاز في قاعدة البيانات" };
    }

    try {
      localStorage.setItem(ON_KEY, "1");
    } catch {}
    setReady(true);
    setNudgeDismissed(true);
    return { ok: true };
  }, []);

  async function enable() {
    if (enabling) return;
    setEnabling(true);
    setStatusNote("");
    try {
      await unlockNotifySound();
      setNotifySoundEnabled(true);
      setSoundOn(true);

      const res = await ensurePushSubscription(true);
      if (!res.ok) {
        setStatusNote(`⚠️ ${res.reason || "تعذر تفعيل الإشعارات"}`);
        return;
      }

      await playNotifySound({ force: true });

      const boot = await api("/api/alerts?after=0");
      const rows: AlertItem[] = boot.alerts || [];
      setHistory(rows.slice(-MAX_HISTORY).reverse());
      after.current = boot.latestId || 0;
      primed.current = true;
      try {
        localStorage.setItem(AFTER_KEY, String(after.current));
      } catch {}

      const reg = await registerPwaWorker();
      reg?.active?.postMessage({ type: "watch", after: after.current });
      setStatusNote("✓ تم تفعيل إشعارات الهاتف والخلفية بنجاح");
    } catch {
      setStatusNote("⚠️ تعذر إكمال التفعيل — تأكد من فتح التطبيق عبر HTTPS");
    } finally {
      setEnabling(false);
    }
  }

  async function testPush() {
    if (testing) return;
    setTesting(true);
    setStatusNote("");
    try {
      await unlockNotifySound();
      setNotifySoundEnabled(true);
      setSoundOn(true);

      const subRes = await ensurePushSubscription(true);
      if (!subRes.ok) {
        await playNotifySound({ force: true });
        setStatusNote(`⚠️ ${subRes.reason}`);
        return;
      }

      const d = await api<{ ok: boolean; sent: number; failed: number; total: number; errors?: string[] }>(
        "/api/push",
        { method: "POST", body: JSON.stringify({ action: "test" }) },
      );

      await playNotifySound({ force: true });
      window.dispatchEvent(new Event("maestro-alert-ping"));

      if (d.sent > 0) {
        setStatusNote(`✓ أُرسل إشعار الخلفية إلى ${d.sent} جهاز — سيظهر أعلى شاشة الهاتف!`);
      } else if (d.total === 0) {
        setStatusNote("⚠️ لم يتم تسجيل أي جهاز بعد — أعد الضغط على زر التفعيل.");
      } else {
        setStatusNote(`⚠️ تعذر التسليم (${d.errors?.[0] || "حاول إعادة التفعيل"})`);
      }
    } catch (e: any) {
      setStatusNote(`⚠️ ${e?.message || "فشل اختبار الإشعار"}`);
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    const uninstallAudioUnlock = installSoundUnlockHandlers();
    setIosNeedsInstall(detectIosNonStandalone());

    if (typeof window !== "undefined" && "Notification" in window) {
      setPermState(Notification.permission);
      if (Notification.permission !== "granted") {
        try {
          setNudgeDismissed(sessionStorage.getItem(NUDGE_DISMISS_KEY) === "1");
        } catch {
          setNudgeDismissed(false);
        }
      }
    } else {
      setPermState("unsupported");
    }

    let readId = 0;
    try {
      const saved = Number(localStorage.getItem(AFTER_KEY) || 0);
      readId = Number(localStorage.getItem(READ_KEY) || 0);
      if (saved > 0) {
        after.current = saved;
        primed.current = true;
      }
    } catch {}

    void ensurePushSubscription(false);

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
      {/* زر الجرس العائم + تنبيه واضح لتفعيل إشعارات الخلفية عند الحاجة */}
      <div className="fixed bottom-24 left-4 z-[80] flex flex-col items-start gap-2 lg:bottom-6">
        {!open && !ready && !nudgeDismissed && permState !== "unsupported" && (
          <div className="flex max-w-[270px] items-center gap-2 rounded-2xl border border-amber-400/35 bg-[#0c1426]/95 px-3 py-2 text-xs font-bold text-amber-200 shadow-2xl backdrop-blur">
            <button
              type="button"
              onClick={() => void enable()}
              disabled={enabling}
              className="flex-1 text-right leading-snug hover:text-white"
            >
              {iosNeedsInstall
                ? "لتصلك إشعارات الخلفية على آيفون: أضف التطبيق للشاشة الرئيسية"
                : enabling
                ? "جارٍ تفعيل إشعارات الهاتف…"
                : "🔔 اضغط هنا لتفعيل إشعارات الهاتف والصوت في الخلفية"}
            </button>
            <button
              type="button"
              aria-label="إخفاء التذكير"
              onClick={() => {
                setNudgeDismissed(true);
                try {
                  sessionStorage.setItem(NUDGE_DISMISS_KEY, "1");
                } catch {}
              }}
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X size={13} />
            </button>
          </div>
        )}

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
            <div className="max-h-[42vh] overflow-y-auto p-2">
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
            <div className="space-y-2 border-t border-white/10 p-3">
              {statusNote && (
                <div
                  className={`rounded-xl px-3 py-2 text-[11px] font-bold leading-relaxed ${
                    statusNote.startsWith("✓")
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-500/15 text-amber-200"
                  }`}
                >
                  {statusNote}
                </div>
              )}

              {!ready && (
                <button
                  type="button"
                  onClick={enable}
                  disabled={enabling}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-[#2f7bff] to-[#ff3b5c] px-4 py-2.5 text-xs font-black text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  <BellRing size={15} />
                  {enabling ? "جارٍ التفعيل…" : "تفعيل إشعارات الهاتف والخلفية"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void testPush()}
                disabled={testing}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[.05] px-4 py-2 text-xs font-extrabold text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                <Send size={14} className="text-[#8fd0ff]" />
                {testing ? "جارٍ الإرسال…" : "تجربة إشعار الهاتف والصوت الآن"}
              </button>
            </div>
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
