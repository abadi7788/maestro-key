// maestro-sw-v6
let after = 0;
let timer = null;

var OFFLINE_URL = "/offline.html";
var PRECACHE_URLS = [OFFLINE_URL, "/icons/icon-192x192.png", "/icons/icon-512x512.png", "/icons/badge-72x72.png", "/logo.png"];

// ---------- Precache the offline page + key assets on install ----------
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open("mk-offline-v1").then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function () {});
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== "mk-offline-v1"; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// ---------- Fetch handler: Network-first for pages, fallback to offline ----------
self.addEventListener("fetch", function (event) {
  var req = event.request;

  // Navigation requests (page loads) → network first, offline fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        // cache a fresh copy of same-origin pages for offline resilience
        try {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            var copy = res.clone();
            caches.open("mk-offline-v1").then(function (c) { c.put(req, copy); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      }).catch(function () {
        // Offline → serve cached page if available, else the offline page
        return caches.match(req).then(function (cached) {
          return cached || caches.match(OFFLINE_URL);
        });
      })
    );
    return;
  }

  // Same-origin GET assets → cache-first (fast + works offline)
  if (req.method === "GET" && new URL(req.url).origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open("mk-offline-v1").then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        }).catch(function () {
          return caches.match(OFFLINE_URL);
        });
      })
    );
  }
});

// ---------- Alerts polling (only when no window is open) ----------
async function poll() {
  var open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (open.length) return;
  try {
    var res = await fetch("/api/alerts?after=" + after, { credentials: "include", cache: "no-store" });
    if (!res.ok) return;
    var data = await res.json();
    for (var i = 0; i < (data.alerts || []).length; i++) {
      var a = data.alerts[i];
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
  } catch (e) {}
}

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "watch") {
    after = Number(e.data.after || after || 0);
    if (!timer) timer = setInterval(poll, 8000);
    poll();
  }
});

// ---------- Web Push notifications ----------
self.addEventListener("push", function (event) {
  var data = { title: "مايسترو كي", body: "إشعار جديد", href: "/inbox", tag: "mk" };
  try { data = Object.assign({}, data, event.data ? event.data.json() : {}); } catch (e) {}
  event.waitUntil(self.registration.showNotification("مايسترو كي", {
    body: (data.title ? data.title + " — " : "") + (data.body || "إشعار جديد"),
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: "maestro-key",
    silent: false,
    data: { href: data.href || "/inbox" },
  }));
});

// ---------- Clear badge when a notification is opened ----------
async function clearAll() {
  var all = await self.registration.getNotifications();
  all.forEach(function (n) { n.close(); });
  var list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach(function (c) { c.postMessage({ type: "clear-badge" }); });
}
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var href = (e.notification.data && e.notification.data.href) || "/inbox";
  e.waitUntil((async function () {
    await clearAll();
    var list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < list.length; i++) {
      if ("focus" in list[i]) { await list[i].focus(); return; }
    }
    await self.clients.openWindow(href);
  })());
});
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "clear-now") e.waitUntil(clearAll());
});
