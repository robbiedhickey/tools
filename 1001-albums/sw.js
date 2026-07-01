const STATIC_CACHE = '1001-albums-static-v1';
const API_PREFIX = '/1001-albums/api/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
      ),
    ])
  );
});

// Network-first for HTML navigations: the document's importmap must never lag behind
// the JS modules it resolves for (e.g. a stale cached index.html missing a bare
// specifier that a freshly-fetched component already imports). Falls back to cache
// only when offline.
//
// Stale-while-revalidate for other same-origin static assets (JS/CSS/images/manifest).
// Never touches cross-origin requests (esm.sh, the 1001albumsgenerator.com API) or
// same-origin API routes under /1001-albums/api/ — those carry live, per-user data.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(API_PREFIX)) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return cache.match(req);
        }
      })
    );
    return;
  }

  e.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (e) => {
  const payload = e.data ? e.data.json() : {};
  const title = payload.title || '1001 Albums Kongsole';
  const options = {
    body: payload.body || '',
    icon: '/1001-albums/icon-192.png',
    badge: '/1001-albums/icon-192.png',
    data: payload.data || {},
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/1001-albums/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/1001-albums/') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
