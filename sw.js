/* Questrix Service Worker — v6 (forces cache clear of all previous versions) */
const CACHE = 'questrix-v6';
const ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

// Install: only cache static assets, NOT index.html
// index.html must always come fresh from network so auth fixes load
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

// Activate: delete ALL old caches immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for HTML/JS, cache fallback for assets only
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // Always fetch index.html fresh from network — never serve from cache
  if (url.endsWith('/') || url.includes('index.html') || url.includes('.js') || url.includes('.css')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // For images/icons: cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
