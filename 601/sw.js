const CACHE_VERSION = "ebook-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

// Cache-first for app shell. For PDF and pdf.js CDN, we do runtime caching to avoid
// forcing a huge download during install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(APP_SHELL);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const SHELL_PATHS = new Set([
  `${scopePath}/`,
  `${scopePath}/index.html`,
  `${scopePath}/app.css`,
  `${scopePath}/app.js`,
  `${scopePath}/manifest.webmanifest`,
  `${scopePath}/assets/icon.svg`,
]);

const INDEX_URL = new URL("./index.html", self.registration.scope).toString();

function isPdfJsCdn(url) {
  return url.hostname === "cdnjs.cloudflare.com" && url.pathname.includes("/ajax/libs/pdf.js/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // SPA navigation: serve cached index.html so `?page=...` works offline too.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(INDEX_URL);
        try {
          const res = await fetch(req);
          return res;
        } catch {
          return hit || Response.error();
        }
      })()
    );
    return;
  }

  // App shell assets: cache first
  if (sameOrigin && SHELL_PATHS.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      })()
    );
    return;
  }

  // Runtime cache for the PDF itself and pdf.js CDN files.
  if (sameOrigin || isPdfJsCdn(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(req, { ignoreSearch: false });
        if (hit) return hit;
        try {
          const res = await fetch(req);
          // Only cache successful basic/cors responses.
          if (res && (res.type === "basic" || res.type === "cors") && res.status === 200) {
            cache.put(req, res.clone());
          }
          return res;
        } catch (e) {
          if (hit) return hit;
          throw e;
        }
      })()
    );
  }
});
