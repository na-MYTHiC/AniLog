// AniLog service worker — minimal app-shell cache.
//
// Strategy:
//   - On install, pre-cache the static app shell (HTML, CSS, JS, icon).
//   - For navigations (HTML), prefer network so the user always gets the
//     freshest build, falling back to the cached shell when offline.
//   - For other same-origin assets (CSS / JS / icon), serve from cache
//     first for instant loads, then fetch in the background.
//   - For everything else (AniList GraphQL, AniList images), bypass —
//     we don't want stale data or 1+ GB of cover-image storage.

const VERSION = 'anilog-v26';
const SHELL = [
  './',
  './index.html',
  './styles/base.css',
  './styles/app.css',
  './scripts/config.js',
  './scripts/state.js',
  './scripts/api.js',
  './scripts/render.js',
  './scripts/app.js',
  './manifest.json',
  './icon.svg',
  './icon-76.png',
  './icon-120.png',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Wipe old caches when we deploy a new VERSION
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs here — AniList API + images go to network.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin assets: cache-first, then network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
