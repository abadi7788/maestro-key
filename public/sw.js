// maestro-sw-v8-favicon-notification-icons
const CACHE_NAME = "maestro-key-static-v8";
const NOTIFICATION_ICON = "/icons/icon-192x192.png?v=mk8";
const NOTIFICATION_BADGE = "/icons/badge-72x72.png?v=mk8";
const STATIC_FILES = [
  "/offline.html",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-512x512.png",
  "/icons/badge-72x72.png",
  NOTIFICATION_ICON,
  NOTIFICATION_BADGE,
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Only public static artwork and a generic offline page, never store data.
    await cache.addAll(STATIC_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("maestro-key-static-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;
  if (request.mode === "navigate") {
    // No caching of authenticated HTML or credentials. Network is always primary.
    event.respondWith(fetch(request).catch(async () => {
      const offline = await caches.match("/offline.html");
      return offline || Response.error();
    }));
    return;
  }
  if (STATIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return fetch(request);
    })());
  }
});

function safeHref(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/inbox", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("/inbox", self.location.origin).href;
  } catch {
    return new URL("/inbox", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "إشعار جديد", body: "لديك تحديث جديد في متجر مايسترو كي", href: "/inbox" };
  try { data = { ...data, ...(event.data ? event.data.json() : {}) }; } catch { /* use a safe fallback */ }
  event.waitUntil(self.registration.showNotification("مايسترو كي", {
    body: (data.title ? String(data.title) + " — " : "") + String(data.body || "إشعار جديد"),
    icon: new URL(NOTIFICATION_ICON, self.location.origin).href,
    badge: new URL(NOTIFICATION_BADGE, self.location.origin).href,
    tag: "maestro-key",
    silent: false,
    dir: "rtl",
    lang: "ar",
    data: { href: safeHref(data.href) },
  }));
});

async function clearAll() {
  const notifications = await self.registration.getNotifications();
  notifications.forEach((notification) => notification.close());
  if (self.navigator && "clearAppBadge" in self.navigator) {
    try { await self.navigator.clearAppBadge(); } catch { /* system setting may deny badges */ }
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({ type: "clear-badge" }));
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeHref(event.notification.data?.href);
  event.waitUntil((async () => {
    await clearAll();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        if ("navigate" in client) await client.navigate(target);
        if ("focus" in client) { await client.focus(); return; }
      } catch { /* open a new window if the old one is not usable */ }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-now") event.waitUntil(clearAll());
  // Foreground polling belongs to the page; real background delivery uses Push.
  // Never use a Service Worker interval as a substitute for Web Push.
});
