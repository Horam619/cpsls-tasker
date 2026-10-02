// CPSLS Tasker service worker: offline app shell and push reminders.
const CACHE = "cpsls-v1";
const SHELL = ["./", "index.html", "app.js?v=1", "manifest.webmanifest",
  "fonts/Archivo-var.ttf", "fonts/IBMPlexMono-Regular.ttf", "fonts/IBMPlexMono-Medium.ttf",
  "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Own files: network first, cache as fallback. Everything else (Firebase, Gemini) goes straight to the network.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "CPSLS Tasker", {
    body: data.body || "Du hast offene Aufgaben.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "cpsls-reminder",
    renotify: true,
    data: { url: data.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); return; } }
    return self.clients.openWindow(target);
  }));
});
