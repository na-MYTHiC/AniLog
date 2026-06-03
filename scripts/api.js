// AniLog — AniList GraphQL client and auth helpers.
// All network IO routes through `anilist()`. Designed to survive a flaky
// connection: timeouts, retries with backoff, in-flight de-duplication,
// rate-limit handling, and stale-cache fallback when nothing else works.

// How long a cached response is considered fresh (network skipped). After
// this we still keep the entry — if the network later fails, we'll serve
// the stale copy rather than nothing.
const CACHE_TTL_MS = 5 * 60 * 1000;
// Hard request timeout — AniList sometimes just hangs.
const REQUEST_TIMEOUT_MS = 12000;
// Per-key fresh-until timestamps. cache[key] stays raw data so existing
// consumers that read `cache[key]` directly aren't broken.
const cacheExpires = new Map();
// query+vars key -> in-flight Promise, so two simultaneous calls share one fetch
const inflight = new Map();

// ============ PERSISTENT CACHE ============
// Survives PWA cold-starts so the user sees content instantly the next time
// they open the app. Capped so we never run out of localStorage quota.
const PERSIST_KEY = 'anilog-cache-v1';
const PERSIST_CAP = 60; // most recently used keys are persisted

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
    try {
      const keys = Object.keys(cache);
      // Sort by expiry desc (most recently set first), keep top PERSIST_CAP
      keys.sort((a, b) => (cacheExpires.get(b) || 0) - (cacheExpires.get(a) || 0));
      const slim = {};
      for (let i = 0; i < Math.min(keys.length, PERSIST_CAP); i++) {
        const k = keys[i];
        slim[k] = { data: cache[k], exp: cacheExpires.get(k) || 0 };
      }
      localStorage.setItem(PERSIST_KEY, JSON.stringify(slim));
    } catch (e) {
      // localStorage full or unavailable — drop persistent layer entirely
      try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
    }
  }, 1000);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function anilist(query, variables = {}) {
  const isMutation = query.trim().startsWith('mutation');
  // Auth/pub split so we don't leak personal data across sign-in / sign-out
  const key = (state.accessToken ? 'auth:' : 'pub:') + query + JSON.stringify(variables);

  if (!isMutation) {
    const exp = cacheExpires.get(key) || 0;
    const hasCached = cache[key] !== undefined;

    // 1) Fresh cache hit — return immediately, no network at all
    if (hasCached && exp > Date.now()) return cache[key];

    // 2) Stale-while-revalidate: cache exists but TTL elapsed. Return it
    //    instantly so the UI is snappy, and kick a background refresh so
    //    the NEXT call serves fresher data. Only fire one background fetch
    //    per key — re-uses the same promise if another caller hits during
    //    the request window.
    if (hasCached && !inflight.has(key)) {
      const bg = runFetch().finally(() => inflight.delete(key));
      inflight.set(key, bg);
      return cache[key];
    }

    // 3) Already in flight — share the promise so we don't stack duplicates
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
    return _executeRequest(key, query, variables, headers, isMutation);
  }
}

async function _executeRequest(key, query, variables, headers, isMutation) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(ANILIST, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      }, REQUEST_TIMEOUT_MS);

      // Auth expired or revoked — bail out, don't retry
      if (res.status === 401) {
        signOut();
        return null;
      }

      // Rate limited — wait the requested time (capped at 10s), then retry
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        await sleep(Math.min(Math.max(retryAfter, 1), 10) * 1000);
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
        // Any successful write invalidates every cached read
        Object.keys(cache).forEach(k => delete cache[k]);
        cacheExpires.clear();
        try { localStorage.removeItem(PERSIST_KEY); } catch (_) {}
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

// Fetch the signed-in viewer's profile + stats.
async function fetchViewer() {
  if (!state.accessToken) return;
  const q = `query {
    Viewer {
      id
      name
      avatar { large medium }
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
    // Always populate the home list — the grid sits inside the home tab whether
    // it's visible or not, so when the user reaches home it's already ready.
    loadMyList();
  }
}
