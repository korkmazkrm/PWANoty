// Her dağıtımda veya precache listesini değiştirince +1 yapın; eski önbellek temizlenir.
const CACHE_NAME = 'pwa-noty-v23';
// Uygulama kök veya alt dizinde olsun, SW scope'una göre asset'leri önbelleğe al (ilk kurulum / çevrimdışı)
const ASSET_PATHS = [
  '',
  'index.html',
  'manifest.json',
  'noty.css',
  'noty.js',
  'noty-dom.js',
  'noty-utils.js',
  'noty-theme.js',
  'noty-lightbox.js',
  'noty-sheet.js',
  'noty-maintenance.js',
  'noty-files.js',
  'alarms.js',
  'db.js',
  'opfs.js'
];

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
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/**
 * Çevrimiçiyken her zaman ağı dene; böylece HTML/JS/CSS güncellemeleri iOS PWA'da da görünür.
 * Çevrimdışı veya ağ hatasında önbellekten servis et.
 * Başarılı ağ yanıtı aynı önbelleği günceller (sonraki çevrimdışı açılış daha güncel olur).
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
