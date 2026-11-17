/* Man of the House service worker: works offline, always prefers fresh files when online. */
const VERSION = "v14";
const CACHE = "moth-" + VERSION;
const SHELL = [
  "./", "index.html", "privacy.html", "styles.css", "styles-views.css", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "src/main.js", "src/ui.js", "src/sync.js", "src/storage.js", "src/logic.js", "src/dom.js",
  "src/templates.js", "src/wizard.js", "src/calendar.js", "src/ics.js", "src/quickadd.js",
  "src/quickform.js", "src/importcsv.js", "src/costs.js", "src/photos.js", "src/readiness.js",
  "src/recap.js", "src/insights.js", "src/pwa.js", "src/push.js", "src/errors.js", "src/invite.js", "src/version.js", "src/help.js", "src/howto.js", "src/household.js", "src/auth.js", "src/supabase.js", "config.js",
  "src/views/shared.js", "src/views/help.js", "src/views/today.js", "src/views/calendar.js", "src/views/hubs.js",
  "src/views/inventory.js", "src/views/vehicles.js", "src/views/vendors.js", "src/views/people.js",
  "src/views/emergency.js", "src/views/history.js", "src/views/insights.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("moth-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* plain-text or empty push */ }
  e.waitUntil(self.registration.showNotification(d.title || "Man of the House", {
    body: d.body || "Something needs doing around the house.",
    icon: "icons/icon-192.png", badge: "icons/favicon-32.png", tag: "moth-daily", data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
