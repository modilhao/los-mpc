/* Bumpar VERSION a cada release que o iPad precisa ver. */
const VERSION = 'v0.2.0';
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

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
