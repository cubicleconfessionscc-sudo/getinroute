const SHELL = ['/admin', '/admin/index.html', '/manifest.webmanifest', '/icon.svg'];
const VERSION = 'getinroute-v3';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/admin/index.html', copy));
          return res;
        })
        .catch(() =>
          caches.match('/admin/index.html').then((hit) => {
            return hit || fetch(request);
          })
        )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(request, copy));
      return res;
    })));
    return;
  }

  e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});