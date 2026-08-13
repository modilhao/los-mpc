/* Bumpar VERSION a cada release que o iPad precisa ver. */
const VERSION = 'v0.2.6';
const CACHE = 'cabacitos-mpc-' + VERSION;
const FILES = [
  './', './index.html', './manifest.json', './icon.svg',
  './css/app.css',
  './js/main.js', './js/ui.js', './js/audio.js',
  './js/sampler.js', './js/store.js', './js/tap-worklet.js',
];

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

/* Rede primeiro: o cache-first antigo deixava o iPad (e o Mac) preso na
   versão anterior mesmo depois do deploy. Offline ainda cai no cache. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
