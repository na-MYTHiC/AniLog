// AniLog service worker — minimal app-shell cache.
//
// Strategy:
//   - On install, pre-cache the static app shell (HTML, CSS, JS, icon).
//   - For navigations (HTML), serve the cached shell immediately and refresh
//     it in the background. Network-first cost a full round-trip on EVERY
//     launch — the one thing standing between the user and an otherwise
//     entirely cache-served startup. It also handed back new HTML while the
//     CSS/JS below still came from the old cache, so the page ran mismatched
//     until the update reload landed; serving both from the same cache is
//     self-consistent, and the controllerchange reload in index.html still
//     swaps everything over atomically once a new version activates.
//   - For other same-origin assets (CSS / JS / icon), serve from cache
//     first for instant loads, then fetch in the background.
//   - For everything else (AniList GraphQL, AniList images), bypass —
//     we don't want stale data or 1+ GB of cover-image storage.

const VERSION = 'anilog-v63';
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
    caches.open(VERSION).then((cache) =>
      // `cache: 'reload'` forces each request past the browser's HTTP cache.
      // Plain addAll() is allowed to satisfy these from the HTTP cache, which
      // on GitHub Pages (10-min max-age) can hand the new SW version the exact
      // stale files it was created to replace — a new cache name holding old
      // bytes, so the deploy silently doesn't take.
      Promise.all(SHELL.map((url) =>
        fetch(new Request(url, { cache: 'reload' }))
          .then((res) => (res.ok ? cache.put(url, res) : null))
          .catch(() => null)   // one 404 shouldn't abort the whole install
      ))
    )
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

// ============ WEB PUSH ============
// Delivered by the scheduled sender in .github/workflows/anilog-push.yml.
// This fires even when the app is closed, which is the whole point — the
// in-app poll in app.js only runs while a tab is open.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Not JSON — fall back to treating the whole body as the message.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'AniLog';
  const options = {
    body: payload.body || '',
    icon: payload.icon || './icon-192.png',
    badge: './icon-192.png',
    // Same tag collapses repeats of the same event instead of stacking
    // duplicates if the sender retries.
    tag: payload.tag || 'anilog',
    data: {
      url: payload.url || './',
      mediaId: payload.mediaId || null,
      userId: payload.userId || null,
      userName: payload.userName || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing a window that's already open — launching a second copy
    // of an installed PWA is jarring and loses whatever state was there.
    const data = event.notification.data || {};
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        // Tell the page what to open, rather than navigating (which would
        // throw away the loaded app). Sent even with no target — the page
        // ignores a message it can't act on.
        client.postMessage({
          type: 'anilog-open',
          mediaId: data.mediaId || null,
          userId: data.userId || null,
          userName: data.userName || null,
        });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs here — AniList API + images go to network.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // HTML navigations: cache-first, revalidate in the background
  if (req.mode === 'navigate') {
    const networkUpdate = fetch(req).then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(VERSION);
        await cache.put('./index.html', res.clone());
      }
      return res;
    });

    // Registered synchronously, before any await. Calling waitUntil() after
    // the handler has yielded can throw once the event is no longer active.
    event.waitUntil(networkUpdate.catch(() => {}));

    event.respondWith((async () => {
      // Scoped to VERSION rather than a bare caches.match(), which searches
      // every cache and could hand back the previous build's shell while the
      // old cache is still being deleted.
      const cache = await caches.open(VERSION);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      // Nothing cached yet — first ever visit, or install didn't finish.
      try {
        return await networkUpdate;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  // Same-origin assets: cache-first, then network. Scoped to VERSION for the
  // same reason as the shell above — an unscoped match can serve a previous
  // build's CSS/JS out of a cache that activate() hasn't finished deleting.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  })());
});
