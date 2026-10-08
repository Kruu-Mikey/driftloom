// Offline cache. The whole app is a few hundred kilobytes of text (about
// 130 KB gzipped), so it is cached whole on install -- but served *network
// first*, with the cache as the fallback when the network is gone. That
// ordering is deliberate: it is what lets a deployed change show up on the
// next cold start instead of waiting for a cache bump.
//
// CACHE is also the build stamp shown in Diagnostics. Bump it on every
// change, together with BUILD in js/main.js, so you can tell at a glance
// which deploy you are listening to. Bumping it also evicts files that
// have been deleted from FILES, which the network-first path cannot do.
const CACHE = 'driftloom-v69';
// './index.html' is deliberately absent. Cloudflare redirects it to './'
// with a 307, and the Cache API will not store a redirected response --
// addAll is atomic, so that one entry failing takes the whole install with
// it and leaves the app with no offline mode at all. './' serves the same
// document.
const FILES = [
  './',
  './css/style.css',
  './js/main.js',
  './js/ui.js',
  './js/clock.js',
  './js/characters.js',
  './js/media.js',
  './js/share.js',
  './js/cover.js',
  // Only the FLAC: it is the one every current browser plays, so it is the
  // one the media element picks, and precaching the WAV beside it cost 240
  // KB of a first visit for a file that never played. The WAV stays in the
  // element as a fallback, from the network.
  './audio/keepalive.flac',
  './js/engine.js',
  './js/synth.js',
  './js/generator.js',
  './js/theory.js',
  './js/moods.js',
  './js/rng.js',
  './js/midi.js',
  './js/storage.js',
  // The Rust core (`?engine=rust`), so the flag works offline too.
  './js/core.js',
  './js/worklet.js',
  './js/dlcore.wasm',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
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
