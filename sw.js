const CACHE = "cpnp-ventanilla-v3";
const APP_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => { if (response.ok && new URL(event.request.url).origin === self.location.origin) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./"))));
});
self.addEventListener("push", (event) => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text() || "Tiene una alerta pendiente." }; }
  event.waitUntil(self.registration.showNotification(data.title || "CPNP Ventanilla", { body: data.body || "Tiene una sanción pendiente de revisión.", icon: "icon.svg", badge: "icon.svg", tag: data.tag || "sancion-pendiente", renotify: true, data: { url: data.url || "./" } }));
});
