// AniLog — application state, persistence, OAuth hash bootstrap.
// `state` is the single source of truth for user preferences and session.
// `cache` keys AniList GraphQL responses in memory only.
// Mutable runtime references (current overlay state, request IDs) live at the bottom.

// ============ OAUTH POPUP COMPLETION ============
// If this page is loaded as the OAuth popup target with a token in the URL
// fragment, signal the opener via postMessage and close ourselves. Runs
// BEFORE the rest of state initializes so we don't bother booting the full
// app inside the popup window.
(function popupOAuthBridge() {
  if (!window.opener || window.opener === window) return;
  const hash = window.location.hash || '';
  if (!hash.includes('access_token=')) return;
  try {
    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    if (!token) return;
    window.opener.postMessage(
      { type: 'anilog-oauth-token', token },
      window.location.origin
    );
  } catch (e) { /* opener closed or origin mismatch — fall through to close */ }
  try { window.close(); } catch (e) {}
  // Halt further script execution in the popup so the app doesn't render
  // in the brief window before close() takes effect.
  // eslint-disable-next-line no-throw-literal
  throw 'AniLog: popup sign-in completed';
})();

// ============ STATE ============
const state = {
  activeTab: 'home',
  themeId: 'iris',
  accent: '#7c5cff',
  theme: 'dark',
  density: 'comfortable',
  landing: 'home',
  season: 'SPRING',
  seasonYear: 2026,
  seasonalSort: 'TRENDING_DESC',
  notifs: { episode: true, reply: true, like: true },
  preferEnglish: true,
  strictRelations: true,
  // Portrait by default — the layout is a phone layout, and landscape mostly
  // just crops it. The manifest locks the installed PWA at launch; this pref
  // is what lets someone override that at runtime.
  allowRotation: false,
  listStatus: 'CURRENT',
  listSort: 'MEDIA_AVERAGE_SCORE_DESC',
  recentSearches: [],
  accessToken: null,
  user: null,
};
const cache = {};

// ============ OAUTH CALLBACK CAPTURE ============
// AniList redirects back here after sign-in. Three possible shapes:
//   1) #access_token=...                  — implicit grant success
//   2) #error=...&error_description=...   — implicit grant failure (fragment)
//   3) ?error=...&error_description=...   — auth-code grant failure (query)
// We capture each so we can show a real error UI instead of silent dead ends.
let pendingOAuthError = null;

(function captureOAuthCallback() {
  const hash = window.location.hash || '';
  const query = window.location.search || '';
  let captured = false;

  if (hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    if (token) {
      state.accessToken = token;
      captured = true;
      try { localStorage.setItem('anilog-prefs', JSON.stringify(state)); } catch (e) {}
    }
  }

  if (!captured && (hash.includes('error=') || query.includes('error='))) {
    const params = hash.includes('error=')
      ? new URLSearchParams(hash.substring(1))
      : new URLSearchParams(query.substring(1));
    pendingOAuthError = {
      code: params.get('error') || 'unknown_error',
      desc: params.get('error_description') || params.get('message') || params.get('hint') || '',
    };
    captured = true;
  }

  // Wipe the hash/query so a refresh doesn't re-fire the same flow
  if (captured) history.replaceState(null, '', window.location.pathname);

  // Clear the signin-started flag on a clean success or any captured error
  if (captured) {
    try { localStorage.removeItem('anilog-signin-started'); } catch (e) {}
  } else if (!state.accessToken) {
    // No token, no error captured — but we may have STARTED a sign-in that
    // never finished (closed tab, AniList showed its own JSON error, etc.).
    // Within 5 minutes of starting, surface a friendly retry prompt.
    try {
      const startedAt = parseInt(localStorage.getItem('anilog-signin-started') || '0', 10);
      if (startedAt && Date.now() - startedAt < 5 * 60 * 1000) {
        pendingOAuthError = {
          code: 'no_token_received',
          desc: "Sign-in didn't complete — the AniList tab may have been closed before it finished, or AniList showed an error before reaching us. Try again, or use the token-paste option below.",
        };
      }
      // Whether we surfaced or not, clear so we don't keep nagging
      localStorage.removeItem('anilog-signin-started');
    } catch (e) {}
  }
})();

try {
  const saved = JSON.parse(localStorage.getItem('anilog-prefs') || '{}');
  Object.assign(state, saved);
  // Migration: the "Score" list sort used to be SCORE_DESC (user's personal
  // score, per AniList's MediaListSort). We now sort by community score via
  // a client-side sentinel. Upgrade any existing pref so users don't stay
  // stuck on personal-score ordering.
  if (state.listSort === 'SCORE_DESC') state.listSort = 'MEDIA_AVERAGE_SCORE_DESC';
  // Backward compat: prefs stored before the preset-only theme picker had
  // a themeId of 'custom'. Snap any legacy custom to Iris so we always
  // resolve to one of the 10 presets.
  if (!saved.themeId || saved.themeId === 'custom') {
    const match = THEMES.find(t => t.color.toLowerCase() === (state.accent || '').toLowerCase());
    state.themeId = match ? match.id : 'iris';
    if (!match) state.accent = THEMES.find(t => t.id === 'iris').color;
  }
} catch (e) {}

// Always compute the current anime season from today's date so the Seasonal
// tab defaults to whatever's actually airing. Overrides whatever was in
// localStorage (previously we shipped SPRING 2026 as a hardcoded default and
// it stuck until the user manually navigated).
(function setCurrentSeason() {
  const now = new Date();
  const month = now.getMonth(); // 0 = January
  const year = now.getFullYear();
  let season;
  if (month <= 2)       season = 'WINTER';
  else if (month <= 5)  season = 'SPRING';
  else if (month <= 8)  season = 'SUMMER';
  else                  season = 'FALL';
  state.season = season;
  state.seasonYear = year;
})();

function savePrefs() {
  localStorage.setItem('anilog-prefs', JSON.stringify(state));
}

// Mutable runtime state (not persisted). Each lives next to its first consumer
// in app.js (currentMedia, seasonalView, searchReqId, etc.). The few overlay
// states below don't have an obvious home in app.js, so they live here.
let categoryState  = { sort: 'POPULARITY_DESC', type: 'ANIME', isSeasonal: false };
let genreState     = { genre: '', type: 'ANIME', sort: 'POPULARITY_DESC' };
let studioState    = { id: null, name: '', sort: 'POPULARITY_DESC' };
let staffState     = { id: null, name: '', sort: 'FAVOURITES_DESC' };
let editingEntry   = null;
let editingMediaId = null;
