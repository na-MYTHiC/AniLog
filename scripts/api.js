// AniLog — AniList GraphQL client and auth helpers.
// All network IO routes through `anilist()`. Designed to survive a flaky
// connection: timeouts, retries with backoff, in-flight de-duplication,
// rate-limit handling, and stale-cache fallback when nothing else works.

// How long a cached response is considered fresh (network skipped). After
// this we still keep the entry — if the network later fails, we'll serve
// the stale copy rather than nothing. Stale-while-revalidate below means a
// long TTL still shows the latest data on the NEXT paint (background
// refresh fires as soon as the user opens the app), so we err on the long
// side to keep the UI snappy.
const CACHE_TTL_MS = 15 * 60 * 1000;
// Hard request timeout — AniList sometimes just hangs. Per attempt, and the
// first one is shorter: three 12s attempts plus backoff meant a dead
// connection showed nothing for 42 seconds, which reads as the app being
// broken rather than the network being down. A short first attempt catches
// the common "this one request is wedged" case quickly, and the later, longer
// ones still give a genuinely slow AniList room to answer.
const REQUEST_TIMEOUTS_MS = [7000, 10000, 12000];
// Per-key fresh-until timestamps. cache[key] stays raw data so existing
// consumers that read `cache[key]` directly aren't broken.
const cacheExpires = new Map();
// query+vars key -> in-flight Promise, so two simultaneous calls share one fetch
const inflight = new Map();

// ============ PERSISTENT CACHE ============
// Survives PWA cold-starts so the user sees content instantly the next time
// they open the app. Capped so we never run out of localStorage quota.
const PERSIST_KEY = 'anilog-cache-v1';
const PERSIST_CAP = 120; // most recently used keys are persisted

// Pull what we cached last session into memory at boot
(function hydrateCache() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    Object.keys(parsed).forEach((k) => {
      const entry = parsed[k];
      if (!entry || entry.data === undefined) return;
      cache[k] = entry.data;
      cacheExpires.set(k, entry.exp || 0);
    });
  } catch (e) { /* corrupt cache — ignore, will rebuild */ }
})();

// Debounced write of the in-memory cache to localStorage. We don't write on
// every successful fetch (that'd thrash the disk) — instead schedule a
// single write 1s after the last update, capped to PERSIST_CAP most recent
// entries by expiry time.
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const keys = Object.keys(cache);
    // Sort by expiry desc (most recently set first), keep top PERSIST_CAP
    keys.sort((a, b) => (cacheExpires.get(b) || 0) - (cacheExpires.get(a) || 0));
    let budget = Math.min(keys.length, PERSIST_CAP);

    // Shrink and retry rather than giving up on the first quota error. Detail
    // responses are large (full synopsis + relations + recommendations), so a
    // handful of them can push a PERSIST_CAP-sized write past the ~5MB quota.
    // The old code dropped the ENTIRE persistent cache in that case, so the
    // next cold start had nothing to show instantly — a cliff, when halving
    // the budget would have kept most of the benefit.
    while (budget > 0) {
      try {
        const slim = {};
        for (let i = 0; i < budget; i++) {
          const k = keys[i];
          slim[k] = { data: cache[k], exp: cacheExpires.get(k) || 0 };
        }
        localStorage.setItem(PERSIST_KEY, JSON.stringify(slim));
        return;
      } catch (e) {
        budget = Math.floor(budget / 2);
      }
    }

    // Even one entry wouldn't fit (or localStorage is unavailable entirely) —
    // only now clear, so a stale oversized blob isn't left behind.
    try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
  }, 1000);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============ OFFLINE WRITE QUEUE ============
// Reads have worked offline for a while (persistent cache); writes did not —
// a failed mutation just reverted and the change was gone. Anything routed
// through mutateList() is instead persisted and replayed once we're back.
//
// This is only safe because every queued mutation is a SET, not a delta:
// SaveMediaListEntry(progress: 7) and DeleteMediaListEntry are both fine to
// replay even if the original actually landed. Non-idempotent mutations —
// ToggleLikeV2 especially, where a replay would flip the like back off —
// deliberately do NOT use this path.
const PENDING_KEY = 'anilog-pending-writes';
const PENDING_MAX = 50;
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let pendingWrites = [];
let flushing = false;

(function loadPendingWrites() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    const cutoff = Date.now() - PENDING_TTL_MS;
    pendingWrites = Array.isArray(raw) ? raw.filter((w) => w && w.ts > cutoff) : [];
  } catch (e) { pendingWrites = []; }
})();

function savePendingWrites() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pendingWrites));
  } catch (e) { /* quota — the in-memory queue still works this session */ }
}

function enqueueWrite(query, variables) {
  pendingWrites.push({ query, variables, ts: Date.now() });
  // Oldest-first eviction. Hitting this means something is badly wrong, but
  // an unbounded queue in localStorage would be worse.
  if (pendingWrites.length > PENDING_MAX) pendingWrites = pendingWrites.slice(-PENDING_MAX);
  savePendingWrites();
  updatePendingUI();
}

// Replays in order and stops at the first failure, so a later edit can never
// overwrite an earlier one that hasn't landed yet.
async function flushPendingWrites() {
  if (flushing || !pendingWrites.length || !state.accessToken) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  flushing = true;
  const startCount = pendingWrites.length;
  try {
    while (pendingWrites.length) {
      const next = pendingWrites[0];
      const data = await anilist(next.query, next.variables);
      if (!data) break;
      pendingWrites.shift();
      savePendingWrites();
    }
  } finally {
    flushing = false;
    updatePendingUI();
    const synced = startCount - pendingWrites.length;
    if (synced > 0 && typeof showToast === 'function') {
      showToast(`Synced ${synced} offline ${synced === 1 ? 'change' : 'changes'}`);
      if (typeof loadMyList === 'function' && state.user) loadMyList();
    }
  }
}

// Runs an idempotent list mutation, queueing it if the server can't be
// reached. Returns { data, queued } — a queued write should be treated as
// provisionally successful so the optimistic UI stands.
async function mutateList(query, variables) {
  // __-prefixed keys are ours, for the cache patch below — GraphQL would
  // reject an undeclared variable, so they never leave the client.
  const wire = {};
  Object.keys(variables || {}).forEach((k) => { if (!k.startsWith('__')) wire[k] = variables[k]; });
  const data = await anilist(query, wire);
  if (data) {
    // Fold the result back into every cached view of this media, and repaint
    // anything already on screen, so a list change shows up everywhere at
    // once instead of waiting for a tab to be rebuilt.
    const mediaId = variables?.mediaId;
    if (mediaId) {
      const saved = data.SaveMediaListEntry || null;
      patchCachedListEntry(mediaId, saved);
      if (typeof repaintListBadges === 'function') repaintListBadges(mediaId, saved);
    } else if (data.DeleteMediaListEntry?.deleted && variables?.__mediaId) {
      patchCachedListEntry(variables.__mediaId, null);
      if (typeof repaintListBadges === 'function') repaintListBadges(variables.__mediaId, null);
    }
    // Piggyback: a successful write proves we're online, so drain anything
    // that piled up earlier.
    if (pendingWrites.length) flushPendingWrites();
    return { data, queued: false };
  }
  enqueueWrite(query, wire);
  return { data: null, queued: true };
}

function updatePendingUI() {
  const el = document.getElementById('pending-writes');
  if (!el) return;
  const n = pendingWrites.length;
  el.hidden = n === 0;
  if (n > 0) el.textContent = `${n} offline ${n === 1 ? 'change' : 'changes'} pending`;
}

window.addEventListener('online', () => flushPendingWrites());

function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// ============ CONCURRENCY GATE ============
// Cold boot fired seven requests inside 300ms — Viewer, the list, the idle
// Seasonal preload and four speculative detail prefetches — all racing each
// other on one mobile connection. AniList also rate-limits per minute, and a
// 429 here costs a 1-10s sleep, so a burst can cost far more time than it
// saves.
//
// Two lanes. Normal requests are what the user is waiting for. Low-priority
// ones are speculative (prefetching a row they haven't tapped yet) and must
// never delay the others: only one runs at a time, and only once no normal
// request is queued behind it.
const MAX_CONCURRENT = 4;
const MAX_CONCURRENT_LOW = 1;
let _active = 0;
let _activeLow = 0;
const _queue = [];   // { resolve, low }

function _canStart(low) {
  if (_active >= MAX_CONCURRENT) return false;
  if (!low) return true;
  // Speculative work waits for a free lane AND for the queue to be clear of
  // anything the user is actually waiting on.
  return _activeLow < MAX_CONCURRENT_LOW && !_queue.some((w) => !w.low);
}

function _acquire(low) {
  if (_canStart(low)) {
    _active += 1;
    if (low) _activeLow += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => _queue.push({ resolve, low }));
}

function _release(low) {
  _active -= 1;
  if (low) _activeLow -= 1;
  // Normal requests jump speculative ones already waiting.
  let idx = _queue.findIndex((w) => !w.low);
  if (idx === -1) idx = _queue.findIndex((w) => _canStart(w.low));
  if (idx === -1) return;
  const [next] = _queue.splice(idx, 1);
  _active += 1;
  if (next.low) _activeLow += 1;
  next.resolve();
}


// What a successful write actually invalidates.
//
// This used to delete every cached read and drop the persistent cache
// outright. One swipe to bump an episode therefore made Search, Seasonal,
// genre and studio all cold again — measured at 320ms latency, revisiting
// Search after a bump cost 2 fresh round trips and Seasonal 1, where before
// the bump both were free. Bump a few episodes in a sitting, which is the
// single most common thing anyone does here, and the whole app reloads
// itself repeatedly.
//
// Only two things genuinely have to be refetched, and they're deleted so a
// reader blocks for the truth rather than rendering a value the user just
// changed:
//   - MediaListCollection, the list itself
//   - the detail query, which carries mediaListEntry { id status score progress }
// Serving either stale would flash the OLD progress and then correct itself,
// which reads as the edit failing.
//
// Everything else — browse rows, search results, seasonal, genre, studio —
// embeds only mediaListEntry { status }, which a progress bump doesn't touch.
// Those are marked stale instead: the next read returns instantly from cache
// and refreshes in the background, so the data still converges without the
// user waiting on anything.
function invalidateAfterWrite() {
  // Only the list itself has to be refetched — its membership really did
  // change, and it's the one view that must be authoritative.
  //
  // Everything else is PATCHED, not invalidated. Marking the rest stale (what
  // v4.86 did) had two bad consequences: the next read served the pre-write
  // value, so a freshly added show showed no badge until something re-rendered
  // it; and every cached key became due for a background refresh at once, so
  // browsing after a write could fire dozens of requests, saturate the
  // four-slot gate and trip AniList's rate limiter — which is what made the
  // whole app stop loading after adding something.
  Object.keys(cache).forEach((k) => {
    if (k.includes('MediaListCollection')) {
      delete cache[k];
      cacheExpires.delete(k);
    }
  });
  schedulePersist();
}

// Rewrite mediaListEntry on every cached copy of one media, so each view is
// already correct the next time it renders — no refetch, and nothing stale.
//
// `entry` is the mutation's own SaveMediaListEntry payload, or null when the
// entry was deleted.
function patchCachedListEntry(mediaId, entry) {
  if (!mediaId) return;
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    // A media node is the one that carries BOTH an id and a mediaListEntry
    // field. A MediaList row also has an `id`, but it's the entry's id and it
    // has no mediaListEntry of its own, so it can't be hit by accident.
    if (node.id === mediaId && Object.prototype.hasOwnProperty.call(node, 'mediaListEntry')) {
      node.mediaListEntry = entry ? { ...(node.mediaListEntry || {}), ...entry } : null;
    }
    Object.keys(node).forEach((k) => visit(node[k]));
  };
  Object.keys(cache).forEach((k) => visit(cache[k]));
  schedulePersist();
}

async function anilist(query, variables = {}, opts = {}) {
  // opts.priority === 'low' marks speculative work — see the gate above.
  const low = opts.priority === 'low';
  const isMutation = query.trim().startsWith('mutation');
  // Auth/pub split so we don't leak personal data across sign-in / sign-out
  const key = (state.accessToken ? 'auth:' : 'pub:') + query + JSON.stringify(variables);

  if (!isMutation) {
    const exp = cacheExpires.get(key) || 0;
    const hasCached = cache[key] !== undefined;

    // 1) Fresh cache hit — return immediately, no network at all
    if (hasCached && exp > Date.now()) return cache[key];

    // 2) Stale-while-revalidate: cache exists but TTL elapsed. Return it
    //    instantly so the UI is snappy, and kick a background refresh so the
    //    NEXT call serves fresher data.
    //
    //    The cached value is returned to EVERY caller, not just the one that
    //    starts the refresh. Previously a second caller arriving during that
    //    window fell through to the in-flight branch and waited on the
    //    network — so whether a view painted instantly or stalled for a round
    //    trip came down to which one happened to ask first.
    if (hasCached) {
      if (!inflight.has(key)) {
        const bg = runFetch().finally(() => inflight.delete(key));
        inflight.set(key, bg);
      }
      return cache[key];
    }

    // 3) Nothing cached and already in flight — share the promise so we don't
    //    stack duplicates.
    if (inflight.has(key)) return inflight.get(key);
  }

  const exec = runFetch();
  if (!isMutation) inflight.set(key, exec);
  try {
    return await exec;
  } finally {
    inflight.delete(key);
  }

  // Inner — does the actual network round-trip with retries and rate-limit
  // handling. Closed over key/query/variables/isMutation from the outer call.
  function runFetch() {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
    return _executeRequest(key, query, variables, headers, isMutation, low);
  }
}

async function _executeRequest(key, query, variables, headers, isMutation, low) {
  await _acquire(low);
  try {
    return await _runAttempts(key, query, variables, headers, isMutation);
  } finally {
    _release(low);
  }
}

async function _runAttempts(key, query, variables, headers, isMutation) {
  // navigator.onLine is a HINT, never a veto.
  //
  // v4.86 short-circuited on `onLine === false` and returned straight away.
  // The spec says false means definitely offline, but Chrome on Android gets
  // it wrong often enough — VPNs, captive portals, a network handover — and
  // when it does, that short-circuit made the app issue zero requests and
  // render nothing at all. Trading "nothing ever loads" for "a dead
  // connection is noticed 30s sooner" is a terrible deal, and it's the bug
  // that made the app stop loading.
  //
  // So still try. A browser claiming to be offline just doesn't get the full
  // retry ladder: one attempt, and the stale-cache fallback below catches it.
  const likelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const MAX_ATTEMPTS = likelyOffline ? 1 : 3;
  // Rate-limit waits are tracked separately from real failures. A 429 means
  // "you're early, come back" — not "this request is failing" — so burning a
  // retry on it meant a brief throttle could exhaust all three attempts and
  // surface as a permanent "Couldn't load." Capped so a sustained limit still
  // gives up rather than hanging forever.
  const MAX_RATE_LIMIT_WAITS = 4;
  let rateLimitWaits = 0;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(ANILIST, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      }, REQUEST_TIMEOUTS_MS[attempt - 1] || 12000);

      // Auth expired or revoked — bail out, don't retry
      if (res.status === 401) {
        signOut();
        return null;
      }

      // Rate limited — wait the requested time (capped at 10s), then retry
      // WITHOUT consuming an attempt.
      if (res.status === 429) {
        if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS) {
          lastErr = new Error('AniList 429: rate limited');
          break;
        }
        rateLimitWaits += 1;
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        await sleep(Math.min(Math.max(retryAfter, 1), 10) * 1000);
        attempt -= 1;
        continue;
      }

      // Server hiccup — exponential backoff and retry
      if (res.status >= 500) {
        lastErr = new Error(`AniList ${res.status}`);
        if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(2, attempt - 1));
        continue;
      }

      const json = await res.json().catch(() => null);
      if (!json) {
        lastErr = new Error('AniList: malformed JSON');
        if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(2, attempt - 1));
        continue;
      }

      // GraphQL-level errors don't have to fail the call — log and return
      // whatever data the server still sent.
      if (json.errors) console.warn('AniList GraphQL errors:', json.errors);

      if (!isMutation) {
        cache[key] = json.data;
        cacheExpires.set(key, Date.now() + CACHE_TTL_MS);
        schedulePersist();
      } else {
        invalidateAfterWrite();
      }
      return json.data;
    } catch (err) {
      // Network failure, timeout, or AbortError — retry with backoff
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(2, attempt - 1));
    }
  }

  // All attempts failed. Serve stale cache if we have one — better than blank.
  if (!isMutation && cache[key] !== undefined) {
    console.warn('AniList: serving stale cache after failure', lastErr);
    return cache[key];
  }
  console.error('AniList: request failed after retries', lastErr);
  return null;
}

// OAuth sign-in / sign-out
//
// Sign-in flow:
//   1. Open AniList's authorize URL in a POPUP (so main app stays loaded
//      and recoverable if AniList errors out).
//   2. When the popup redirects back to our origin with #access_token=…,
//      its early state.js code postMessages the token to us, then closes
//      itself.
//   3. We hear the postMessage, save the token, reload.
//
// If the popup closes WITHOUT posting a token (user cancelled, AniList
// showed its own JSON error page, etc.), we pop the sign-in modal with
// the manual paste panel pre-expanded so the user has an immediate
// fallback — no refresh needed.
//
// If popups are blocked, we fall back to the old "redirect the current
// tab" approach.
function signIn() {
  const popup = window.open(
    ANILIST_AUTH_URL,
    'anilog-oauth',
    'width=520,height=720,scrollbars=yes,resizable=yes'
  );

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    // Popup blocked — fall back to navigating the current tab
    try { localStorage.setItem('anilog-signin-started', String(Date.now())); } catch (e) {}
    window.location.href = ANILIST_AUTH_URL;
    return;
  }

  let gotToken = false;

  const onMessage = (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type !== 'anilog-oauth-token' || !e.data.token) return;
    gotToken = true;
    window.removeEventListener('message', onMessage);
    clearInterval(closedTimer);
    state.accessToken = e.data.token;
    savePrefs();
    try { popup.close(); } catch (_) {}
    window.location.reload();
  };
  window.addEventListener('message', onMessage);

  // If the popup closes (user X'd out, AniList showed JSON error, etc.)
  // without sending a token, offer the manual paste fallback immediately.
  const closedTimer = setInterval(() => {
    if (!popup.closed) return;
    clearInterval(closedTimer);
    window.removeEventListener('message', onMessage);
    if (gotToken) return;
    if (typeof openSignInModal === 'function') openSignInModal();
    const panel = document.getElementById('signin-advanced');
    if (panel) panel.hidden = false;
    const banner = document.getElementById('signin-error');
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = "<strong>Sign-in didn't complete</strong>" +
        "AniList's redirect didn't return a token. Paste one with the steps below — it works every time.";
    }
  }, 700);
}
function signOut() {
  state.accessToken = null;
  state.user = null;
  savePrefs();
  Object.keys(cache).forEach(k => delete cache[k]);
  cacheExpires.clear();
  try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
  window.location.reload();
}
window.signIn = signIn;
window.signOut = signOut;

// Fetch the signed-in viewer's profile + stats, plus the unread notification
// count so the bell badge can render on the first paint without a second
// round-trip.
async function fetchViewer() {
  if (!state.accessToken) return;
  const q = `query {
    Viewer {
      id
      name
      avatar { large medium }
      unreadNotificationCount
      statistics {
        anime {
          count
          minutesWatched
          episodesWatched
        }
      }
    }
  }`;
  const data = await anilist(q);
  if (data?.Viewer) {
    state.user = data.Viewer;
    updateAuthUI();
    // Home list + bell badge in parallel — both need state.user in place.
    loadMyList();
    if (typeof setNotifBadge === 'function') setNotifBadge(data.Viewer.unreadNotificationCount || 0);
    if (typeof initNotifications === 'function') initNotifications();
    window.__anilogViewerFailed = false;
    return true;
  }
  // Failed with a token still in hand. Repaint so Home shows "couldn't reach
  // AniList" rather than the sign-in CTA — previously nothing ran here at all,
  // so the boot-time render stood and a signed-in user was told to sign in.
  window.__anilogViewerFailed = true;
  if (typeof updateAuthUI === 'function') updateAuthUI();
  return false;
}

// Recover without a manual reload. A cold start that lands while AniList is
// unreachable used to leave the app on an empty Home until the user thought to
// relaunch it; coming back onto a connection now simply retries.
window.addEventListener('online', () => {
  if (state.accessToken && !state.user) fetchViewer();
});
