// PokéSpread Service Worker v7
const CACHE_NAME = 'pokespread-cache-v7';
const IMAGE_CACHE_NAME = 'pokespread-images-v7';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './prices.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

// Install: precache application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== IMAGE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Bypass SW cache on localhost and 127.0.0.1 for instant development feedback
  if (self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost') {
    event.respondWith(fetch(req));
    return;
  }

  // 1. External Card Images (TCGdex, Wikimedia, PokéTCG): Cache-first with runtime caching
  if (
    url.hostname.includes('tcgdex.net') && (url.pathname.endsWith('.webp') || url.pathname.endsWith('.png') || url.pathname.includes('/logo') || url.pathname.includes('/symbol')) ||
    url.hostname.includes('pokemontcg.io') ||
    url.hostname.includes('wikimedia.org')
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(req, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => cachedResponse);
        });
      })
    );
    return;
  }

  // 2. TCGdex API & Exchange Rate API: Network-first, fallback to cache
  if (url.hostname.includes('api.tcgdex.net') || url.hostname.includes('open.er-api.com')) {
    event.respondWith(
      fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkResponse;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 3. Static App Shell (index.html, styles.css, app.js, icons): Cache-first, network fallback
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache (Stale-While-Revalidate for app assets)
        fetch(req).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResponse));
          }
        }).catch(() => {/* offline */});
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkResponse;
      });
    }).catch(() => {
      // Offline fallback for navigation requests
      if (req.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
