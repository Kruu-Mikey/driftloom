// Offline cache. The whole app is a few kilobytes of text, so it is
// cached whole on install and served from cache first. Bump CACHE when
// you change any file, or the browser will keep serving the old one.
const CACHE = 'driftloom-v19';
const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/ui.js',
  './js/clock.js',
  './js/characters.js',
  './js/media.js',
  './js/share.js',
  './js/cover.js',
  './audio/keepalive.flac',
  './audio/keepalive.wav',
  './js/engine.js',
  './js/synth.js',
  './js/generator.js',
  './js/theory.js',
  './js/rng.js',
  './js/midi.js',
  './js/storage.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Keep the offline copy current on the way past.
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
