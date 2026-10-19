// maestro-sw-v6-white-rounded-icons
// Versioned rounded white tiles update the icon without changing notification behavior.
const NOTIFICATION_ICON = "/icons/notification-white-v3-192.png";
const NOTIFICATION_BADGE = "/icons/notification-badge-v3-96.png";
let after = 0;
let timer = null;

async function poll() {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (open.length) return;
  try {
    const res = await fetch("/api/alerts?after=" + after, { credentials: "include", cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    for (const a of data.alerts || []) {
      if (a.id > after) after = a.id;
      await self.registration.showNotification("مايسترو كي", {
        body: a.title + " — " + a.body,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        tag: "maestro-key",
        silent: false,
        data: { href: a.href || "/inbox" },
      });
    }
    if (data.latestId > after) after = data.latestId;
  } catch {}
}

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("message", (e) => {
  if (e.data?.type === "watch") {
    after = Number(e.data.after || after || 0);
    if (!timer) timer = setInterval(poll, 8000);
    poll();
  }
});
self.addEventListener("push", (event) => {
  let data = { title: "مايسترو كي", body: "إشعار جديد", href: "/inbox", tag: "mk" };
  try { data = { ...data, ...(event.data ? event.data.json() : {}) }; } catch {}
  event.waitUntil(self.registration.showNotification("مايسترو كي", {
    body: (data.title ? data.title + " — " : "") + (data.body || "إشعار جديد"),
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    tag: "maestro-key",
    silent: false,
    data: { href: data.href || "/inbox" },
  }));
});
async function clearAll() {
  const all = await self.registration.getNotifications();
  all.forEach((n) => n.close());
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: "clear-badge" }));
}
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const href = e.notification.data?.href || "/inbox";
  e.waitUntil((async () => {
    await clearAll();
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) { await c.focus(); return; }
    }
    await self.clients.openWindow(href);
  })());
});
self.addEventListener("message", (e) => {
  if (e.data?.type === "clear-now") e.waitUntil(clearAll());
});
