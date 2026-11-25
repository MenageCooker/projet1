// PokéSpread Service Worker v13 — Network-First Production Strategy
const CACHE_NAME = 'pokespread-cache-v13';
const IMAGE_CACHE_NAME = 'pokespread-images-v13';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/species_fr.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

const APP_SHELL_FILES = [
  'index.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon.svg'
];

// Helper: Network-First with cache fallback
function networkFirstWithCacheFallback(req, cacheName) {
  return fetch(req)
    .then(networkResp => {
      if (networkResp && networkResp.status === 200) {
        const clone = networkResp.clone();
        caches.open(cacheName).then(cache => cache.put(req, clone));
      }
      return networkResp;
    })
    .catch(() => {
      return caches.match(req).then(cached => {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return undefined;
      });
    });
}

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate Event: Purge old cache generations
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== IMAGE_CACHE_NAME) {
            console.log('Clearing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Only handle GET requests
  if (req.method !== 'GET') return;

  // 2. Bypass SW on localhost for instant development feedback
  if (self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost') {
    event.respondWith(fetch(req));
    return;
  }

  // 3. Live Prices Data (prices.json): Strictly Network-First
  if (url.pathname.endsWith('prices.json') || url.pathname.includes('prices.json')) {
    event.respondWith(networkFirstWithCacheFallback(req, CACHE_NAME));
    return;
  }

  // 4. App Shell (index.html, app.js, styles.css): Strictly Network-First
  const isAppShell =
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    APP_SHELL_FILES.some(f => url.pathname.endsWith(f));

  if (isAppShell) {
    event.respondWith(networkFirstWithCacheFallback(req, CACHE_NAME));
    return;
  }

  // 5. Card Images: Cache-First runtime caching
  if (
    url.hostname.includes('tcgdex.net') ||
    url.hostname.includes('pokemontcg.io') ||
    url.hostname.includes('wikimedia.org') ||
    url.hostname.includes('pricecharting.com')
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

  // 6. External APIs (TCGdex catalog, Exchange Rates): Network-First
  if (url.hostname.includes('api.tcgdex.net') || url.hostname.includes('open.er-api.com')) {
    event.respondWith(networkFirstWithCacheFallback(req, CACHE_NAME));
    return;
  }

  // 7. General fallback
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      });
    }).catch(() => {
      if (req.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
