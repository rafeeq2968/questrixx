// Questrix Service Worker v1.0
// Enables offline mode + PWA installability

const CACHE = 'questrix-v1';

// Files to cache for offline use
const OFFLINE_FILES = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Cabinet+Grotesk:wght@400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// INSTALL — cache core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache what we can, ignore failures for external resources
      return Promise.allSettled(
        OFFLINE_FILES.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ACTIVATE — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH — cache-first for app shell, network-first for API calls
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept AI API calls — always go to network
  if (
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('groq.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  ) {
    // Network first, fall back to cache for static assets
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache CDN resources
          if (response.ok && url.hostname.includes('cdnjs')) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first for app shell (HTML, local files)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback — return cached index.html
      return caches.match('/index.html') || caches.match('/');
    })
  );
});

// Handle push notifications (for future use)
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Questrix', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png'
  });
});
