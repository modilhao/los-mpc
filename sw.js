/* Bumpar VERSION a cada release que o iPad precisa ver. */
const VERSION = 'v1.0.0';
const CACHE = 'cabacitos-kit-' + VERSION;
const FILES = ['./', './index.html', './manifest.json', './icon.svg', './STACK.md'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
