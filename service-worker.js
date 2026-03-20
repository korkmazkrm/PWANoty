const CACHE_NAME = 'pwa-noty-v19';
// Uygulama kök veya alt dizinde olsun, SW scope'una göre asset'leri önbelleğe al
const ASSET_PATHS = ['', 'index.html', 'manifest.json', 'noty.css', 'noty.js', 'db.js', 'opfs.js'];

function getBaseUrl() {
  const swUrl = self.location.href;
  return swUrl.slice(0, swUrl.lastIndexOf('/') + 1);
}

self.addEventListener('install', (event) => {
  const base = getBaseUrl();
  const urls = ASSET_PATHS.map((p) => base + p);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urls))
  );
  globalThis.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  globalThis.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
