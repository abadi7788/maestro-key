// maestro-sw-v6
const STATIC_CACHE = "maestro-static-v6";
// ملفات تُخزّن مسبقاً لتظهر صفحة عدم الاتصال بكامل هويتها حتى بدون إنترنت
const PRECACHE_URLS = ["/offline", "/logo.png", "/manifest.json", "/icons/icon-192x192.png"];

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
  // تخزين صفحة عدم الاتصال وأصولها مسبقاً (كل ملف على حدة حتى لا يفشل التثبيت)
  e.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: "reload" })))),
    ).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (e) => {
  // حذف نسخ الكاش القديمة
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("maestro-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// اعتراض الطلبات: تنقّل → الشبكة أولاً ثم صفحة عدم الاتصال | ملفات ثابتة → الكاش أولاً
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // طلبات الـAPI تبقى على الشبكة فقط (التطبيق يعالج أخطاءها بنفسه)
  if (url.pathname.startsWith("/api/")) return;

  // صفحات التنقل: جرّب الشبكة، وعند الانقطاع اعرض صفحة الـOffline المخزّنة
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match("/offline");
        if (cached) return cached;
        return new Response("غير متصل بالإنترنت", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  // الأصول الثابتة من نفس النطاق (صور/خطوط/سكربتات): الكاش أولاً مع التحديث في الخلفية
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
