// AniLog — application state, persistence, OAuth hash bootstrap.
// `state` is the single source of truth for user preferences and session.
// `cache` keys AniList GraphQL responses in memory only.
// Mutable runtime references (current overlay state, request IDs) live at the bottom.

// ============ STATE ============
const state = {
  activeTab: 'home',
  themeId: 'iris',
  accent: '#7c5cff',
  customAccent: '#7c5cff',
  theme: 'dark',
  viewMode: 'mobile',           // 'mobile' or 'desktop' — toggled in Profile
  density: 'comfortable',
  landing: 'home',
  season: 'SPRING',
  seasonYear: 2026,
  seasonalSort: 'TRENDING_DESC',
  notifs: { episode: true, reply: true, like: false },
  preferEnglish: true,
  strictRelations: true,
  listStatus: 'CURRENT',
  listSort: 'SCORE_DESC',
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
  // Backward compat: if themeId missing, infer from accent
  if (!saved.themeId) {
    const match = THEMES.find(t => t.color.toLowerCase() === (state.accent || '').toLowerCase());
    state.themeId = match ? match.id : 'custom';
    if (!match) state.customAccent = state.accent;
  }
} catch (e) {}

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
let homeReqId      = 0;
