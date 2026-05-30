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

// Catch the token if we just came back from AniList authorization
if (window.location.hash && window.location.hash.includes('access_token=')) {
  const params = new URLSearchParams(window.location.hash.substring(1));
  const token = params.get('access_token');
  if (token) {
    state.accessToken = token;
    history.replaceState(null, '', window.location.pathname);
    try { localStorage.setItem('anilog-prefs', JSON.stringify(state)); } catch (e) {}
  }
}

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
