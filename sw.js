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

const VERSION = 'anilog-v101';
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
  './assets/icons/icon.svg',
  './assets/icons/icon-76.png',
  './assets/icons/icon-120.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-167.png',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// The files the app cannot run without. If any of these can't be fetched, the
// install must FAIL rather than activate — see below.
const CRITICAL = SHELL.slice(0, 10);   // './' through './manifest.json'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // `cache: 'reload'` forces each request past the browser's HTTP cache.
    // Plain addAll() is allowed to satisfy these from the HTTP cache, which
    // on GitHub Pages (10-min max-age) can hand the new SW version the exact
    // stale files it was created to replace — a new cache name holding old
    // bytes, so the deploy silently doesn't take.
    const store = async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      await cache.put(url, res);
    };

    // Icons and other extras may fail without consequence.
    const optional = SHELL.filter((u) => !CRITICAL.includes(u));
    await Promise.all(optional.map((u) => store(u).catch(() => null)));

    // The shell itself may not. Every failure here used to be swallowed, and
    // because install is followed immediately by skipWaiting() and an activate
    // that deletes the previous cache, one bad moment on mobile data could
    // retire a working worker in favour of one holding a half-built shell —
    // and if index.html was the file that missed, the navigation handler has
    // nothing to serve at all. Throwing fails the install instead, which
    // leaves the existing worker in charge and simply retries on the next
    // update check. A version that can't be fully fetched is not one to
    // switch to.
    await Promise.all(CRITICAL.map(store));
  })());
  // Activate as soon as this installs. v4.49 tried holding back so the page
  // could offer a choice first, and that created a trap: any client running
  // older code had no way to release the waiting worker, so it sat there
  // forever while the app reported an update it could never apply. Deciding
  // WHEN to reload is the page's job (see index.html) — the worker taking
  // over is not the disruptive part, the navigation is.
  self.skipWaiting();
});

// Defensive: if a worker ever does end up waiting, the page can release it
// rather than being stuck again.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'anilog-skip-waiting') self.skipWaiting();
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
    icon: payload.icon || './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    // Same tag collapses repeats of the same event instead of stacking
    // duplicates if the sender retries. renotify makes a replacement alert
    // again rather than swapping in silently — without it, a repeat of a tag
    // already on screen updates the text and nothing else.
    tag: payload.tag || 'anilog',
    renotify: true,
    // Android decides heads-up display from the channel's importance, which
    // this cannot override. It does control the buzz.
    vibrate: [80, 40, 80],
    data: {
      url: payload.url || './',
      mediaId: payload.mediaId || null,
      activityId: payload.activityId || null,
      userId: payload.userId || null,
      userName: payload.userName || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Chrome rotates or drops a push subscription on its own — after a long idle
// period, a permissions change, or storage pressure. When it does, this fires
// and the old endpoint stops working: the sender keeps posting to a dead URL
// and gets 410 back, which looks from the phone like push simply stopped.
//
// Re-subscribing here restores a working endpoint immediately, but it CANNOT
// finish the job: the sender reads the endpoint from a GitHub secret, and
// nothing in the browser can write that. So the page is told, and it nags
// until the new code has been copied across. A silent half-fix would be worse
// than the failure — at least a dead endpoint is eventually noticed.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let endpoint = null;
    try {
      // oldSubscription carries the key we were registered with; falling back
      // to the event's newSubscription covers browsers that resubscribe for us.
      const key = event.oldSubscription?.options?.applicationServerKey;
      const fresh = event.newSubscription || (key && await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
      endpoint = fresh?.endpoint || null;
    } catch (e) { /* re-subscribe refused; the page still needs telling */ }

    // Survives a closed app: the page reads this on next open.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'anilog-push-resubscribed', endpoint }));

    // Nothing open to tell, and this is exactly the case where the user would
    // otherwise never find out.
    if (!clients.length) {
      await self.registration.showNotification('AniLog push needs re-linking', {
        body: 'Tap to copy a new code for the PUSH_SUBSCRIPTION secret.',
        icon: './assets/icons/icon-192.png',
        badge: './assets/icons/icon-192.png',
        tag: 'push-relink',
        data: { url: './', relink: true },
      });
    }
  })());
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
          activityId: data.activityId || null,
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
