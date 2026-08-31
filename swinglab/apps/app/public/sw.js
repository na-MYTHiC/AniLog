/*
 * App-shell cache. Deliberately tiny: the app does no network calls at all
 * once loaded, because every calculation runs locally, so offline support is
 * just a matter of keeping the shell around.
 */
const CACHE = 'swinglab-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add('./')));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            return response;
          })
          .catch(() => caches.match('./')),
    ),
  );
});
