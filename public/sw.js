// maestro-sw-v10
const STATIC_CACHE = "maestro-static-v10";
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/offline",
  "/logo.png",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/badge-72x72.png"
];

let after = 0;

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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;

        const offlineFallback = await cache.match(OFFLINE_URL) || await cache.match("/offline") || await cache.match("/offline.html");
        if (offlineFallback) return offlineFallback;

        return new Response(
          `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تعذر الاتصال — مايسترو كي</title><style>body{background:#070b14;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;box-sizing:border-box}h2{font-size:22px;margin:0 0 8px;font-weight:900}p{color:#94a3b8;font-size:14px;margin:0 0 24px;line-height:1.6}button{background:#2f7bff;color:#fff;border:none;padding:12px 28px;border-radius:14px;font-size:15px;font-weight:bold;cursor:pointer;box-shadow:0 8px 20px rgba(47,123,255,.3)}</style></head><body><h2>تعذر تحميل الصفحة مؤقتاً</h2><p>يرجى التحقق من اتصال الشبكة ثم إعادة المحاولة.</p><button onclick="location.reload()">إعادة المحاولة</button></body></html>`,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }
        );
      }),
    );
    return;
  }

  if (
    url.origin === self.location.origin &&
    ["image", "style", "script", "font"].includes(req.destination)
  ) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || network;
      }),
    );
  }
});

// استلام الإشعارات في الخلفية حتى عندما يكون التطبيق أو المتصفح مغلقاً
self.addEventListener("push", (event) => {
  let data = {
    title: "مايسترو كي",
    body: "لديك إشعار جديد في النظام",
    href: "/inbox",
    tag: "mk-" + Date.now(),
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      try {
        data.body = event.data.text();
      } catch {}
    }
  }

  const notificationTitle = data.title || "مايسترو كي";
  const notificationOptions = {
    body: data.body || "لديك إشعار جديد",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: data.tag || "maestro-key-alert",
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: {
      href: data.href || "/inbox",
      dateOfArrival: Date.now(),
    },
    actions: [
      { action: "open", title: "عرض الإشعار" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});

// فتح التطبيق وتوجيهه إلى الرابط المطلوب عند النقر على الإشعار
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetPath = event.notification.data?.href || "/inbox";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      // إخفاء الشارة أو تنبيه النوافذ المفتوحة
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // إذا كان هناك تبويب أو نافذة مفتوحة للتطبيق، ركّز عليها وانتقل للرابط
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          return await client.focus();
        }
      }

      // إذا كان التطبيق مغلقاً تماماً، افتح نافذة جديدة بالرابط المطلوب
      if (self.clients.openWindow) {
        return await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

async function clearAll() {
  const all = await self.registration.getNotifications();
  all.forEach((n) => n.close());
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: "clear-badge" }));
}

self.addEventListener("message", (e) => {
  if (e.data?.type === "watch") {
    after = Number(e.data.after || after || 0);
  }
  if (e.data?.type === "clear-now") {
    e.waitUntil(clearAll());
  }
});
