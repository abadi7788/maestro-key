// maestro-sw-v8 (النسخة المدمجة المثالية)
const STATIC_CACHE = "maestro-static-v8";
const OFFLINE_URL = "/offline.html";

// ملفات تُخزّن مسبقاً لضمان عمل الأساسيات بدون إنترنت
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/logo.png",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/badge-72x72.png"
];

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
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        tag: "maestro-key",
        silent: false,
        data: { href: a.href || "/inbox" },
      });
    }
    if (data.latestId > after) after = data.latestId;
  } catch {}
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: "reload" })))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("maestro-") && k !== STATIC_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// اعتراض الطلبات مع دمج قوة الأوفلاين وذكاء استثناء الـ API
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // طلبات الـAPI تبقى على الشبكة فقط ولا يتم تخزينها أبداً
  if (url.pathname.startsWith("/api/")) return;

  // 1. طلبات التنقل (الصفحات): الشبكة أولاً، مع حفظ نسخة تلقائية، وإن انقطع الإنترنت اعرض المخزّن أو صفحة الأوفلاين
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const offlineFallback = await cache.match(OFFLINE_URL);
        if (offlineFallback) return offlineFallback;
        return new Response("غير متصل بالإنترنت", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  // 2. الأصول الثابتة (صور، ستايلات، سكربتات): الكاش أولاً مع التحديث في الخلفية
  if (
    url.origin === self.location.origin &&
    ["image", "style", "script", "font"].includes(req.destination)
  ) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || network;
      }),
    );
  }
});

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
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
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