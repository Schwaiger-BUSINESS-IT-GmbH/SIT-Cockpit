// Service Worker (SIT-Time im Cockpit): App-Shell offline verfügbar, API immer live.
const CACHE = 'sit-cockpit-zeiten-v1';
const B = '/zeiten/';
const SHELL = [B, B + 'index.html', B + 'styles.css', B + 'app.js', B + 'manifest.webmanifest', B + 'icons/icon-192.png', B + 'img/logo-light.png', B + 'img/logo-dark.png', B + 'fonts/oswald-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(B)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(B + 'index.html')))
  );
});
