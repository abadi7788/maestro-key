"use client";

let registration: Promise<ServiceWorkerRegistration | null> | undefined;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Register on login as well as app pages, independently of Push permission. */
export function registerPwaWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!registration) {
    registration = navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).then(async () => navigator.serviceWorker.ready).catch(() => {
      registration = undefined;
      return null;
    });
  }
  return registration;
}

export async function enablePushOnThisDevice(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) {
    return { ok: false, reason: "هذا المتصفح لا يدعم الإشعارات الفورية" };
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, reason: "لم يتم منح إذن الإشعارات من المتصفح" };
    }
    const reg = await registerPwaWorker();
    if (!reg) return { ok: false, reason: "تعذر تفعيل عامل الخدمة (Service Worker)" };

    const keyRes = await fetch("/api/push");
    const { publicKey } = await keyRes.json().catch(() => ({ publicKey: "" }));
    if (publicKey && "PushManager" in window) {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const saveRes = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!saveRes.ok) {
        return { ok: false, reason: "تعذر حفظ اشتراك الجهاز في الخادم" };
      }
    }
    try { localStorage.setItem("mk_alerts_on", "1"); } catch {}
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "تعذر تفعيل الإشعارات" };
  }
}

export async function disablePushOnThisDevice(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const endpoint = sub?.endpoint || "";
    if (sub) await sub.unsubscribe().catch(() => {});
    await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unsubscribe", endpoint }),
    }).catch(() => {});
    try { localStorage.removeItem("mk_alerts_on"); } catch {}
  } catch {}
}
