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

  // 1) Fresh cache hit — skip the network entirely
  if (!isMutation) {
    const exp = cacheExpires.get(key) || 0;
    if (cache[key] !== undefined && exp > Date.now()) return cache[key];
  }

  // 2) Already in flight — return the in-progress promise instead of stacking
  if (!isMutation && inflight.has(key)) return inflight.get(key);

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;

  const exec = (async () => {
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
        } else {
          // Any successful write invalidates every cached read
          Object.keys(cache).forEach(k => delete cache[k]);
          cacheExpires.clear();
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
  })();

  if (!isMutation) inflight.set(key, exec);
  try {
    return await exec;
  } finally {
    inflight.delete(key);
  }
}

// OAuth sign-in / sign-out
function signIn() {
  // Record the attempt so we can detect when AniList silently bounces us
  // (closed tab, error JSON on AniList's domain, etc.) and offer a re-try
  try { localStorage.setItem('anilog-signin-started', String(Date.now())); } catch (e) {}
  window.location.href = ANILIST_AUTH_URL;
}
function signOut() {
  state.accessToken = null;
  state.user = null;
  savePrefs();
  Object.keys(cache).forEach(k => delete cache[k]);
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
