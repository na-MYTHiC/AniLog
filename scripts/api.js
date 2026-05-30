// AniLog — AniList GraphQL client and auth helpers.
// All network IO routes through `anilist()`. Auth header is added when signed in.

async function anilist(query, variables = {}) {
  const isMutation = query.trim().startsWith('mutation');
  // Cache key differs when authed vs. not so we don't leak personal data across sessions
  const key = (state.accessToken ? 'auth:' : 'pub:') + query + JSON.stringify(variables);
  if (!isMutation && cache[key]) return cache[key];
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
  try {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) {
      // Token expired or revoked — sign out gracefully
      signOut();
      return null;
    }
    const json = await res.json();
    if (!isMutation) {
      cache[key] = json.data;
    } else {
      // Mutations invalidate cached reads — wipe so list views refetch fresh
      Object.keys(cache).forEach(k => delete cache[k]);
    }
    return json.data;
  } catch (e) {
    console.error('AniList error', e);
    return null;
  }
}

// OAuth sign-in / sign-out
function signIn() { window.location.href = ANILIST_AUTH_URL; }
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
          meanScore
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
    // Auto-load the list if we're on Home
    if (state.activeTab === 'home') loadMyList();
  }
}


// expose globally for inline onclick handlers
window.signIn = signIn;
window.signOut = signOut;
