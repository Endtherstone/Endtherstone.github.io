// This project no longer uses a Service Worker by default.
// If an older SW is still controlling the site, this file helps it self-remove.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  // Network pass-through.
  event.respondWith(fetch(event.request));
});
