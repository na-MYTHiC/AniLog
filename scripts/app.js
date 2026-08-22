// AniLog — application UI.
// All tabs, overlays, modals, detail views, swipe handling, and boot calls.
// Depends on: config.js (constants), state.js (state, cache, runtime vars),
//             api.js (anilist client, auth), render.js (helpers, renderers).

// ============ TOAST ============
// Lightweight transient banner. showToast('Link copied') or
// showToast('Removed', { actionLabel: 'Undo', onAction: () => restore() }).
function showToast(message, opts = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  toast.appendChild(msg);
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      opts.onAction();
      hide();
    });
    toast.appendChild(btn);
  }
  stack.appendChild(toast);
  // Trigger transition on next frame so the in-class actually animates
  requestAnimationFrame(() => toast.classList.add('in'));
  const duration = opts.duration ?? (opts.actionLabel ? 6000 : 2500);
  const hideTimer = setTimeout(hide, duration);
  function hide() {
    clearTimeout(hideTimer);
    toast.classList.remove('in');
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
  }
}
window.showToast = showToast;

// ============ SHARE ============
// Opens the OS native share sheet with the AniList anime URL where available.
// Falls back to copying the URL to the clipboard on desktop browsers that
// don't support Web Share.
function shareMedia(mediaId, title) {
  const url = `https://anilist.co/anime/${mediaId}`;
  const label = title || 'this anime';
  if (navigator.share) {
    navigator.share({
      title: label,
      text: `Check out ${label} on AniList`,
      url,
    }).catch(() => { /* user cancelled / dismissed */ });
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      () => prompt('Copy this link:', url)
    );
    return;
  }
  prompt('Copy this link:', url);
}
window.shareMedia = shareMedia;

// ============ USER PROFILE OVERLAY ============
// Opened from Social when the user taps a friend's avatar or username.
// Renders a profile card (avatar + name + stats) plus a Home-style list
// view of that user's anime library with status filter chips.
// Mirrors My List: status + sort selection, plus a reqId to cancel stale renders.
let userProfileState = {
  id: null,
  name: '',
  status: 'CURRENT',
  sort: 'MEDIA_AVERAGE_SCORE_DESC',
  reqId: 0,
};

async function openUser(userId, userName) {
  userProfileState.id = userId;
  userProfileState.name = userName;
  userProfileState.status = 'CURRENT';
  userProfileState.sort = 'MEDIA_AVERAGE_SCORE_DESC';
  const body = document.getElementById('user-body');
  document.getElementById('user-title').textContent = userName;
  document.getElementById('user-overlay').classList.add('visible');

  // Skeleton
  body.innerHTML = `
    <div class="user-hero">
      <div class="user-hero-avatar skeleton"></div>
      <div class="user-hero-info">
        <div class="skeleton" style="height: 20px; width: 60%; border-radius: 6px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 12px; width: 80%; border-radius: 4px;"></div>
      </div>
    </div>
    <div class="list-controls" id="user-list-controls"></div>
    <div class="user-list-rows" id="user-list-rows"></div>
  `;

  await loadUserProfile();
}

async function loadUserProfile() {
  const myReq = ++userProfileState.reqId;
  const q = `query ($id: Int) {
    User(id: $id) {
      id name
      avatar { large medium }
      siteUrl
      statistics { anime { count minutesWatched episodesWatched } }
    }
  }`;
  const data = await anilist(q, { id: userProfileState.id });
  if (myReq !== userProfileState.reqId) return;
  const u = data?.User;
  const body = document.getElementById('user-body');
  if (!u) {
    body.innerHTML = `<div class="user-list-empty">Couldn't load this profile.</div>`;
    return;
  }
  const stats = u.statistics?.anime;
  const hours = stats?.minutesWatched ? Math.round(stats.minutesWatched / 60) : 0;
  const avatar = u.avatar?.large || u.avatar?.medium || '';
  const statusLabel = listStatusLabel(userProfileState.status);
  const sortLabel = listSortLabel(userProfileState.sort);
  body.innerHTML = `
    <div class="user-hero">
      <div class="user-hero-avatar" style="background-image:url('${avatar}');"></div>
      <div class="user-hero-info">
        <div class="user-hero-name">${escapeHtml(u.name)}</div>
        <div class="user-hero-stats">
          <strong>${stats?.count || 0}</strong> anime · <strong>${hours}h</strong> watched
        </div>
      </div>
    </div>
    <div class="list-controls" id="user-list-controls">
      <button class="sort-trigger" id="user-list-status-btn">
        <strong id="user-list-status-label">${escapeHtml(statusLabel)}</strong>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <button class="sort-trigger" id="user-list-sort-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
        <span>Sort: <strong id="user-list-sort-label">${escapeHtml(sortLabel)}</strong></span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </div>
    <div class="user-list-rows list-rows" id="user-list-rows"></div>
  `;

  // Wire status + sort dropdowns to the shared sort modal, same as Home.
  document.getElementById('user-list-status-btn').addEventListener('click', () => {
    openSortModal(userProfileState.status, (v) => {
      userProfileState.status = v;
      const label = document.getElementById('user-list-status-label');
      if (label) label.textContent = listStatusLabel(v);
      loadUserList();
    }, `${u.name}'s List`, LIST_STATUS_OPTIONS);
  });
  document.getElementById('user-list-sort-btn').addEventListener('click', () => {
    openSortModal(userProfileState.sort, (v) => {
      userProfileState.sort = v;
      const label = document.getElementById('user-list-sort-label');
      if (label) label.textContent = listSortLabel(v);
      loadUserList();
    }, `Sort ${u.name}'s List`, LIST_SORT_OPTIONS);
  });

  loadUserList();
}

async function loadUserList() {
  const myReq = ++userProfileState.reqId;
  const rows = document.getElementById('user-list-rows');
  if (!rows) return;
  skeletonFillRows(rows, 5);

  const mediaShape = `
    id
    title { userPreferred english romaji }
    coverImage { large color }
    averageScore
    format
    episodes
    status
    nextAiringEpisode { airingAt episode timeUntilAiring }
  `;
  const isAll = userProfileState.status === 'ALL';
  const q = isAll
    ? `query ($userId: Int, $sort: [MediaListSort]) {
        MediaListCollection(userId: $userId, type: ANIME, sort: $sort) {
          lists { entries { id status score progress media { ${mediaShape} } } }
        }
      }`
    : `query ($userId: Int, $status: MediaListStatus, $sort: [MediaListSort]) {
        MediaListCollection(userId: $userId, type: ANIME, status: $status, sort: $sort) {
          lists { entries { id status score progress media { ${mediaShape} } } }
        }
      }`;
  const isClientScoreSort = userProfileState.sort === 'MEDIA_AVERAGE_SCORE_DESC';
  const apiSort = isClientScoreSort ? 'UPDATED_TIME_DESC' : userProfileState.sort;
  const vars = isAll
    ? { userId: userProfileState.id, sort: [apiSort] }
    : { userId: userProfileState.id, status: userProfileState.status, sort: [apiSort] };

  const data = await anilist(q, vars);
  if (myReq !== userProfileState.reqId) return;
  let entries = (data?.MediaListCollection?.lists || []).flatMap(l => l.entries || []);
  if (isClientScoreSort) {
    entries = entries.slice().sort((a, b) => (b.media?.averageScore || 0) - (a.media?.averageScore || 0));
  }
  if (!entries.length) {
    rows.innerHTML = `<div class="user-list-empty">
      ${escapeHtml(userProfileState.name)}'s <strong>${escapeHtml(listStatusLabel(userProfileState.status))}</strong> list is empty.
    </div>`;
    return;
  }
  rows.innerHTML = entries.map(renderListEntryRow).join('');
  // Tap a row → open that anime's detail
  Array.from(rows.children).forEach((wrap) => {
    const mediaId = parseInt(wrap.dataset.mediaId, 10);
    if (!isNaN(mediaId)) {
      wrap.addEventListener('click', () => openMedia(mediaId));
    }
  });
}

// ============ IMAGE LIGHTBOX ============
// Opens a fullscreen viewer for a cover / large image. Backdrop click,
// X button, and Escape all dismiss.
function openLightbox(src) {
  if (!src) return;
  const box = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!box || !img) return;
  img.src = src;
  box.classList.add('visible');
  box.setAttribute('aria-hidden', 'false');
}
function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box) return;
  box.classList.remove('visible');
  box.setAttribute('aria-hidden', 'true');
  // Delay clearing the src so the shrink animation still shows the image
  setTimeout(() => {
    const img = document.getElementById('lightbox-img');
    if (img && !box.classList.contains('visible')) img.src = '';
  }, 250);
}
(function wireLightbox() {
  const box = document.getElementById('lightbox');
  const closeBtn = document.getElementById('lightbox-close');
  if (!box || !closeBtn) return;
  // Click the backdrop (but not the image) to dismiss
  box.addEventListener('click', (e) => {
    if (e.target === box) closeLightbox();
  });
  closeBtn.addEventListener('click', closeLightbox);
  // Escape is handled centrally by closeTopLayer() — a lightbox-specific
  // listener here would fire alongside it and dismiss two layers at once.
})();

// ============ TRAILER ============
// AniList's externalLinks includes STREAMING, INFO, and SOCIAL entries.
// We only surface STREAMING here — INFO/SOCIAL links (Twitter, official
// site, AniDB) aren't "watch it here" links. Additionally we whitelist to
// services that legally stream anime in the US: shows also list Wakanim
// (EU), Bilibili (Asia), ADN (France), etc. that would 404 or block a US
// visitor. De-dupe by service so Crunchyroll sub + dub only shows once.
const US_STREAMING_SITES = new Set([
  'crunchyroll',
  'netflix',
  'hulu',
  'amazon prime video',
  'amazon',
  'prime video',
  'disney plus',
  'disney+',
  'hidive',
  'max',
  'hbo max',
  'tubi',
  'apple tv',
  'apple tv+',
  'peacock',
]);
function renderStreamingSection(links) {
  const streaming = (links || []).filter((l) => {
    if (!l || l.type !== 'STREAMING' || !l.url) return false;
    const key = (l.site || '').toLowerCase().trim();
    return US_STREAMING_SITES.has(key);
  });
  if (streaming.length === 0) return '';
  const seen = new Set();
  const unique = streaming.filter((l) => {
    const key = (l.site || l.url).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const buttons = unique.map((l) => {
    const site = escapeHtml(l.site || 'Watch');
    const color = l.color && /^#[0-9a-fA-F]{3,8}$/.test(l.color) ? l.color : '';
    const icon = l.icon ? `<img class="stream-icon" src="${escapeHtml(l.icon)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : '';
    const style = color ? ` style="--stream-color: ${color};"` : '';
    return `<a class="stream-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer"${style}>${icon}<span>${site}</span></a>`;
  }).join('');
  return `
    <div class="detail-section">
      <h4>Watch on</h4>
      <div class="stream-row">${buttons}</div>
    </div>
  `;
}

// AniList returns one trailer per show with { id, site, thumbnail }. site is
// typically "youtube" (most common) or "dailymotion". Render a clickable
// thumbnail; tapping it loads the actual iframe (lazy-load keeps the page
// snappy even when scrolling past the trailer section).
function renderTrailerSection(trailer) {
  if (!trailer?.id || !trailer?.site) return '';
  const id = String(trailer.id);
  const site = String(trailer.site).toLowerCase();
  if (site !== 'youtube' && site !== 'dailymotion') return '';
  const thumb = trailer.thumbnail
    || (site === 'youtube' ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
  return `
    <div class="detail-section">
      <h4>Trailer</h4>
      <div class="trailer-frame" data-trailer-site="${site}" data-trailer-id="${escapeHtml(id)}">
        <div class="trailer-thumb" style="background-image:url('${thumb}');"></div>
        <button class="trailer-play" aria-label="Play trailer">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
    </div>
  `;
}

// Lazy-load the YouTube/Dailymotion iframe on first click so the page itself
// doesn't drag in 100+ KB of player chrome just because the user opened a
// detail page they may scroll past.
function wireTrailerFrame(body) {
  const frame = body.querySelector('.trailer-frame');
  if (!frame) return;
  const open = () => {
    const site = frame.dataset.trailerSite;
    const id = frame.dataset.trailerId;
    let src = '';
    if (site === 'youtube') {
      src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&hl=en&cc_lang_pref=en&cc_load_policy=1`;
    } else if (site === 'dailymotion') {
      src = `https://www.dailymotion.com/embed/video/${id}?autoplay=1`;
    }
    if (!src) return;
    frame.innerHTML = `<iframe src="${src}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  };
  frame.addEventListener('click', open, { once: true });
}

// ============ THEME PICKER (dropdown row + modal list) ============
function openThemeModal() {
  buildThemeList();
  document.getElementById('theme-modal').classList.add('visible');
}
function closeThemeModal() {
  document.getElementById('theme-modal').classList.remove('visible');
}

function buildThemeList() {
  const list = document.getElementById('theme-list');
  const check = '<svg class="theme-option-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  list.innerHTML = THEMES.map(t => `
    <div class="theme-option" data-theme-id="${t.id}">
      <div class="theme-option-swatch" style="background:${t.color};"></div>
      <div class="theme-option-name">${t.name}</div>
      ${state.themeId === t.id ? check : ''}
    </div>
  `).join('');
  list.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => selectTheme(opt.dataset.themeId));
  });
}

function selectTheme(id) {
  const theme = THEMES.find(t => t.id === id);
  if (!theme) return;
  state.themeId = id;
  state.accent = theme.color;
  applyTheme();
  updateThemeStripUI();
  savePrefs();
  closeThemeModal();
}

// Reflects the active preset on the settings row swatch + label
function updateThemeStripUI() {
  const triggerSwatch = document.getElementById('theme-trigger-swatch');
  const active = THEMES.find(t => t.id === state.themeId);
  if (triggerSwatch) triggerSwatch.style.background = active?.color || state.accent;
  document.getElementById('theme-name').textContent = active?.name || 'Iris';
}
// If the saved themeId points at the removed 'custom' option, snap to Iris
if (state.themeId === 'custom') {
  state.themeId = 'iris';
  state.accent = THEMES.find(t => t.id === 'iris').color;
  applyTheme();
}
updateThemeStripUI();

document.getElementById('theme-picker-row').addEventListener('click', openThemeModal);

// Sync other segmented controls to saved state
syncSegState('theme-seg', 'theme', state.theme);
syncSegState('density-seg', 'density', state.density);
syncSegState('landing-seg', 'landing', state.landing);
syncSegState('lang-seg', 'lang', state.preferEnglish ? 'english' : 'default');
syncSegState('relations-seg', 'relations', state.strictRelations ? 'strict' : 'all');
syncSegState('rotation-seg', 'rotation', state.allowRotation ? 'auto' : 'locked');
applyOrientation();
Object.entries(state.notifs).forEach(([key, on]) => {
  const seg = document.querySelector(`.seg[data-notif="${key}"]`);
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.on === 'true') === on);
  });
});

// ============ TAB SWITCHING ============
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('content').scrollTop = 0;

  if (tab === 'search') loadSearchTab();
  if (tab === 'seasonal') loadSeasonal();
  if (tab === 'social') loadSocial();
  if (tab === 'home' && state.user) loadMyList();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ============ ANILIST API ============



// Filter relation edges by anime-only + strict/all setting


// ============ SEARCH TAB ============
let searchReqId = 0;
// Genre carousels shown on the pre-search screen. Each loads independently below.
const SEARCH_GENRES = ['Action', 'Romance', 'Comedy', 'Drama', 'Fantasy', 'Slice of Life'];

async function loadSearchTab() {
  const myReq = ++searchReqId;

  // Wire "See all" — Trending/Top/Popular skip the sort UI (the entry IS the sort).
  document.getElementById('search-trending-link').onclick = () => openCategory('TRENDING_DESC', 'ANIME', 'Trending Now', { noSort: true });
  document.getElementById('search-top-link').onclick     = () => openCategory('SCORE_DESC',    'ANIME', 'Top 100',       { noSort: true });
  document.getElementById('search-popular-link').onclick = () => openCategory('POPULARITY_DESC','ANIME', 'All-Time Popular', { noSort: true });

  // Genre "See all" links — open the genre overlay (which keeps the sort dropdown)
  document.querySelectorAll('[data-genre-link]').forEach(a => {
    const g = a.dataset.genreLink;
    a.onclick = () => openGenre(g, 'ANIME');
  });

  // These nine carousels used to be nine separate requests fired back to
  // back, which is a good way to trip AniList's rate limiter — and a 429 that
  // outlasts our retries surfaces as "Couldn't load." in a row that has no
  // way to recover. GraphQL aliases let one request carry all of them, so
  // it's now two round-trips total and far less likely to be throttled.
  const rows = [
    { id: 'trending-row', alias: 'trending', sort: 'TRENDING_DESC' },
    { id: 'top-row',      alias: 'top',      sort: 'SCORE_DESC' },
    { id: 'popular-row',  alias: 'popular',  sort: 'POPULARITY_DESC' },
  ];

  const rowsQuery = `query {
    ${rows.map((r) => `${r.alias}: Page(perPage: 12) {
      media(sort: ${r.sort}, type: ANIME, isAdult: false) { ${MEDIA_FRAGMENT} }
    }`).join('\n')}
  }`;
  rows.forEach((r) => {
    const el = document.getElementById(r.id);
    if (el && !el.children.length) skeletonFill(el, 6);
  });
  const rowsData = await anilist(rowsQuery);
  if (searchReqId !== myReq) return;
  rows.forEach((r) => {
    const el = document.getElementById(r.id);
    if (el) renderCarouselInto(el, rowsData?.[r.alias]?.media, () => loadSearchTab());
  });

  // Genre rows — same idea. Aliases must be valid GraphQL names, so "Slice of
  // Life" can't be one; index-based aliases sidestep the whole question.
  const genreEls = SEARCH_GENRES.map((g) => document.querySelector(`[data-genre-row="${g}"]`));
  genreEls.forEach((el) => { if (el && !el.children.length) skeletonFill(el, 6); });

  const genreVars = {};
  const genreQuery = `query (${SEARCH_GENRES.map((_, i) => `$g${i}: String`).join(', ')}) {
    ${SEARCH_GENRES.map((g, i) => {
      genreVars[`g${i}`] = g;
      return `g${i}: Page(perPage: 12) {
        media(genre: $g${i}, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${MEDIA_FRAGMENT} }
      }`;
    }).join('\n')}
  }`;
  const genreData = await anilist(genreQuery, genreVars);
  if (searchReqId !== myReq) return;
  genreEls.forEach((el, i) => {
    if (el) renderCarouselInto(el, genreData?.[`g${i}`]?.media, () => loadSearchTab());
  });
}


// Search input
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchPre = document.getElementById('search-pre');
const searchResults = document.getElementById('search-results');
const searchGrid = document.getElementById('search-grid');
let searchTimer;

searchInput.addEventListener('input', (e) => {
  const v = e.target.value.trim();
  searchClear.classList.toggle('visible', v.length > 0);
  clearTimeout(searchTimer);
  if (!v) {
    searchPre.classList.remove('hidden');
    searchResults.classList.remove('visible');
    renderRecentSearches();
    return;
  }
  searchPre.classList.add('hidden');
  searchResults.classList.add('visible');
  renderRecentSearches();
  skeletonFill(searchGrid, 9);
  searchTimer = setTimeout(() => doSearch(v), 280);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  searchPre.classList.remove('hidden');
  searchResults.classList.remove('visible');
  renderRecentSearches();
  searchInput.focus();
});

let searchScroller = null;
// Read by the scroller's fetcher so each page uses the CURRENT query — the
// closure is created once but the search text changes on every keystroke.
let searchQuery = '';
async function doSearch(query) {
  searchQuery = query;

  if (!searchScroller) {
    // Search lives in the main tab area, so #content is the scroll root
    // (unlike the Genre/Studio/Staff overlays, which scroll .overlay-body).
    const scrollEl = document.getElementById('content');
    searchScroller = setupInfiniteScroll(searchGrid, scrollEl, async (page) => {
      const q = `query ($s: String, $page: Int) {
        Page(page: $page, perPage: 30) {
          pageInfo { hasNextPage }
          media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC]) {
            ${MEDIA_FRAGMENT}
          }
        }
      }`;
      const data = await anilist(q, { s: searchQuery, page });
      return {
        items: rankSearchResults(data?.Page?.media || [], searchQuery),
        hasMore: data?.Page?.pageInfo?.hasNextPage || false,
      };
    }, null, null, (el) => skeletonFill(el, 9), 'No results.');
  }

  await searchScroller.reload();
  // A newer keystroke may have started another search while we awaited.
  if (searchQuery !== query) return;
  if (searchGrid.querySelector('.card')) saveRecentSearch(query);
}

// AniList ranks `search` hits across every title variant and synonym, so a
// show matching only its romaji title can outrank one whose English title is
// what you actually typed. Re-rank each page so English matches surface
// first. Sort is stable in every engine we target, so within a tier the
// API's popularity order is preserved.
function rankSearchResults(items, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return items;
  const tier = (m) => {
    const en = (m?.title?.english || '').toLowerCase();
    const ro = (m?.title?.romaji || '').toLowerCase();
    if (en === t) return 0;
    if (en.startsWith(t)) return 1;
    if (ro === t) return 2;
    if (ro.startsWith(t)) return 3;
    if (en.includes(t)) return 4;
    if (ro.includes(t)) return 5;
    return 6;   // matched on a synonym or native title
  };
  return items
    .map((m, i) => ({ m, i, tier: tier(m) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((x) => x.m);
}

// ============ RECENT SEARCHES ============
function saveRecentSearch(query) {
  if (!query || query.length < 3) return;
  const q = query.trim();
  if (!q) return;
  state.recentSearches = [q, ...(state.recentSearches || []).filter(s => s.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  savePrefs();
  renderRecentSearches();
}

function renderRecentSearches() {
  const wrap = document.getElementById('recent-searches');
  const chipsWrap = document.getElementById('recent-chips');
  const recent = state.recentSearches || [];
  const hasQuery = searchInput.value.trim().length > 0;
  if (recent.length === 0 || hasQuery) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  chipsWrap.innerHTML = recent.map((q, idx) => `
    <div class="recent-chip" data-query="${escapeHtml(q)}" data-idx="${idx}">
      ${escapeHtml(q)}
      <span class="recent-chip-x" data-idx="${idx}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </span>
    </div>
  `).join('');
  chipsWrap.querySelectorAll('.recent-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.recent-chip-x')) {
        const idx = parseInt(e.target.closest('.recent-chip-x').dataset.idx, 10);
        state.recentSearches.splice(idx, 1);
        savePrefs();
        renderRecentSearches();
        return;
      }
      searchInput.value = chip.dataset.query;
      searchInput.dispatchEvent(new Event('input'));
    });
  });
}

document.getElementById('recent-clear-all').addEventListener('click', () => {
  state.recentSearches = [];
  savePrefs();
  renderRecentSearches();
});

// Initial render of recent searches on boot
renderRecentSearches();

// ============ SEASONAL TAB ============
// The season the seasonal tab is currently displaying (resets to current on reload)
let seasonalView = { season: state.season, year: state.seasonYear };

function shiftSeason(direction) {
  const idx = SEASONS_ORDER.indexOf(seasonalView.season);
  if (direction === 'next') {
    if (idx === 3) { seasonalView.season = 'WINTER'; seasonalView.year += 1; }
    else seasonalView.season = SEASONS_ORDER[idx + 1];
  } else {
    if (idx === 0) { seasonalView.season = 'FALL'; seasonalView.year -= 1; }
    else seasonalView.season = SEASONS_ORDER[idx - 1];
  }
}

function updateSeasonalHeader() {
  document.getElementById('seasonal-title').textContent = `${capitalize(seasonalView.season)} ${seasonalView.year}`;
  const sub = document.getElementById('seasonal-sub');
  const isCurrent = seasonalView.season === state.season && seasonalView.year === state.seasonYear;
  if (isCurrent) {
    sub.textContent = 'Trending releases this season';
  } else {
    sub.innerHTML = `<span class="back-to-current">Back to current season</span>`;
    sub.querySelector('.back-to-current').addEventListener('click', () => {
      seasonalView.season = state.season;
      seasonalView.year = state.seasonYear;
      updateSeasonalHeader();
      loadSeasonal();
    });
  }
}

let seasonalScroller = null;

async function loadSeasonal() {
  updateSeasonalHeader();
  if (!seasonalScroller) {
    const grid = document.getElementById('seasonal-grid');
    const scrollEl = document.getElementById('content');
    seasonalScroller = setupInfiniteScroll(grid, scrollEl, async (page) => {
      const q = `query ($page: Int, $season: MediaSeason, $year: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: 25) {
          pageInfo { hasNextPage }
          media(season: $season, seasonYear: $year, type: ANIME, sort: $sort, isAdult: false) { ${MEDIA_FRAGMENT} }
        }
      }`;
      const data = await anilist(q, {
        page,
        season: seasonalView.season,
        year: seasonalView.year,
        sort: [state.seasonalSort],
      });
      return {
        items: data?.Page?.media || [],
        hasMore: data?.Page?.pageInfo?.hasNextPage || false,
      };
    }, null, null, (el) => skeletonFill(el, 12));
  }
  await seasonalScroller.reload();
}

document.getElementById('season-prev').addEventListener('click', () => {
  shiftSeason('prev');
  loadSeasonal();
});
document.getElementById('season-next').addEventListener('click', () => {
  shiftSeason('next');
  loadSeasonal();
});

// ============ SEASON / YEAR JUMP PICKER ============
// The arrows step one season at a time, which is right for browsing but
// hopeless for "show me 2013" — that's 50-odd taps. Tapping the title opens
// this instead.
//
// Interaction: a season chip only sets the pending choice and leaves the
// sheet open, because picking a season alone is rarely the whole intent. A
// year applies both and closes, so the common case (jump to a year) stays a
// single tap. The heading tracks the pending pair so it's always clear what
// tapping a year will actually load.

// AniList has scattered entries earlier than this, but seasonYear only
// became meaningful once seasonal broadcasting was tracked properly; a list
// stretching to 1917 would be mostly empty results to scroll past.
const SEASON_PICKER_MIN_YEAR = 1960;

let seasonPickSeason = null;

function seasonPickerYears() {
  // Next year included: autumn is when the following winter gets announced.
  const newest = Math.max(state.seasonYear + 1, seasonalView.year);
  const years = [];
  for (let y = newest; y >= SEASON_PICKER_MIN_YEAR; y--) years.push(y);
  return years;
}

function renderSeasonPicker() {
  document.getElementById('season-modal-title').textContent =
    `${capitalize(seasonPickSeason)} ${seasonalView.year}`;

  document.getElementById('season-chips').innerHTML = SEASONS_ORDER.map((s) => `
    <button class="season-chip${s === seasonPickSeason ? ' active' : ''}" data-season="${s}">
      ${capitalize(s)}
    </button>
  `).join('');

  document.getElementById('season-years').innerHTML = seasonPickerYears().map((y) => `
    <button class="season-year${y === seasonalView.year ? ' active' : ''}" data-year="${y}">${y}</button>
  `).join('');
}

function openSeasonModal() {
  seasonPickSeason = seasonalView.season;
  renderSeasonPicker();
  document.getElementById('season-modal').classList.add('visible');
  centreActiveYear();
}

// Land on the current year rather than at the top of a 60-entry list.
//
// Sets scrollTop by hand rather than calling scrollIntoView(): that scrolls
// EVERY scrollable ancestor, and the document is one of them. It dragged the
// whole .app frame ~600px up the page, pushing the modal off the top of the
// screen and revealing the overlays that sit below .app in the DOM — the
// picker appeared to open onto a stray Voice Actor page.
//
// Rect maths rather than offsetTop, because .season-years isn't positioned,
// so its children measure against .modal-backdrop instead of the list.
function centreActiveYear() {
  const list = document.getElementById('season-years');
  const active = list?.querySelector('.season-year.active');
  if (!list || !active) return;
  const listBox = list.getBoundingClientRect();
  const activeBox = active.getBoundingClientRect();
  list.scrollTop += (activeBox.top - listBox.top) - (listBox.height - activeBox.height) / 2;
}

function closeSeasonModal() {
  document.getElementById('season-modal').classList.remove('visible');
}
window.closeSeasonModal = closeSeasonModal;

document.getElementById('seasonal-picker-btn')?.addEventListener('click', openSeasonModal);

// Delegated: both lists are re-rendered on every chip tap.
document.getElementById('season-chips')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.season-chip');
  if (!btn) return;
  seasonPickSeason = btn.dataset.season;
  renderSeasonPicker();
});

document.getElementById('season-years')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.season-year');
  if (!btn) return;
  const year = parseInt(btn.dataset.year, 10);
  if (!year) return;
  seasonalView.season = seasonPickSeason;
  seasonalView.year = year;
  closeSeasonModal();
  loadSeasonal();
});

// ============ SORT PICKER MODAL (shared) ============


let _sortOnSelect = null;
function openSortModal(currentValue, onSelect, title, options) {
  _sortOnSelect = onSelect;
  document.getElementById('sort-modal-title').textContent = title || 'Sort By';
  const list = document.getElementById('sort-list');
  const check = '<svg class="sort-option-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const opts = options || MEDIA_SORT_OPTIONS;
  list.innerHTML = opts.map(o => `
    <div class="sort-option" data-value="${o.value}">
      <div class="sort-option-name">${escapeHtml(o.label)}</div>
      ${o.value === currentValue ? check : ''}
    </div>
  `).join('');
  list.querySelectorAll('.sort-option').forEach(el => {
    el.addEventListener('click', () => {
      const v = el.dataset.value;
      closeSortModal();
      if (_sortOnSelect) _sortOnSelect(v);
    });
  });
  document.getElementById('sort-modal').classList.add('visible');
}
function closeSortModal() {
  document.getElementById('sort-modal').classList.remove('visible');
}

// Wire seasonal sort button (after openSortModal & labelForSort exist)
document.getElementById('seasonal-sort-label').textContent = labelForSort(state.seasonalSort);
document.getElementById('seasonal-sort-btn').addEventListener('click', () => {
  openSortModal(state.seasonalSort, (newSort) => {
    state.seasonalSort = newSort;
    document.getElementById('seasonal-sort-label').textContent = labelForSort(newSort);
    savePrefs();
    loadSeasonal();
  });
});

// My List dropdowns (status + sort) — values apply when AniList sign-in is wired


document.getElementById('list-status-label').textContent = listStatusLabel(state.listStatus);
document.getElementById('list-sort-label').textContent = listSortLabel(state.listSort);

document.getElementById('list-status-btn').addEventListener('click', () => {
  openSortModal(state.listStatus, (v) => {
    state.listStatus = v;
    document.getElementById('list-status-label').textContent = listStatusLabel(v);
    savePrefs();
    if (state.user) loadMyList();
  }, 'My List', LIST_STATUS_OPTIONS);
});

document.getElementById('list-sort-btn').addEventListener('click', () => {
  openSortModal(state.listSort, (v) => {
    state.listSort = v;
    document.getElementById('list-sort-label').textContent = listSortLabel(v);
    savePrefs();
    if (state.user) loadMyList();
  }, 'Sort My List', LIST_SORT_OPTIONS);
});

// ============ MY LIST (authenticated) ============
function updateAuthUI() {
  const card = document.getElementById('profile-card');
  if (!card) return;
  if (state.user) {
    const u = state.user;
    const stats = u.statistics?.anime;
    const hours = stats?.minutesWatched ? Math.round(stats.minutesWatched / 60) : 0;
    card.innerHTML = `
      <div class="empty-icon" style="width: 72px; height: 72px; border-radius: 50%; padding: 0; overflow: hidden; background: var(--surface-2);">
        ${u.avatar?.large || u.avatar?.medium
          ? `<img src="${u.avatar.large || u.avatar.medium}" alt="${escapeHtml(u.name)}" style="width: 100%; height: 100%; object-fit: cover;">`
          : `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`}
      </div>
      <div class="empty-title">${escapeHtml(u.name)}</div>
      <div class="empty-text">
        <strong>${stats?.count || 0}</strong> anime · <strong>${hours}h</strong> watched
      </div>
      <button class="btn-secondary" onclick="signOut()">Sign out</button>
    `;
  }
  // Hide the home empty CTA if signed in; show otherwise
  const homeEmpty = document.getElementById('home-empty');
  const myGrid = document.getElementById('my-list-grid');
  if (state.user) {
    if (homeEmpty) homeEmpty.style.display = 'none';
    if (myGrid) myGrid.style.display = '';
  } else {
    if (homeEmpty) homeEmpty.style.display = '';
    if (myGrid) myGrid.style.display = 'none';
  }

  // Signing in or out changes whether there's a token to reveal.
  refreshSetupCodes();
}


function attachListRowHandlers(wrap, entry) {
  const row = wrap.querySelector('.list-row');
  const actionAdd = wrap.querySelector('.list-row-action-add');
  const actionSub = wrap.querySelector('.list-row-action-sub');
  let startX = 0, startY = 0, dx = 0;
  let isDragging = false, isHorizontal = false, dragged = false;
  const THRESHOLD = 72; // pixels of drag to trigger an action

  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    isDragging = true;
    isHorizontal = false;
    dragged = false;
    row.classList.add('swiping');
    try { row.setPointerCapture(e.pointerId); } catch (_) {}
  });

  row.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const cx = e.clientX, cy = e.clientY;
    const adx = Math.abs(cx - startX), ady = Math.abs(cy - startY);
    if (!isHorizontal) {
      if (ady > 8 && ady > adx) { isDragging = false; row.classList.remove('swiping'); return; }
      if (adx > 8) { isHorizontal = true; dragged = true; }
      else return;
    }
    dx = cx - startX;
    row.style.transform = `translateX(${dx}px)`;
    // Highlight the action that would fire on release
    actionAdd.classList.toggle('armed', dx <= -THRESHOLD);
    actionSub.classList.toggle('armed', dx >= THRESHOLD);
  });

  const finish = (e) => {
    if (!isDragging) return;
    isDragging = false;
    row.classList.remove('swiping');
    actionAdd.classList.remove('armed');
    actionSub.classList.remove('armed');
    const finalDx = dx;
    row.style.transform = '';
    if (finalDx <= -THRESHOLD) {
      bumpProgress(entry, +1, wrap);
    } else if (finalDx >= THRESHOLD) {
      bumpProgress(entry, -1, wrap);
    }
  };
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);

  // Tap-to-open — suppress when we just dragged
  row.addEventListener('click', (e) => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; return; }
    openMedia(entry.media.id);
  });
}

// Optimistically update progress, then fire mutation; revert + reload on failure
async function bumpProgress(entry, delta, wrap) {
  if (!entry?.media) return;
  const total = entry.media.episodes || Infinity;
  const newProgress = Math.max(0, Math.min(total, (entry.progress || 0) + delta));
  if (newProgress === (entry.progress || 0)) return;
  const oldProgress = entry.progress || 0;
  entry.progress = newProgress;

  // Optimistic re-render of just this row. Swap the CONTENTS, not the node:
  // the swipe that triggered this is mid-snap-back on `.list-row`, and
  // replacing that element throws the running transition away — the row
  // teleports home instead of easing there. Rewriting its innards leaves the
  // animating element (and its already-attached handlers) untouched.
  const tmp = document.createElement('div');
  tmp.innerHTML = renderListEntryRow(entry);
  const freshRow = tmp.querySelector('.list-row');
  const row = wrap.querySelector('.list-row');
  if (freshRow && row) {
    row.innerHTML = freshRow.innerHTML;
  } else {
    // Shape changed out from under us — fall back to a whole-row swap.
    const newWrap = tmp.firstElementChild;
    wrap.replaceWith(newWrap);
    attachListRowHandlers(newWrap, entry);
  }

  // If user just completed the show (progress === total), auto-bump to COMPLETED status
  const becomesCompleted = total !== Infinity && newProgress === total && entry.status !== 'COMPLETED';
  const variables = { mediaId: entry.media.id, progress: newProgress };
  let mutation = `mutation ($mediaId: Int, $progress: Int) {
    SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id progress status }
  }`;
  if (becomesCompleted) {
    mutation = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) { id progress status }
    }`;
    variables.status = 'COMPLETED';
  }
  const { data, queued } = await mutateList(mutation, variables);
  // Queued means "couldn't reach the server, saved for later" — the optimistic
  // row is now the pending truth, so reverting it would throw the edit away.
  if (queued) {
    if (becomesCompleted) entry.status = 'COMPLETED';
    return;
  }
  if (!data?.SaveMediaListEntry) {
    // Revert + reload
    entry.progress = oldProgress;
    loadMyList();
    return;
  }
  entry.status = data.SaveMediaListEntry.status;
  // If we moved into a different list bucket, reload so the row drops off
  if (becomesCompleted && state.listStatus !== 'ALL' && state.listStatus !== 'COMPLETED') {
    loadMyList();
  }
}

// Opens the list edit sheet with a synthetic (new) entry so the user picks the status.
// SaveMediaListEntry handles create-or-update by mediaId — no separate "add" mutation needed.
async function addToList(media) {
  if (!state.user) return openSignInModal();
  openListEditSheet(media, { id: null, status: null, score: 0, progress: 0 });
}

// ============ LIST EDIT SHEET ============

// Episode count of the entry being edited — 0 when AniList doesn't know it
// yet (still-airing shows), which means no upper bound on progress.
let editingTotal = 0;

function openListEditSheet(media, entry) {
  editingEntry = entry;
  editingMediaId = media.id;
  editingTotal = media.episodes || 0;
  const isNew = !entry.id;

  const input = document.getElementById('list-edit-progress');
  input.value = entry.progress || 0;
  if (editingTotal) input.max = editingTotal;
  else input.removeAttribute('max');
  document.getElementById('list-edit-progress-total').textContent =
    editingTotal ? `/ ${editingTotal}` : 'eps';
  syncProgressButtons();
  // Heading says what the sheet does; the anime goes underneath. Putting the
  // title in the h3 made it two wrapped lines of 18px bold for anything
  // longer than a few words.
  document.getElementById('list-edit-title').textContent = isNew ? 'Add to list' : 'Edit entry';
  document.getElementById('list-edit-sub').textContent = pickTitle(media.title) || 'Anime';
  document.querySelectorAll('#list-edit-status .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.status === entry.status);
  });
  // Hide the Remove button when there's nothing to remove yet
  const removeBtn = document.getElementById('list-edit-remove-btn');
  if (removeBtn) removeBtn.style.display = isNew ? 'none' : '';
  document.getElementById('list-edit-modal').classList.add('visible');
}
function closeListEditSheet() {
  document.getElementById('list-edit-modal').classList.remove('visible');
}
window.closeListEditSheet = closeListEditSheet;

// Clamps the episode field and keeps the +/- buttons from offering moves
// that would land out of range.
function syncProgressButtons() {
  const input = document.getElementById('list-edit-progress');
  if (!input) return;
  let v = parseInt(input.value, 10);
  if (isNaN(v) || v < 0) v = 0;
  if (editingTotal && v > editingTotal) v = editingTotal;
  // Only rewrite the field when we actually changed something, so typing
  // isn't disrupted mid-entry.
  if (String(v) !== input.value) input.value = v;
  const minus = document.getElementById('progress-minus');
  const plus = document.getElementById('progress-plus');
  if (minus) minus.disabled = v <= 0;
  if (plus) plus.disabled = !!editingTotal && v >= editingTotal;
}

function stepProgress(delta) {
  const input = document.getElementById('list-edit-progress');
  if (!input) return;
  const current = parseInt(input.value, 10) || 0;
  input.value = current + delta;
  syncProgressButtons();
}

// Commits progress and status in one mutation.
async function saveListEdit() {
  if (!editingMediaId) return;
  syncProgressButtons();

  const progress = parseInt(document.getElementById('list-edit-progress').value, 10) || 0;
  const picked = document.querySelector('#list-edit-status .chip.active')?.dataset.status || null;

  // Reaching the final episode implies COMPLETED — but only when the user
  // hasn't deliberately chosen something else (e.g. marking a finished show
  // as Rewatching, or dropping it on the last episode).
  let status = picked;
  if (editingTotal && progress === editingTotal && (!picked || picked === 'CURRENT')) {
    status = 'COMPLETED';
  }

  // status is omitted entirely when unknown, so AniList keeps whatever the
  // entry already had rather than being reset.
  const varDefs = ['$mediaId: Int', '$progress: Int'];
  const args = ['mediaId: $mediaId', 'progress: $progress'];
  const vars = { mediaId: editingMediaId, progress };
  if (status) {
    varDefs.push('$status: MediaListStatus');
    args.push('status: $status');
    vars.status = status;
  }
  const mutation = `mutation (${varDefs.join(', ')}) {
    SaveMediaListEntry(${args.join(', ')}) { id status progress score }
  }`;

  const mid = editingMediaId;
  const { data, queued } = await mutateList(mutation, vars);
  closeListEditSheet();

  if (queued) {
    showToast('Saved offline — will sync when you reconnect');
    if (state.activeTab === 'home') loadMyList();
    return;
  }
  if (data?.SaveMediaListEntry) {
    if (state.activeTab === 'home') loadMyList();
    openMedia(mid);
  } else {
    showToast("Couldn't save — try again");
  }
}

async function removeFromList() {
  if (!editingEntry?.id) return;
  // Snapshot the entry first so we can re-create it on Undo
  const snapshot = {
    mediaId: editingMediaId,
    status: editingEntry.status,
    score: editingEntry.score || 0,
    progress: editingEntry.progress || 0,
  };
  const mutation = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;
  const { data, queued } = await mutateList(mutation, { id: editingEntry.id });
  const mid = editingMediaId;
  if (queued) {
    closeListEditSheet();
    showToast('Removal saved offline — will sync when you reconnect');
    if (state.activeTab === 'home') loadMyList();
    return;
  }
  if (!data?.DeleteMediaListEntry?.deleted) {
    showToast("Couldn't remove — try again");
    return;
  }
  closeListEditSheet();
  if (state.activeTab === 'home') loadMyList();
  openMedia(mid);
  showToast('Removed from your list', {
    actionLabel: 'Undo',
    onAction: async () => {
      const restoreM = `mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) { id }
      }`;
      const restored = await anilist(restoreM, snapshot);
      if (restored?.SaveMediaListEntry?.id) {
        showToast('Restored');
        if (state.activeTab === 'home') loadMyList();
        openMedia(mid);
      } else {
        showToast("Couldn't restore — sorry");
      }
    },
  });
}

let myListReqId = 0;
async function loadMyList() {
  if (!state.user) return;
  const myReq = ++myListReqId;
  const grid = document.getElementById('my-list-grid');
  if (!grid) return;
  grid.style.display = '';
  skeletonFillRows(grid, 6);

  const mediaShape = `
    id
    title { userPreferred english romaji }
    coverImage { large color }
    averageScore
    format
    episodes
    status
    nextAiringEpisode { airingAt episode timeUntilAiring }
  `;

  const isAll = state.listStatus === 'ALL';
  const q = isAll
    ? `query ($userId: Int, $sort: [MediaListSort]) {
        MediaListCollection(userId: $userId, type: ANIME, sort: $sort) {
          lists { entries { id status score progress media { ${mediaShape} } } }
        }
      }`
    : `query ($userId: Int, $status: MediaListStatus, $sort: [MediaListSort]) {
        MediaListCollection(userId: $userId, type: ANIME, status: $status, sort: $sort) {
          lists { entries { id status score progress media { ${mediaShape} } } }
        }
      }`;

  // MEDIA_AVERAGE_SCORE_DESC is our sentinel — swap in a real MediaListSort
  // for the API call, then re-sort client-side by community score below.
  const isClientScoreSort = state.listSort === 'MEDIA_AVERAGE_SCORE_DESC';
  const apiSort = isClientScoreSort ? 'UPDATED_TIME_DESC' : state.listSort;
  const vars = isAll
    ? { userId: state.user.id, sort: [apiSort] }
    : { userId: state.user.id, status: state.listStatus, sort: [apiSort] };

  const data = await anilist(q, vars);
  if (myListReqId !== myReq) return;
  let entries = (data?.MediaListCollection?.lists || []).flatMap(l => l.entries || []);
  if (isClientScoreSort) {
    entries = entries.slice().sort((a, b) => (b.media?.averageScore || 0) - (a.media?.averageScore || 0));
  }
  if (entries.length === 0) {
    grid.innerHTML = `<div class="no-results" style="padding: 50px 20px;">
      Your <strong>${escapeHtml(listStatusLabel(state.listStatus))}</strong> list is empty.
    </div>`;
  } else {
    grid.innerHTML = entries.map(renderListEntryRow).join('');
    // Attach swipe + tap handlers
    Array.from(grid.children).forEach((wrap, i) => {
      if (entries[i]) attachListRowHandlers(wrap, entries[i]);
    });
    // Warm the top few rows — tapping a top-of-list show is the most
    // common action from Home, and touch has no hover to trigger the
    // usual prefetch path. Fires on idle so it never delays the render.
    _idle(() => {
      entries.slice(0, 4).forEach((e) => e?.media?.id && prefetchMedia(e.media.id));
    });
  }
}

// ============ SOCIAL TAB (friends-only activity feed) ============
let socialReqId = 0;
let socialScroller = null;
let socialMode = null;

function formatRelativeTime(unixSeconds) {
  if (!unixSeconds) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function activityActionText(act) {
  if (act.type === 'TEXT') return ''; // text activities render text body separately
  const status = act.status || '';
  // AniList sends this as a ready-made lowercase phrase ("watched episode",
  // "rewatched episode", "plans to watch", "paused watching", "completed",
  // "dropped") — NOT the MediaListStatus enum (CURRENT/COMPLETED/...) despite
  // the field being named `status` on both types. Comparing against the enum
  // here always missed, which is why this used to fall through to echoing
  // the bare phrase with no episode number.
  const episodeMatch = status.match(/^(.*?)\s*episode$/i);
  if (episodeMatch && act.progress) {
    // `progress` is a string, and can be a range like "13 - 14" when someone
    // binges several episodes between AniList syncs, not just a single number.
    const raw = String(act.progress).trim();
    const isRange = raw.includes('-');
    const label = raw.replace(/\s*-\s*/g, '-');
    const verb = episodeMatch[1].charAt(0).toUpperCase() + episodeMatch[1].slice(1);
    return `${verb} ${isRange ? 'episodes' : 'episode'} <strong>${escapeHtml(label)}</strong>`;
  }
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '';
}

function renderReply(r) {
  const ru = r.user;
  const ravatar = ru?.avatar?.large || ru?.avatar?.medium || '';
  return `
    <div class="activity-reply">
      <div class="activity-reply-avatar" style="background-image:url('${ravatar}');"></div>
      <div class="activity-reply-body">
        <div class="activity-reply-head">
          <span class="activity-reply-user">${escapeHtml(ru?.name || 'unknown')}</span>
          <span class="activity-reply-time">${formatRelativeTime(r.createdAt)}</span>
        </div>
        <div class="activity-reply-text">${escapeHtml((r.text || '').slice(0, 600))}</div>
      </div>
    </div>
  `;
}

function renderActivity(act) {
  if (!act) return '';
  const u = act.user;
  const avatar = u?.avatar?.large || u?.avatar?.medium || '';
  const name = u?.name || 'someone';
  const time = formatRelativeTime(act.createdAt);
  const likes = act.likeCount || 0;
  const replies = act.replyCount || 0;
  const liked = !!act.isLiked;
  const isText = act.type === 'TEXT';
  const m = act.media;
  // Carried as JSON and turned into DOM on first expand (see toggleReplyPanel)
  // rather than rendered up front for every card in the feed.
  const replyData = escapeHtml(JSON.stringify(act.replies || []));

  // Compact two-line body: action + anime title inline, then reactions.
  // Anime cover floats on the right as a small thumb so each card stays
  // ~80px tall instead of the previous ~180px stacked layout.
  const contentInner = isText
    ? `<div class="activity-text">${escapeHtml(act.text || '').slice(0, 600)}</div>`
    : (() => {
        // "of" reads right after "watched episode 5" but not after
        // "Completed" / "Dropped" / "Plans to watch" — only insert it for
        // the episode-progress phrasing.
        const connector = /episode$/i.test(act.status || '') ? ' of ' : ' ';
        const title = m ? `${connector}<strong>${escapeHtml(pickTitle(m.title) || 'Unknown')}</strong>` : '';
        return `<div class="activity-content">${activityActionText(act)}${title}</div>`;
      })();

  const thumb = (!isText && m)
    ? `<div class="activity-thumb" data-media-id="${m.id}" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">${coverImg(m.coverImage?.large)}</div>`
    : '';

  const uid = u?.id || 0;
  return `
    <div class="activity-card" data-activity-id="${act.id}">
      <div class="activity-avatar user-tap" data-user-id="${uid}" data-user-name="${escapeHtml(name)}">${coverImg(avatar)}</div>
      <div class="activity-body">
        <div class="activity-meta-row">
          <span class="activity-user user-tap" data-user-id="${uid}" data-user-name="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="activity-time">· ${time}</span>
        </div>
        ${contentInner}
        <div class="activity-footer">
          <button class="activity-action-btn like-btn${liked ? ' liked' : ''}" data-activity-id="${act.id}">
            <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${likes}</span>
          </button>
          <button class="activity-action-btn reply-toggle" data-activity-id="${act.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span class="reply-count">${replies}</span>
          </button>
        </div>
        <div class="activity-replies" data-activity-id="${act.id}" data-replies="${replyData}">
          <div class="activity-reply-list"></div>
          <form class="activity-reply-form" data-activity-id="${act.id}">
            <input class="activity-reply-input" type="text" placeholder="Reply…" maxlength="500" />
            <button class="activity-reply-send" type="submit">Send</button>
          </form>
        </div>
      </div>
      ${thumb}
    </div>
  `;
}

async function loadSocial() {
  const feed = document.getElementById('social-feed');
  if (!feed) return;
  const myReq = ++socialReqId;

  const activityBody = `
    ... on ListActivity {
      id type status progress createdAt likeCount replyCount isLiked
      user { id name avatar { large medium } }
      media { id title { userPreferred english romaji } coverImage { large color } type }
      replies { id text createdAt user { id name avatar { large medium } } }
    }
    ... on TextActivity {
      id type text createdAt likeCount replyCount isLiked
      user { id name avatar { large medium } }
      replies { id text createdAt user { id name avatar { large medium } } }
    }`;

  // Page 1 picks the mode (friends-first, fall back to global). Pages 2+
  // stick with whatever page 1 decided so the user doesn't see modes
  // interleave as they scroll. socialMode lives at module scope so the
  // scroller's captured closure stays in sync across reloads.
  //
  // Filter to anime + text at the API level with type_in. Previously we
  // pulled every activity type (manga, message, etc.) and threw away most
  // of them client-side, which frequently left the feed looking empty.
  const rawItems = (data) => data?.Page?.activities || [];
  const friendsQ = () =>
    `query ($page: Int) { Page(page: $page, perPage: 25) { pageInfo { hasNextPage } activities(isFollowing: true, type_in: [ANIME_LIST, TEXT], sort: ID_DESC) { ${activityBody} } } }`;
  const globalQ = () =>
    `query ($page: Int) { Page(page: $page, perPage: 25) { pageInfo { hasNextPage } activities(type_in: [ANIME_LIST, TEXT], sort: ID_DESC) { ${activityBody} } } }`;

  if (!socialScroller) {
    const scrollEl = document.getElementById('content');
    socialScroller = setupInfiniteScroll(feed, scrollEl, async (page) => {
      if (page === 1) {
        // isFollowing needs a valid token — signed-out users skip straight
        // to the global feed so they see something instead of an error.
        if (!state.user) {
          socialMode = 'global';
          const g = await anilist(globalQ(), { page });
          return {
            items: rawItems(g),
            hasMore: g?.Page?.pageInfo?.hasNextPage || false,
          };
        }
        socialMode = null;
        const data = await anilist(friendsQ(), { page });
        const items = rawItems(data);
        if (items.length > 0) {
          socialMode = 'friends';
          return { items, hasMore: data?.Page?.pageInfo?.hasNextPage || false };
        }
        // Friends had nothing — fall back to everyone
        socialMode = 'global';
        const g = await anilist(globalQ(), { page });
        return {
          items: rawItems(g),
          hasMore: g?.Page?.pageInfo?.hasNextPage || false,
        };
      }
      const q = socialMode === 'friends' ? friendsQ() : globalQ();
      const data = await anilist(q, { page });
      return {
        items: rawItems(data),
        hasMore: data?.Page?.pageInfo?.hasNextPage || false,
      };
    }, renderActivity, attachActivityHandlers, (el) => {
      el.innerHTML = Array(5).fill(`
        <div class="activity-card">
          <div class="activity-avatar skeleton"></div>
          <div class="activity-body">
            <div class="skeleton" style="height: 14px; width: 40%; border-radius: 4px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="height: 52px; border-radius: 8px;"></div>
          </div>
        </div>
      `).join('');
    });
  }

  await socialScroller.reload();
  if (socialReqId !== myReq) return;

  // Different explanations for "signed out → global" vs "signed in but no
  // followed friends → global". Both prepend a notice so the user knows
  // what feed they're looking at.
  if (socialMode === 'global') {
    const notice = !state.user
      ? `<strong>Showing everyone's activity.</strong> Sign in to see updates from people you follow on AniList.`
      : `<strong>You don't have any followed friends with recent activity.</strong> Showing everyone's activity below — follow people on AniList to see them here first.`;
    feed.insertAdjacentHTML('afterbegin', `<div class="social-fallback-notice">${notice}</div>`);
  }
}

// ============ SINGLE ACTIVITY OVERLAY ============
// "X liked your activity" used to open X's profile, because there was
// nowhere else to go. This is the somewhere else: the post itself, rendered
// by the same renderActivity/attachActivityHandlers pair the Social feed
// uses, so likes and replies work here exactly as they do there.
let activityReqId = 0;

async function openActivity(activityId) {
  const id = parseInt(activityId, 10);
  if (!id) return;
  const body = document.getElementById('activity-body');
  if (!body) return;
  const myReq = ++activityReqId;

  document.getElementById('activity-overlay').classList.add('visible');
  body.innerHTML = `
    <div class="activity-card">
      <div class="activity-avatar skeleton"></div>
      <div class="activity-body">
        <div class="skeleton" style="height: 14px; width: 40%; border-radius: 4px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 52px; border-radius: 8px;"></div>
      </div>
    </div>`;

  // Same selection set as the feed, so renderActivity gets everything it
  // expects. MessageActivity is included here but not in the feed: it can't
  // appear in a public list, but you can certainly be notified about one.
  const q = `query ($id: Int) {
    Activity(id: $id) {
      ... on ListActivity {
        id type status progress createdAt likeCount replyCount isLiked
        user { id name avatar { large medium } }
        media { id title { userPreferred english romaji } coverImage { large color } type }
        replies { id text createdAt user { id name avatar { large medium } } }
      }
      ... on TextActivity {
        id type text createdAt likeCount replyCount isLiked
        user { id name avatar { large medium } }
        replies { id text createdAt user { id name avatar { large medium } } }
      }
      ... on MessageActivity {
        id type message createdAt likeCount replyCount isLiked
        user: messenger { id name avatar { large medium } }
        replies { id text createdAt user { id name avatar { large medium } } }
      }
    }
  }`;

  let act = null;
  try {
    const data = await anilist(q, { id });
    act = data?.Activity || null;
  } catch (e) { /* handled by the empty state below */ }
  if (myReq !== activityReqId) return;

  if (!act) {
    body.innerHTML = `
      <div class="empty" style="padding: 40px 20px;">
        <div class="empty-title">Couldn’t load this activity</div>
        <div class="empty-text">It may have been deleted, or belong to a private account.</div>
      </div>`;
    return;
  }

  body.innerHTML = renderActivity(act);
  attachActivityHandlers(body);
}
window.openActivity = openActivity;

// Wire taps, likes, reply expansion + submission for every activity card in the feed
// Wired ONCE per feed element, not per card. The infinite scroller appends
// pages into this same container, so per-card binding stacked a fresh set of
// listeners on every previously-rendered card each time a page loaded — after
// N pages a page-1 card had N handlers, and a single reply tap fired
// SaveActivityReply N times (posting the same reply N times to AniList).
// Delegation means listener count is constant no matter how far you scroll,
// and newly appended cards work with no extra wiring.
function attachActivityHandlers(feed) {
  if (feed.dataset.delegated === '1') return;
  feed.dataset.delegated = '1';

  feed.addEventListener('click', (e) => {
    // Order matters: check the most specific targets first, since a tap on
    // the avatar is also inside the card.
    const userEl = e.target.closest('.user-tap');
    if (userEl && feed.contains(userEl)) {
      e.stopPropagation();
      const id = parseInt(userEl.dataset.userId, 10);
      const name = userEl.dataset.userName;
      if (id > 0 && name) openUser(id, name);
      return;
    }

    const thumb = e.target.closest('.activity-thumb');
    if (thumb && feed.contains(thumb)) {
      const id = parseInt(thumb.dataset.mediaId, 10);
      if (!isNaN(id)) openMedia(id);
      return;
    }

    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn && feed.contains(likeBtn)) {
      e.stopPropagation();
      handleLikeTap(likeBtn);
      return;
    }

    const replyToggle = e.target.closest('.reply-toggle');
    if (replyToggle && feed.contains(replyToggle)) {
      toggleReplyPanel(feed, replyToggle);
      return;
    }
  });

  feed.addEventListener('submit', (e) => {
    const form = e.target.closest('.activity-reply-form');
    if (!form || !feed.contains(form)) return;
    e.preventDefault();
    submitReply(form);
  });
}

async function handleLikeTap(btn) {
  if (!state.user) return openSignInModal();
  const id = parseInt(btn.dataset.activityId, 10);
  if (isNaN(id)) return;
  // Guard against double-fire from an impatient double tap — the mutation
  // is a toggle, so two in flight would cancel each other out.
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const mutation = `mutation ($id: Int) {
    ToggleLikeV2(id: $id, type: ACTIVITY) { ... on ListActivity { id likeCount isLiked } ... on TextActivity { id likeCount isLiked } }
  }`;
  try {
    const data = await anilist(mutation, { id });
    const updated = data?.ToggleLikeV2;
    if (updated) {
      btn.classList.toggle('liked', updated.isLiked);
      const countEl = btn.querySelector('span');
      if (countEl) countEl.textContent = updated.likeCount;
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', updated.isLiked ? 'currentColor' : 'none');
    }
  } finally {
    delete btn.dataset.busy;
  }
}

function toggleReplyPanel(feed, btn) {
  const id = btn.dataset.activityId;
  const panel = feed.querySelector(`.activity-replies[data-activity-id="${id}"]`);
  if (!panel) return;
  panel.classList.toggle('open');
  if (!panel.classList.contains('open')) return;

  ensureRepliesRendered(panel);

  const input = panel.querySelector('.activity-reply-input');
  if (input) setTimeout(() => input.focus(), 50);
}

// Replies are rendered on first expand rather than up front — building the
// full list for every card in the feed was wasted DOM for panels that stay
// collapsed. The JSON rides along in a data attribute set by renderActivity.
// Idempotent, so both the expand path and the post-reply path can call it.
function ensureRepliesRendered(panel) {
  const list = panel?.querySelector('.activity-reply-list');
  if (!list || list.dataset.rendered === '1') return list;
  list.dataset.rendered = '1';
  let replies = [];
  try { replies = JSON.parse(panel.dataset.replies || '[]'); } catch (err) {}
  if (replies.length) list.innerHTML = replies.map(renderReply).join('');
  delete panel.dataset.replies;  // free the payload once it's DOM
  return list;
}

async function submitReply(form) {
  if (!state.user) return openSignInModal();
  const input = form.querySelector('.activity-reply-input');
  const text = input.value.trim();
  if (!text) return;
  const sendBtn = form.querySelector('.activity-reply-send');
  if (sendBtn.disabled) return;
  sendBtn.disabled = true;
  const activityId = parseInt(form.dataset.activityId, 10);
  const mutation = `mutation ($activityId: Int, $text: String) {
    SaveActivityReply(activityId: $activityId, text: $text) {
      id text createdAt user { id name avatar { large medium } }
    }
  }`;
  try {
    const data = await anilist(mutation, { activityId, text });
    const reply = data?.SaveActivityReply;
    if (reply) {
      // Render any stored replies first, so appending can't leave the new one
      // as the only entry (and can't be clobbered by a later lazy render).
      const list = ensureRepliesRendered(form.closest('.activity-replies'));
      if (list) list.insertAdjacentHTML('beforeend', renderReply(reply));
      input.value = '';
      const card = form.closest('.activity-card');
      const count = card?.querySelector('.reply-count');
      if (count) count.textContent = (parseInt(count.textContent || '0', 10) + 1);
    }
  } finally {
    sendBtn.disabled = false;
  }
}

// ============ CATEGORY OVERLAY ("See all") ============

async function openCategory(sort, type, title, opts = {}) {
  categoryState.sort = sort;
  categoryState.type = type;
  categoryState.isSeasonal = !!opts.season;
  document.getElementById('category-title').textContent = title;
  document.getElementById('category-sort-label').textContent = labelForSort(sort);
  // Hide the sort dropdown for categories that ARE the sort (Trending / Top / Popular)
  const sortBar = document.querySelector('#category-overlay .sort-trigger-bar');
  if (sortBar) sortBar.style.display = opts.noSort ? 'none' : '';
  document.getElementById('category-overlay').classList.add('visible');
  loadCategory();
}

// Lazily initialized infinite-scroll scroller for the See-All grid.
// One scroller instance handles every category — `reload()` re-fetches
// from page 1 whenever the user opens a new category or changes the sort.
let categoryScroller = null;

async function loadCategory() {
  if (!categoryScroller) {
    const grid = document.getElementById('category-grid');
    const scrollEl = document.querySelector('#category-overlay .overlay-body');
    categoryScroller = setupInfiniteScroll(grid, scrollEl, async (page) => {
      const seasonClause = categoryState.isSeasonal ? `season: ${state.season}, seasonYear: ${state.seasonYear},` : '';
      const q = `query ($page: Int) {
        Page(page: $page, perPage: 25) {
          pageInfo { hasNextPage }
          media(${seasonClause} sort: ${categoryState.sort}, type: ${categoryState.type}, isAdult: false) { ${MEDIA_FRAGMENT} }
        }
      }`;
      const data = await anilist(q, { page });
      return {
        items: data?.Page?.media || [],
        hasMore: data?.Page?.pageInfo?.hasNextPage || false,
      };
    }, null, null, (el) => skeletonFill(el, 12));
  }
  await categoryScroller.reload();
}

document.getElementById('category-sort-btn').addEventListener('click', () => {
  openSortModal(categoryState.sort, (newSort) => {
    categoryState.sort = newSort;
    document.getElementById('category-sort-label').textContent = labelForSort(newSort);
    loadCategory();
  });
});

// ============ LAYER DISMISSAL / FOCUS ============
// Overlays and modals stack (overlays 100-105, modals 200, lightbox 10000),
// so Escape has to close the TOP one rather than all of them or an arbitrary
// one. Anything not listed here is a plain .overlay and just loses .visible.
const LAYER_CLOSERS = {
  'lightbox':        () => closeLightbox(),
  'sort-modal':      () => closeSortModal(),
  'theme-modal':     () => closeThemeModal(),
  'list-edit-modal': () => closeListEditSheet(),
  'rate-modal':      () => closeRateModal(),
  'signin-modal':    () => closeSignInModal(),
};
const LAYER_SELECTOR = '.modal-backdrop, .overlay, .lightbox';

function closeTopLayer() {
  const open = Array.from(document.querySelectorAll(LAYER_SELECTOR))
    .filter((el) => el.classList.contains('visible'));
  if (!open.length) return false;
  // Read the painted z-index rather than the inline attribute — several
  // overlays get theirs from the stylesheet, not from a style="" attribute.
  const z = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
  const top = open.reduce((a, b) => (z(b) >= z(a) ? b : a));
  const closer = LAYER_CLOSERS[top.id];
  if (closer) closer();
  else closeOverlay(top.id);
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closeTopLayer()) e.preventDefault();
});

// Returning focus to whatever opened a layer, so closing one doesn't strand
// keyboard focus at the top of the document. Watching the class attribute
// means every layer is covered without touching any of the open/close call
// sites — including ones added later.
//
// Focus is deliberately NOT moved INTO the layer on open: on mobile that can
// scroll the page or raise the keyboard when the first focusable happens to
// be a text field, which would be a visible regression for the common case.
const _layerFocusReturn = new WeakMap();
new MutationObserver((mutations) => {
  for (const m of mutations) {
    const el = m.target;
    if (!(el instanceof HTMLElement) || !el.matches(LAYER_SELECTOR)) continue;
    const visible = el.classList.contains('visible');
    const tracked = _layerFocusReturn.has(el);
    if (visible && !tracked) {
      _layerFocusReturn.set(el, document.activeElement);
    } else if (!visible && tracked) {
      const prev = _layerFocusReturn.get(el);
      _layerFocusReturn.delete(el);
      if (prev && prev !== document.body && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch (err) {}
      }
    }
  }
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

function closeOverlay(id) {
  document.getElementById(id).classList.remove('visible');
}

// ============ GENRE OVERLAY ============

async function openGenre(genre, type) {
  genreState.genre = genre;
  genreState.type = type || 'ANIME';
  genreState.sort = 'POPULARITY_DESC';
  document.getElementById('genre-title').textContent = genre;
  document.getElementById('genre-sort-label').textContent = labelForSort(genreState.sort);
  document.getElementById('genre-overlay').classList.add('visible');
  loadGenre();
}

let genreScroller = null;
async function loadGenre() {
  const grid = document.getElementById('genre-grid');
  if (!grid) return;

  if (!genreScroller) {
    // Overlays scroll their own .overlay-body, not #content — using the wrong
    // root makes the IntersectionObserver never fire and pagination stall.
    const scrollEl = grid.closest('.overlay-body');
    genreScroller = setupInfiniteScroll(grid, scrollEl, async (page) => {
      const q = `query ($genre: String, $type: MediaType, $sort: [MediaSort], $page: Int) {
        Page(page: $page, perPage: 30) {
          pageInfo { hasNextPage }
          media(genre: $genre, type: $type, sort: $sort, isAdult: false) {
            ${MEDIA_FRAGMENT}
          }
        }
      }`;
      const data = await anilist(q, {
        genre: genreState.genre, type: genreState.type, sort: [genreState.sort], page,
      });
      return {
        items: data?.Page?.media || [],
        hasMore: data?.Page?.pageInfo?.hasNextPage || false,
      };
    }, null, null, (el) => skeletonFill(el, 12), 'No results for this genre.');
  }

  await genreScroller.reload();
}

document.getElementById('genre-sort-btn').addEventListener('click', () => {
  openSortModal(genreState.sort, (newSort) => {
    genreState.sort = newSort;
    document.getElementById('genre-sort-label').textContent = labelForSort(newSort);
    loadGenre();
  });
});

// ============ STUDIO OVERLAY ============

// Studio gets one extra sort option (Oldest) on top of the standard set
const STUDIO_SORT_OPTIONS = [
  { value: 'POPULARITY_DESC', label: 'Popular' },
  { value: 'SCORE_DESC',      label: 'Top Rated' },
  { value: 'TRENDING_DESC',   label: 'Trending' },
  { value: 'START_DATE_DESC', label: 'Newest' },
  { value: 'START_DATE',      label: 'Oldest' },
];
function studioSortLabel(v) {
  return STUDIO_SORT_OPTIONS.find(o => o.value === v)?.label || 'Sort';
}

async function openStudio(id, name) {
  studioState.id = id;
  studioState.name = name;
  studioState.sort = 'POPULARITY_DESC';
  document.getElementById('studio-title').textContent = name;
  document.getElementById('studio-sort-label').textContent = studioSortLabel(studioState.sort);
  document.getElementById('studio-overlay').classList.add('visible');
  loadStudio();
}

let studioScroller = null;
async function loadStudio() {
  const grid = document.getElementById('studio-grid');
  if (!grid) return;

  if (!studioScroller) {
    const scrollEl = grid.closest('.overlay-body');
    studioScroller = setupInfiniteScroll(grid, scrollEl, async (page) => {
      // AniList's Studio.media DOES NOT accept a `type` argument — including
      // one returns a 400 error and the overlay shows nothing.
      // (Studios only produce anime so the filter was always redundant anyway.)
      //
      // edges (not nodes) because only the edge carries isMainStudio, which
      // separates "we animated this" from "we were a production committee
      // member". Without it, Production I.G lists all of Attack on Titan,
      // which WIT animated.
      const q = `query ($id: Int, $sort: [MediaSort], $page: Int) {
        Studio(id: $id) {
          media(sort: $sort, page: $page, perPage: 30) {
            pageInfo { hasNextPage }
            edges { isMainStudio node { ${MEDIA_FRAGMENT} } }
          }
        }
      }`;
      const data = await anilist(q, { id: studioState.id, sort: [studioState.sort], page });

      // Dedup against what's actually on screen rather than a shared Set.
      // A Set mutated inside this fetcher gets poisoned by stale requests:
      // switching sort resets it, but an in-flight fetch from the PREVIOUS
      // sort then resolves, marks all its ids as seen, and only afterwards
      // gets discarded by the reqId guard — so the new sort's first page was
      // deduped down to nothing and the overlay claimed "No works found".
      // The DOM can't be poisoned that way; stale results never reach it.
      const seen = new Set(
        Array.from(grid.querySelectorAll('.card[data-media-id]'), (el) => el.dataset.mediaId)
      );
      // Adding to `seen` as we go also covers duplicates WITHIN one page —
      // AniList can credit the same studio twice on one title.
      const items = (data?.Studio?.media?.edges || [])
        .filter((e) => {
          if (!e?.isMainStudio || !e.node) return false;
          const key = String(e.node.id);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((e) => e.node);

      return {
        items,
        hasMore: data?.Studio?.media?.pageInfo?.hasNextPage || false,
      };
    }, null, null, (el) => skeletonFill(el, 12), 'No animation works found.');
  }

  await studioScroller.reload();
}

document.getElementById('studio-sort-btn').addEventListener('click', () => {
  openSortModal(studioState.sort, (newSort) => {
    studioState.sort = newSort;
    document.getElementById('studio-sort-label').textContent = studioSortLabel(newSort);
    loadStudio();
  }, 'Sort Studio Works', STUDIO_SORT_OPTIONS);
});


// ============ CHARACTER OVERLAY ============
let currentMedia = null;

function openCharacter(charId) {
  const edge = currentMedia?.characters?.edges?.find(e => e.node.id === charId);
  if (!edge) return;
  const char = edge.node;
  const vas = edge.voiceActors || [];
  document.getElementById('character-title').textContent = char.name?.userPreferred || 'Character';
  const body = document.getElementById('character-body');

  // Deliberately the same shape as the voice-actor screen: .staff-hero for
  // the subject, then full-width rows. This page used to be the odd one out
  // — its own hero treatment and an inset rounded card — which made it read
  // as a different app from every other overlay.
  const sub = edge.role ? `${edge.role.toLowerCase()} character` : 'Character';
  body.innerHTML = `
    <div class="staff-hero">
      <div class="staff-hero-image" style="background-image:url('${char.image?.large || ''}');"></div>
      <div class="staff-hero-info">
        <div class="staff-hero-name">${escapeHtml(char.name?.userPreferred || '')}</div>
        <div class="staff-hero-sub">${escapeHtml(sub)}</div>
      </div>
    </div>
    ${vas.length ? `
      <div class="va-list">
        ${vas.map(va => `
          <div class="va-row" data-va-id="${va.id}" data-va-name="${escapeHtml(va.name?.userPreferred || '')}">
            <div class="va-image" style="background-image:url('${va.image?.large || ''}');"></div>
            <div class="va-info">
              <div class="va-name">${escapeHtml(va.name?.userPreferred || '')}</div>
              <div class="va-lang">${escapeHtml(va.languageV2 || 'Voice actor')}</div>
            </div>
            <svg class="va-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="no-results">No voice actors listed for this character.</div>
    `}
  `;
  body.querySelectorAll('.va-row').forEach(row => {
    row.addEventListener('click', () => {
      openVA(parseInt(row.dataset.vaId, 10), row.dataset.vaName);
    });
  });
  document.getElementById('character-overlay').classList.add('visible');
}

// ============ STAFF (VOICE ACTOR) OVERLAY ============

// Staff (VA) uses CharacterSort — different enum from MediaSort
// characterMedia sorts by MediaSort, not CharacterSort — see loadStaff for
// why we query that field. MAIN_ROLES has no MediaSort equivalent, so it
// fetches by popularity and reorders the page client-side.
const STAFF_SORT_OPTIONS = [
  { value: 'POPULARITY_DESC', label: 'Popular' },
  { value: 'MAIN_ROLES',      label: 'Main Roles' },
  { value: 'START_DATE_DESC', label: 'Newest' },
];
function staffSortLabel(v) {
  return STAFF_SORT_OPTIONS.find(o => o.value === v)?.label || 'Sort';
}

async function openVA(id, name) {
  staffState.id = id;
  staffState.name = name;
  staffState.sort = 'POPULARITY_DESC';
  document.getElementById('staff-title').textContent = name;
  document.getElementById('staff-sort-label').textContent = staffSortLabel(staffState.sort);
  loadStaffHero(id);
  document.getElementById('staff-overlay').classList.add('visible');
  loadStaff();
}

document.getElementById('staff-sort-btn').addEventListener('click', () => {
  openSortModal(staffState.sort, (newSort) => {
    staffState.sort = newSort;
    document.getElementById('staff-sort-label').textContent = staffSortLabel(newSort);
    loadStaff();
  }, 'Sort by', STAFF_SORT_OPTIONS);
});

async function loadStaffHero(id) {
  const hero = document.getElementById('staff-hero');
  hero.innerHTML = `
    <div class="staff-hero">
      <div class="staff-hero-image skeleton"></div>
      <div class="staff-hero-info">
        <div class="skeleton" style="height: 18px; width: 60%; border-radius: 4px;"></div>
        <div class="skeleton" style="height: 12px; width: 40%; border-radius: 4px; margin-top: 6px;"></div>
      </div>
    </div>
  `;
  const q = `query ($id: Int) { Staff(id: $id) { name { userPreferred } image { large } languageV2 primaryOccupations } }`;
  const data = await anilist(q, { id });
  const s = data?.Staff;
  if (!s) return;
  const sub = s.languageV2 ? `${s.languageV2} voice actor` : (s.primaryOccupations?.[0] || 'Staff');
  hero.innerHTML = `
    <div class="staff-hero">
      <div class="staff-hero-image" style="background-image:url('${s.image?.large || ''}');"></div>
      <div class="staff-hero-info">
        <div class="staff-hero-name">${escapeHtml(s.name?.userPreferred || '')}</div>
        <div class="staff-hero-sub">${escapeHtml(sub)}</div>
      </div>
    </div>
  `;
}

let staffScroller = null;
async function loadStaff() {
  const grid = document.getElementById('staff-grid');
  if (!grid) return;

  // One delegated listener on the grid instead of one per card. Binding
  // per-card here would restack handlers on every appended page, the same
  // way it did in the Social feed.
  if (grid.dataset.delegated !== '1') {
    grid.dataset.delegated = '1';
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.va-role-row');
      if (!card || !grid.contains(card)) return;
      const id = parseInt(card.dataset.mediaId, 10);
      if (!isNaN(id)) openMedia(id);
    });
  }

  if (!staffScroller) {
    const scrollEl = grid.closest('.overlay-body');
    staffScroller = setupInfiniteScroll(grid, scrollEl, async (page) => {
      // characterMedia, not characters. Staff.characters returns a CHARACTER
      // connection — its edges are shaped around the character, and the
      // media on them isn't reliably populated. Every row needs a show, so
      // the renderer dropped edges without one and the screen came up empty
      // with no error to explain it. characterMedia is the media-shaped view
      // of the same relationship: one edge per show, carrying the characters
      // played in it, which is exactly a row.
      //
      // perPage 20: two screens' worth at any density, and each edge now
      // carries a cover, so the page is heavier than the old character-only
      // one. The observer prefetches 400px early, so a smaller page still
      // arrives before the user reaches the end.
      const q = `query ($id: Int, $sort: [MediaSort], $page: Int) {
        Staff(id: $id) {
          characterMedia(sort: $sort, page: $page, perPage: 20) {
            pageInfo { hasNextPage }
            edges {
              characterRole
              characters { id name { userPreferred } image { large } }
              node {
                id
                type
                title { userPreferred english romaji }
                coverImage { large color }
              }
            }
          }
        }
      }`;
      const apiSort = staffState.sort === 'MAIN_ROLES' ? 'POPULARITY_DESC' : staffState.sort;
      const data = await anilist(q, { id: staffState.id, sort: [apiSort], page });
      const conn = data?.Staff?.characterMedia;
      let edges = conn?.edges || [];
      if (staffState.sort === 'MAIN_ROLES') {
        const rank = (e) => (e?.characterRole === 'MAIN' ? 0 : e?.characterRole === 'SUPPORTING' ? 1 : 2);
        edges = edges.slice().sort((a, b) => rank(a) - rank(b));
      }
      return {
        items: edges,
        hasMore: conn?.pageInfo?.hasNextPage || false,
      };
    }, renderVACharCard, null, (el) => skeletonFillVARoles(el, 8), 'No roles found.');
  }

  await staffScroller.reload();
}


// ============ MEDIA DETAIL ============
// Fetches list entries from people you follow who have this anime, then
// renders a horizontal row of their avatars above the Genres section.
// Signed-in only — `isFollowing: true` needs auth to know who "you" are.
async function loadDetailFriends(mediaId) {
  const section = document.getElementById('detail-friends');
  if (!section) return;
  const q = `query ($mediaId: Int) {
    Page(page: 1, perPage: 30) {
      mediaList(mediaId: $mediaId, isFollowing: true, sort: UPDATED_TIME_DESC) {
        userId status score progress
        user { id name avatar { medium large } }
      }
    }
  }`;
  let entries;
  try {
    const data = await anilist(q, { mediaId });
    entries = data?.Page?.mediaList || [];
  } catch (e) {
    return; // silently fail — this is a nice-to-have, not core content
  }
  // Bail if the user opened a different anime while we were fetching
  if (!currentMedia || currentMedia.id !== mediaId) return;
  if (!entries.length) return; // leave section hidden

  const STATUS_TITLES = {
    CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed',
    PAUSED: 'Paused', DROPPED: 'Dropped', REPEATING: 'Rewatching',
  };
  const avatars = entries
    .filter(e => e?.user?.id && e?.user?.name)
    .map((e) => {
      const src = e.user.avatar?.medium || e.user.avatar?.large || '';
      const status = e.status || '';
      const title = `${e.user.name} · ${STATUS_TITLES[status] || 'On list'}${e.score ? ` · ${e.score}★` : ''}`;
      return `
        <div class="friend-avatar user-tap" data-user-id="${e.user.id}" data-user-name="${escapeHtml(e.user.name)}" data-status="${escapeHtml(status)}" title="${escapeHtml(title)}">
          <div class="friend-avatar-img" style="background-image:url('${src}');"></div>
          <div class="friend-avatar-name">${escapeHtml(e.user.name)}</div>
        </div>`;
    }).join('');

  section.innerHTML = `
    <h4>Friends</h4>
    <div class="friends-avatars">${avatars}</div>
  `;
  section.hidden = false;

  section.querySelectorAll('.user-tap').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = parseInt(el.dataset.userId, 10);
      const uname = el.dataset.userName;
      if (uid > 0 && uname) openUser(uid, uname);
    });
  });
}

// Bumped on every openMedia so a slow response for an anime the user has
// already navigated away from can't overwrite the one they're looking at.
let detailReqId = 0;

// Fetches the below-the-fold sections and fills in the placeholders left by
// openMedia. Every write re-checks that the user is still on the same anime,
// since this resolves well after the core render.
// Placeholders for the below-the-fold sections, shown the moment the detail
// renders. Previously these stayed `hidden` until their data arrived, so the
// page looked finished — streaming links and the trailer come from the CORE
// query and were already there — while three sections were still missing, then
// appeared and shoved everything down. A skeleton says "more is coming here"
// and reserves the right amount of room.
function showDetailSkeletons(body) {
  const relCarousel = body.querySelector('[data-relations-carousel]');
  const recsCarousel = body.querySelector('[data-recs-carousel]');
  const charsRow = body.querySelector('[data-chars-row]');
  if (relCarousel) { skeletonFill(relCarousel, 4); body.querySelector('[data-relations-section]').hidden = false; }
  if (recsCarousel) { skeletonFill(recsCarousel, 4); body.querySelector('[data-recs-section]').hidden = false; }
  if (charsRow) {
    charsRow.innerHTML = Array(4).fill(`
      <div class="character-card">
        <div class="character-image skeleton"></div>
        <div class="skeleton" style="height: 11px; width: 80%; margin: 6px auto 0; border-radius: 4px;"></div>
      </div>
    `).join('');
    body.querySelector('[data-chars-section]').hidden = false;
  }
}

// A section that never got data shouldn't sit there as a permanent skeleton.
// Hide it and drop the placeholders — leaving them in a hidden container keeps
// dead nodes (and their shimmer animation) alive for nothing.
function clearSection(body, sectionSel) {
  const section = body.querySelector(sectionSel);
  if (!section) return;
  section.hidden = true;
  const holder = section.querySelector('.carousel, .character-row');
  if (holder) holder.innerHTML = '';
}

async function loadDetailExtras(mediaId, body, pendingCards, pendingChars) {
  const myReq = detailReqId;
  const stale = () => myReq !== detailReqId || !currentMedia || currentMedia.id !== mediaId;

  // The two halves are independent — awaiting them together would put the
  // light one back behind the heavy one, which is the whole thing being fixed.
  await Promise.all([
    renderDetailCards(mediaId, body, stale, pendingCards),
    renderDetailCharacters(mediaId, body, stale, pendingChars),
  ]);
}

// Characters: the heavy half (12 characters, each with a voiceActors array).
async function renderDetailCharacters(mediaId, body, stale, pending) {
  let data = null;
  try {
    const q = `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CHARACTERS} } }`;
    data = (await (pending || anilist(q, { id: mediaId })))?.Media;
  } catch (e) { /* fall through to clearing the skeleton */ }
  if (stale()) return;

  const charEdges = data?.characters?.edges || [];
  const charsRow = body.querySelector('[data-chars-row]');
  if (!charEdges.length || !charsRow) return clearSection(body, '[data-chars-section]');

  // openCharacter looks the tapped character up on currentMedia, which is
  // built from the CORE query — without this the lookup misses and every
  // character tap silently does nothing (the v4.37 regression).
  Object.assign(currentMedia, data);

  charsRow.innerHTML = charEdges.map((e) => `
    <div class="character-card" data-character-id="${e.node.id}">
      <div class="character-image">${coverImg(e.node.image?.large)}</div>
      <div class="character-name">${escapeHtml(e.node.name?.userPreferred || '')}</div>
      <div class="character-role">${e.role ? escapeHtml(e.role.toLowerCase()) : ''}</div>
    </div>
  `).join('');
  body.querySelector('[data-chars-section]').hidden = false;
  // Wired here rather than in openMedia because the cards don't exist until
  // now. Runs once per openMedia, so handlers can't stack.
  charsRow.addEventListener('click', (ev) => {
    const card = ev.target.closest('.character-card');
    if (!card) return;
    const cid = parseInt(card.dataset.characterId, 10);
    if (!isNaN(cid)) openCharacter(cid);
  });
}

// Relations + recommendations: the light half, and the one the user actually
// hits first on the way down the page.
async function renderDetailCards(mediaId, body, stale, pending) {
  let data = null;
  try {
    const q = `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CARDS} } }`;
    data = (await (pending || anilist(q, { id: mediaId })))?.Media;
  } catch (e) { /* fall through to clearing the skeletons */ }
  if (stale()) return;
  if (!data) {
    clearSection(body, '[data-recs-section]');
    clearSection(body, '[data-relations-section]');
    return;
  }
  Object.assign(currentMedia, data);

  // Recommendations
  const recs = (data.recommendations?.edges || [])
    .map((e) => e.node?.mediaRecommendation)
    .filter((r) => r?.type === 'ANIME');
  const recsCarousel = body.querySelector('[data-recs-carousel]');
  if (recs.length && recsCarousel) {
    recsCarousel.innerHTML = recs.map(renderCard).join('');
    body.querySelector('[data-recs-section]').hidden = false;
  } else {
    clearSection(body, '[data-recs-section]');
  }

  // Relations — expandRelations walks PREQUEL/SEQUEL outward so the whole
  // season chain shows, not just the directly adjacent entries.
  const relSection = body.querySelector('[data-relations-section]');
  const relCarousel = body.querySelector('[data-relations-carousel]');
  if (!relSection || !relCarousel) return;

  const direct = filterRelations(data.relations?.edges);
  if (direct.length) {
    relCarousel.innerHTML = direct.map(renderRelationCard).join('');
    relSection.hidden = false;
  } else {
    // Nothing showable yet — drop the skeleton rather than leaving it up while
    // the walk runs. It matters even when relations came back non-empty: a show
    // whose only relation is its source manga filters down to nothing here, and
    // the walk will never find an anime either, so the section would otherwise
    // sit there full of placeholders forever. paint() re-shows it if the walk
    // does turn something up.
    relCarousel.innerHTML = '';
    relSection.hidden = true;
  }
  // Paint each level of the walk as it lands rather than waiting for the whole
  // chain — a long franchise used to sit on the direct relations for seconds.
  const paint = (edges) => {
    if (stale() || !edges.length) return;
    relCarousel.innerHTML = edges.map(renderRelationCard).join('');
    relSection.hidden = false;
  };
  try {
    paint(await expandRelations(data.relations?.edges, mediaId, paint));
  } catch (e) { /* the direct list above stays as the fallback */ }
}

async function openMedia(id) {
  // Tapping a card inside Studio / Character / Staff / Genre / Category
  // would otherwise just update the detail overlay underneath — invisible
  // to the user. Close those first so the detail comes to the front.
  ['studio-overlay', 'character-overlay', 'staff-overlay', 'genre-overlay', 'category-overlay']
    .forEach((overlayId) => {
      const el = document.getElementById(overlayId);
      if (el) el.classList.remove('visible');
    });

  const overlay = document.getElementById('detail-overlay');
  const body = document.getElementById('detail-body');
  document.getElementById('detail-title').textContent = 'Loading…';
  body.innerHTML = `<div style="padding: 40px 20px; text-align:center; color:var(--text-dim);">Loading…</div>`;
  overlay.classList.add('visible');

  const myReq = ++detailReqId;
  // Start the below-the-fold query alongside the core one rather than after
  // it. They're independent, and chaining them cost a full round trip before
  // relations/characters/recommendations could even begin loading. The catch
  // keeps this from becoming an unhandled rejection when we bail out below.
  const cardsPending = anilist(
    `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CARDS} } }`, { id }).catch(() => null);
  const charsPending = anilist(
    `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CHARACTERS} } }`, { id }).catch(() => null);

  const q = `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CORE} } }`;
  const data = await anilist(q, { id });
  if (myReq !== detailReqId) return;   // a newer openMedia superseded this one
  const m = data?.Media;
  if (!m) {
    body.innerHTML = `<div style="padding: 40px 20px; text-align:center; color:var(--text-dim);">Couldn't load details.</div>`;
    return;
  }

  currentMedia = m;
  const titleText = pickTitle(m.title);
  document.getElementById('detail-title').textContent = titleText || 'Detail';
  const desc = (m.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const mainStudio = m.studios?.nodes?.[0];
  const year = m.startDate?.year || '';
  const seasonText = m.season ? `${capitalize(m.season)} ${m.seasonYear}` : year;
  const countText = m.episodes ? `${m.episodes} episodes` : (m.status === 'RELEASING' ? 'Airing' : '');
  const airing = m.nextAiringEpisode ? formatNextEpisode(m.nextAiringEpisode) : '';

  // Build subtitle with clickable studio
  const subParts = [];
  if (mainStudio) {
    subParts.push(`<span class="sub-studio" data-studio-id="${mainStudio.id}" data-studio-name="${escapeHtml(mainStudio.name)}">${escapeHtml(mainStudio.name)}</span>`);
  }
  if (seasonText) subParts.push(escapeHtml(seasonText));
  if (countText) subParts.push(escapeHtml(countText));

  const descLong = desc && desc.length > 280;

  body.innerHTML = `
    <div class="detail-banner" style="background-image:url('${m.bannerImage || m.coverImage?.extraLarge || ''}'); background-color:${m.coverImage?.color || 'var(--surface-2)'};"></div>
    <div class="detail-head">
      <div class="detail-cover" style="background-image:url('${m.coverImage?.extraLarge || m.coverImage?.large || ''}');"></div>
      <div class="detail-titleblock">
        <div class="detail-title">${escapeHtml(titleText)}</div>
        <div class="detail-sub">${subParts.join(' · ')}</div>
      </div>
    </div>
    <div class="detail-stats">
      ${(() => {
        // If the user is signed in and has rated, prefer their score; otherwise show community avg.
        const userScore = m.mediaListEntry?.score;
        if (state.accessToken && userScore > 0) {
          return `<div class="stat-pill score-clickable user-score" id="detail-score-pill" title="Tap to change your rating"><strong>${userScore}</strong>★ your rating</div>`;
        }
        if (m.averageScore) {
          const clickable = state.accessToken ? ' score-clickable' : '';
          const id = state.accessToken ? ' id="detail-score-pill"' : '';
          const hint = state.accessToken ? ' title="Tap to rate"' : '';
          return `<div class="stat-pill${clickable}"${id}${hint}><strong>${(m.averageScore/10).toFixed(1)}</strong>★ score</div>`;
        }
        return '';
      })()}
      ${m.popularity ? `<div class="stat-pill"><strong>${formatNum(m.popularity)}</strong>members</div>` : ''}
      ${m.favourites ? `<div class="stat-pill"><strong>${formatNum(m.favourites)}</strong>favorites</div>` : ''}
      ${m.status ? `<div class="stat-pill"><strong>${capitalize(m.status)}</strong></div>` : ''}
    </div>
    ${airing ? `<div style="margin: 0 20px 16px; padding: 12px 14px; background: var(--accent-soft); border-radius: var(--radius-sm); font-size: 13px; color: var(--accent); font-weight: 600;">Next episode ${airing}</div>` : ''}
    <div class="detail-actions">
      ${(() => {
        if (!state.accessToken) {
          return `<button class="btn-primary" onclick="signIn()">Sign in to track</button>`;
        }
        const entry = m.mediaListEntry;
        if (entry) {
          const label = listStatusLabel(entry.status);
          const prog = entry.progress != null && m.episodes
            ? `<span class="list-btn-prog">${entry.progress}/${m.episodes}</span>`
            : '';
          return `<button class="btn-primary list-btn-on" id="detail-list-btn" data-media-id="${m.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M20 6L9 17l-5-5"/></svg>
            ${escapeHtml(label)}${prog}
          </button>`;
        }
        return `<button class="btn-primary" id="detail-list-btn" data-media-id="${m.id}">+ Add to list</button>`;
      })()}
      <button class="btn-secondary" id="detail-share-btn" data-share-id="${m.id}" data-share-title="${escapeHtml(titleText || 'this anime')}">Share</button>
    </div>
    <div class="detail-section friends-section" id="detail-friends" hidden></div>
    ${m.genres?.length ? `
      <div class="detail-section">
        <h4>Genres</h4>
        <div class="genre-row">${m.genres.map(g => `<div class="genre-pill" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</div>`).join('')}</div>
      </div>` : ''}
    ${desc ? `
      <div class="detail-section">
        <h4>Synopsis</h4>
        <div class="detail-desc${descLong ? ' collapsed' : ''}">${escapeHtml(desc)}</div>
        ${descLong ? `<button class="desc-toggle">Read more</button>` : ''}
      </div>` : ''}
    <div class="detail-section" data-relations-section hidden>
      <h4>Relations</h4>
      <div class="carousel" data-relations-carousel></div>
    </div>
    <div class="detail-section" data-recs-section hidden>
      <h4>Recommendations</h4>
      <div class="carousel" data-recs-carousel></div>
    </div>
    <div class="detail-section" data-chars-section hidden>
      <h4>Characters</h4>
      <div class="character-row" data-chars-row></div>
    </div>
    ${renderStreamingSection(m.externalLinks)}
    ${renderTrailerSection(m.trailer)}
  `;

  // Wire up the add/edit list button
  const listBtn = body.querySelector('#detail-list-btn');
  if (listBtn) {
    listBtn.addEventListener('click', () => {
      const entry = m.mediaListEntry;
      if (entry) {
        openListEditSheet(m, entry);
      } else {
        addToList(m);
      }
    });
  }

  // Wire trailer click → swap thumbnail for actual iframe player
  wireTrailerFrame(body);

  // Fire the friends-watching lookup in the background so the main render
  // isn't blocked on it. Only signed-in users get meaningful results —
  // AniList's isFollowing filter needs a token to know who "you" are.
  if (state.user) loadDetailFriends(m.id);

  // Wire the cover art → fullscreen lightbox with the biggest available image
  const coverEl = body.querySelector('.detail-cover');
  if (coverEl) {
    const largeSrc = m.coverImage?.extraLarge || m.coverImage?.large || '';
    if (largeSrc) coverEl.addEventListener('click', () => openLightbox(largeSrc));
  }

  // Wire the share button — Web Share API on supported devices, clipboard fallback otherwise
  const shareBtn = body.querySelector('#detail-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const mediaId = parseInt(shareBtn.dataset.shareId, 10);
      const title = shareBtn.dataset.shareTitle || 'this anime';
      shareMedia(mediaId, title);
    });
  }

  // Wire the inline subtitle studio link to open the studio overlay
  body.querySelectorAll('.sub-studio').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = parseInt(el.dataset.studioId, 10);
      const name = el.dataset.studioName;
      if (!isNaN(id) && name) openStudio(id, name);
    });
  });

  // Relations / recommendations / characters are ~89% of the full detail
  // payload but all sit below the fold, so they're fetched separately once
  // the visible part is already on screen.
  // Skeletons first so the gap below the fold reads as "loading" instead of
  // "finished, but missing three sections".
  showDetailSkeletons(body);
  loadDetailExtras(m.id, body, cardsPending, charsPending);

  // Wire up genre pills → genre overlay
  body.querySelectorAll('.genre-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      openGenre(pill.dataset.genre, m.type || 'ANIME');
    });
  });
  // Synopsis collapse toggle
  const descToggle = body.querySelector('.desc-toggle');
  if (descToggle) {
    descToggle.addEventListener('click', () => {
      const descEl = body.querySelector('.detail-desc');
      const isCollapsed = descEl.classList.toggle('collapsed');
      descToggle.textContent = isCollapsed ? 'Read more' : 'Read less';
    });
  }
  // Score pill → rate modal (only when signed in; pill has score-clickable class)
  const scorePill = body.querySelector('#detail-score-pill');
  if (scorePill) {
    scorePill.addEventListener('click', () => {
      const currentUserScore = m.mediaListEntry?.score || 0;
      openRateModal(m.id, currentUserScore, pickTitle(m.title) || 'this anime');
    });
  }
}

// ============ RATE MODAL ============
let ratingMediaId = null;
function openRateModal(mediaId, currentScore, title) {
  ratingMediaId = mediaId;
  document.getElementById('rate-modal-title').textContent = `Rate ${title}`;
  const grid = document.getElementById('rate-grid');
  grid.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const score = i + 1;
    const active = score === currentScore ? ' current' : '';
    return `<button class="rate-btn${active}" data-score="${score}">${score}</button>`;
  }).join('');
  grid.querySelectorAll('.rate-btn').forEach(btn => {
    btn.addEventListener('click', () => saveScore(parseInt(btn.dataset.score, 10)));
  });
  document.getElementById('rate-modal').classList.add('visible');
}
function closeRateModal() {
  document.getElementById('rate-modal').classList.remove('visible');
  ratingMediaId = null;
}
async function saveScore(score) {
  if (!ratingMediaId) return;
  if (!state.user) { closeRateModal(); openSignInModal(); return; }
  const mutation = `mutation ($mediaId: Int, $score: Float) {
    SaveMediaListEntry(mediaId: $mediaId, score: $score) { id score status progress }
  }`;
  const mid = ratingMediaId;
  const { data, queued } = await mutateList(mutation, { mediaId: mid, score });
  if (queued) {
    closeRateModal();
    showToast('Score saved offline — will sync when you reconnect');
    return;
  }
  if (data?.SaveMediaListEntry) {
    closeRateModal();
    openMedia(mid); // refresh detail page so pill + button reflect the new score
  }
}
window.closeRateModal = closeRateModal;
document.getElementById('rate-clear-btn').addEventListener('click', () => saveScore(0));

// ============ SIGN-IN MODAL ============
function openSignInModal() { document.getElementById('signin-modal').classList.add('visible'); }
function closeSignInModal() { document.getElementById('signin-modal').classList.remove('visible'); }

// Surface any OAuth error we captured on the redirect callback so the user
// actually sees what AniList returned (instead of a silent dead end).
(function maybeShowOAuthError() {
  if (typeof pendingOAuthError === 'undefined' || !pendingOAuthError) return;
  const banner = document.getElementById('signin-error');
  if (!banner) return;
  const code = pendingOAuthError.code || 'unknown_error';
  const desc = pendingOAuthError.desc || 'AniList did not return an access token. Most often this means the Redirect URL registered on your AniList client does not exactly match this site.';
  banner.hidden = false;
  banner.innerHTML = `<strong>Sign-in failed: <code>${escapeHtml(code)}</code></strong>${escapeHtml(desc)}`;
  // Pop the modal so they see it immediately
  openSignInModal();
  pendingOAuthError = null;
})();

// "Use a token instead" toggles the manual paste panel
const signinAdvancedToggle = document.getElementById('signin-advanced-toggle');
if (signinAdvancedToggle) {
  signinAdvancedToggle.addEventListener('click', () => {
    const panel = document.getElementById('signin-advanced');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const input = document.getElementById('signin-token-input');
      if (input) setTimeout(() => input.focus(), 50);
    }
  });
}

// Validate a pasted token by calling Viewer with it; only persist if it works
async function applyManualToken(token) {
  const banner = document.getElementById('signin-error');
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: '{ Viewer { id name } }' }),
    });
    const json = await res.json();
    if (!json?.data?.Viewer) {
      throw new Error(json?.errors?.[0]?.message || 'AniList rejected the token.');
    }
    state.accessToken = token;
    savePrefs();
    closeSignInModal();
    // Reload so every cached/auth-aware module picks up the new auth header
    window.location.reload();
  } catch (e) {
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = `<strong>Token didn't work</strong>${escapeHtml(e.message || 'Could not validate the token with AniList.')}`;
    }
  }
}

const signinTokenSubmit = document.getElementById('signin-token-submit');
if (signinTokenSubmit) {
  signinTokenSubmit.addEventListener('click', () => {
    const input = document.getElementById('signin-token-input');
    const token = (input?.value || '').trim();
    if (!token) return;
    applyManualToken(token);
  });
}

// ============ SETTINGS ============
document.querySelectorAll('#theme-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('theme-seg', 'theme', b.dataset.theme);
    state.theme = b.dataset.theme;
    applyTheme();
    savePrefs();
  });
});

document.querySelectorAll('#density-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('density-seg', 'density', b.dataset.density);
    state.density = b.dataset.density;
    applyDensity();
    savePrefs();
  });
});

document.querySelectorAll('#landing-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('landing-seg', 'landing', b.dataset.landing);
    state.landing = b.dataset.landing;
    savePrefs();
  });
});

document.querySelectorAll('#lang-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('lang-seg', 'lang', b.dataset.lang);
    state.preferEnglish = b.dataset.lang === 'english';
    savePrefs();
    // Re-render current tab — cached data already includes all title variants
    if (state.activeTab === 'search') {
      loadSearchTab();
      const v = document.getElementById('search-input').value.trim();
      if (v) doSearch(v);
    }
    if (state.activeTab === 'seasonal') loadSeasonal();
  });
});

// Screen Orientation API only grants a lock to an installed PWA — in an
// ordinary browser tab lock() rejects and rotation stays with the OS. Rather
// than let that look like a broken setting, the failure rewrites the hint
// text to say why. The manifest's "orientation": "portrait" is what actually
// holds the installed app upright at launch; this is the runtime override.
async function applyOrientation() {
  const hint = document.getElementById('rotation-sub');
  const orientation = window.screen?.orientation;
  if (!orientation) {
    if (hint) hint.textContent = 'Your browser can’t control rotation';
    return;
  }
  try {
    if (state.allowRotation) {
      orientation.unlock();
      if (hint) hint.textContent = 'Follows however you tilt the phone';
    } else {
      await orientation.lock('portrait');
      if (hint) hint.textContent = 'Keep the app upright';
    }
  } catch (e) {
    if (hint) {
      hint.textContent = state.allowRotation
        ? 'Follows however you tilt the phone'
        : 'Add AniLog to your Home Screen to lock this — browser tabs always follow the phone';
    }
  }
}

document.querySelectorAll('#rotation-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('rotation-seg', 'rotation', b.dataset.rotation);
    state.allowRotation = b.dataset.rotation === 'auto';
    savePrefs();
    applyOrientation();
  });
});

document.querySelectorAll('#relations-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('relations-seg', 'relations', b.dataset.relations);
    state.strictRelations = b.dataset.relations === 'strict';
    savePrefs();
    // If detail page is open, re-render to reflect the filter change
    if (currentMedia && document.getElementById('detail-overlay').classList.contains('visible')) {
      openMedia(currentMedia.id);
    }
  });
});

// Status chips now only SELECT — committing is the Save button's job, so a
// single trip through the sheet can change progress and status together.
document.querySelectorAll('#list-edit-status .chip').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('#list-edit-status .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
  });
});
document.getElementById('list-edit-save-btn').addEventListener('click', saveListEdit);

// +/- step buttons around the episode field
document.getElementById('progress-minus').addEventListener('click', () => stepProgress(-1));
document.getElementById('progress-plus').addEventListener('click', () => stepProgress(1));
document.getElementById('list-edit-progress').addEventListener('input', syncProgressButtons);
document.getElementById('list-edit-remove-btn').addEventListener('click', () => {
  if (confirm('Remove this anime from your list?')) removeFromList();
});

document.querySelectorAll('.seg[data-notif]').forEach(seg => {
  const key = seg.dataset.notif;
  seg.querySelectorAll('.seg-btn').forEach(b => {
    b.addEventListener('click', () => {
      seg.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.notifs[key] = b.dataset.on === 'true';
      savePrefs();
    });
  });
});

// ============ WEB PUSH ENROLMENT ============
// The polling below only notifies while the app is open. Push covers the
// rest, delivered by the scheduled sender in .github/workflows/anilog-push.yml.
//
// iOS only permits Web Push for a PWA installed to the Home Screen — never in
// a Safari tab — and the permission prompt must come from a real tap, which is
// why this is a button rather than something that runs on load.

// VAPID keys travel as base64url; PushManager wants raw bytes.
function urlBase64ToUint8Array(base64) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Standalone display mode is the reliable signal that iOS will allow push.
function isStandalonePWA() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

async function refreshPushStatus() {
  const statusEl = document.getElementById('push-status');
  const btn = document.getElementById('push-enable-btn');
  if (!statusEl || !btn) return;

  if (!pushSupported()) {
    statusEl.textContent = 'This browser doesn’t support push notifications.';
    btn.hidden = true;
    return;
  }
  if (!VAPID_PUBLIC_KEY) {
    statusEl.textContent = 'Push isn’t configured yet — no VAPID key is set in this build.';
    btn.hidden = true;
    return;
  }
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (iOS && !isStandalonePWA()) {
    statusEl.textContent = 'On iPhone, add AniLog to your Home Screen first — Safari tabs can’t receive push.';
    btn.hidden = true;
    return;
  }
  if (Notification.permission === 'denied') {
    statusEl.textContent = 'Notifications are blocked in your browser settings for this site.';
    btn.hidden = true;
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  const existing = await reg?.pushManager.getSubscription();
  if (existing) {
    statusEl.textContent = 'Push is on for this device.';
    // Nothing left to do here once subscribed — the blob moved behind the
    // setup-codes disclosure, so this button would only restate it. If the
    // subscription ever lapses getSubscription() returns null and the enable
    // button comes back on its own.
    btn.hidden = true;
    await refreshSetupCodes();
    return;
  }
  statusEl.textContent = 'Get alerts even when AniLog is closed.';
  btn.textContent = 'Enable push notifications';
  btn.hidden = false;
  await refreshSetupCodes();
}

// Throw the current subscription away and register a fresh one.
//
// A push subscription can be revoked at the push service while the browser
// still holds its local copy — an uninstall, a data clear, or Chrome simply
// deciding to. getSubscription() doesn't check with the server, so it keeps
// returning the dead one, the setup code looks correct, and every send bounces
// with 410 Gone. enablePush() can't dig you out either: it only subscribes
// when getSubscription() comes back empty, which this case never does.
// Unsubscribing first is the only way to force a new endpoint.
async function resetPushSubscription() {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return;
  const btn = document.getElementById('push-reset-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription();
    const oldEndpoint = old?.endpoint || '';
    if (old) await old.unsubscribe();

    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Notifications not allowed');
        return;
      }
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    setSetupCodesOpen(true);
    await refreshPushStatus();
    await refreshSetupCodes();
    // Worth saying out loud: an unchanged endpoint means the push service
    // handed back the same registration, so pasting it again won't help.
    showToast(sub.endpoint === oldEndpoint
      ? 'Same code came back — try again in a minute'
      : 'New code ready — paste it into PUSH_SUBSCRIPTION');
  } catch (e) {
    showToast('Couldn’t generate a new code — try again');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate a new code'; }
  }
}

async function enablePush() {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return;
  const btn = document.getElementById('push-enable-btn');
  if (btn) btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Notifications not allowed');
        return;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,   // required; Chrome rejects silent push
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await refreshPushStatus();
    // Expand once, right here — this is the one moment the code is actually
    // wanted, and making the user hunt for it after tapping Enable would be
    // perverse. Every subsequent load starts collapsed again.
    setSetupCodesOpen(true);
    await refreshSetupCodes();   // fills the blob now that the panel is open
  } catch (e) {
    showToast('Couldn’t enable push — try again');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Clipboard writes need a user gesture and fail outright on http:// origins,
// so every copy path falls back to selecting the text for a manual copy.
async function copyField(id, label) {
  const field = document.getElementById(id);
  if (!field?.value) return;
  try {
    await navigator.clipboard.writeText(field.value);
    showToast(`${label} copied`);
  } catch (e) {
    field.select();
    showToast('Press and hold to copy');
  }
}

// Copy, then jump straight to that secret's edit page on GitHub. The window
// has to be opened FIRST: awaiting the clipboard before window.open() spends
// the user gesture, and Android Chrome then blocks the open as a popup.
function copyAndOpenSecret(fieldId, secretName, label) {
  const win = window.open(`${GITHUB_SECRETS}/${secretName}`, '_blank', 'noopener');
  copyField(fieldId, label);
  if (!win) showToast('Copied — popup blocked, open GitHub manually');
}

// TEMPORARY diagnostic — see the note in index.html. Reads the values that
// decide whether the page can paint behind the Android gesture bar: the
// safe-area insets the OS actually reports, the display mode Chrome granted,
// and whether the layout viewport covers the full screen.
function showDisplayInfo() {
  const out = document.getElementById('display-info');
  const btn = document.getElementById('display-info-btn');
  if (!out) return;
  if (!out.hidden) { out.hidden = true; if (btn) btn.textContent = 'Show display info'; return; }

  // env() can only be read through a real property, so park each inset on a
  // throwaway element and read it back.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = {
    top: cs.paddingTop, right: cs.paddingRight,
    bottom: cs.paddingBottom, left: cs.paddingLeft,
  };
  probe.remove();

  const modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser']
    .filter((m) => matchMedia(`(display-mode: ${m})`).matches);
  const app = document.getElementById('app');

  out.textContent = [
    `version        v${(document.getElementById('update-status')?.textContent || '').replace(/^v/, '')}`,
    `safe-area      top ${insets.top}  bottom ${insets.bottom}`,
    `               left ${insets.left}  right ${insets.right}`,
    `display-mode   ${modes.join(', ') || 'unknown'}`,
    `innerHeight    ${window.innerHeight}   screen ${screen.height}`,
    `visualViewport ${Math.round(visualViewport?.height || 0)}`,
    `dvh/vh         ${probeUnit('dvh')} / ${probeUnit('vh')}`,
    `app height     ${app ? Math.round(app.getBoundingClientRect().height) : '?'}`,
    `dpr            ${devicePixelRatio}`,
    `theme-color    ${document.querySelector('meta[name="theme-color"]')?.content}`,
    `--bg           ${getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()}`,
  ].join('\n');
  out.hidden = false;
  if (btn) btn.textContent = 'Hide display info';
}

function probeUnit(unit) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-9999px;height:100${unit};`;
  document.body.appendChild(el);
  const h = Math.round(el.getBoundingClientRect().height);
  el.remove();
  return h;
}

document.getElementById('display-info-btn')?.addEventListener('click', showDisplayInfo);

document.getElementById('push-enable-btn')?.addEventListener('click', enablePush);
document.getElementById('push-reset-btn')?.addEventListener('click', resetPushSubscription);
document.getElementById('push-copy-btn')?.addEventListener('click', () => copyField('push-subscription', 'Subscription'));
document.getElementById('push-github-btn')?.addEventListener('click',
  () => copyAndOpenSecret('push-subscription', 'PUSH_SUBSCRIPTION', 'Subscription'));

// ---- Setup codes disclosure ----
// The PUSH_SUBSCRIPTION blob and the AniList token are both one-time GitHub
// setup values, and both are unreadable noise the rest of the time. They share
// one collapsed panel that starts closed on every load, and the values are only
// written into the DOM while it's open — a token left sitting in a textarea is
// a token anyone borrowing the phone can scroll to.

function setSetupCodesOpen(open) {
  const panel = document.getElementById('setup-codes');
  const toggle = document.getElementById('setup-codes-toggle');
  if (!panel) return;
  panel.hidden = !open;
  if (toggle) toggle.textContent = open ? 'Hide setup codes' : 'Show setup codes';

  const tokenField = document.getElementById('token-value');
  if (tokenField) tokenField.value = open ? (state.accessToken || '') : '';
  if (!open) {
    const subField = document.getElementById('push-subscription');
    if (subField) subField.value = '';
  }
}

// Decides what the panel can offer: the subscription only once this device is
// subscribed, the token only while signed in. With neither, the toggle itself
// stays hidden rather than opening onto an empty box.
async function refreshSetupCodes() {
  const toggle = document.getElementById('setup-codes-toggle');
  const subWrap = document.getElementById('push-subscription-wrap');
  const tokenWrap = document.getElementById('token-reveal-wrap');

  let sub = null;
  if (pushSupported()) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      sub = await reg?.pushManager.getSubscription();
    } catch (e) { /* no registration yet — treated as not subscribed */ }
  }

  if (subWrap) subWrap.hidden = !sub;
  if (tokenWrap) tokenWrap.hidden = !state.accessToken;

  const anything = !!sub || !!state.accessToken;
  if (toggle) toggle.hidden = !anything;
  if (!anything) setSetupCodesOpen(false);

  // Keep the live subscription in the field while the panel is open, so a
  // re-subscribe doesn't leave a stale blob on screen.
  const panel = document.getElementById('setup-codes');
  const subField = document.getElementById('push-subscription');
  if (sub && subField && panel && !panel.hidden) {
    subField.value = JSON.stringify(sub.toJSON());
  }
}

document.getElementById('setup-codes-toggle')?.addEventListener('click', async () => {
  const panel = document.getElementById('setup-codes');
  const opening = !!panel?.hidden;
  setSetupCodesOpen(opening);
  if (opening) await refreshSetupCodes();
});
document.getElementById('token-copy-btn')?.addEventListener('click', () => copyField('token-value', 'Token'));
document.getElementById('token-github-btn')?.addEventListener('click',
  () => copyAndOpenSecret('token-value', 'ANILIST_TOKEN', 'Token'));

refreshPushStatus();

// ---- Update banner ----
// The registration in index.html finds updates (on load, and on every
// foreground); this draws the result. Kept separate so a worker that was
// already applied before app.js parsed still gets announced — index.html
// stashes a flag on __anilogUpdatePending and we pick it up at the bottom.
function showUpdateBanner() {
  const el = document.getElementById('update-banner');
  if (el) el.hidden = false;
}
window.anilogShowUpdateBanner = showUpdateBanner;

document.getElementById('update-banner-dismiss')?.addEventListener('click', () => {
  const el = document.getElementById('update-banner');
  if (el) el.hidden = true;
  // Not remembered: the next foreground check raises it again. Dismiss means
  // "not now", and an update that stays pending should keep asking.
});

document.getElementById('update-banner-reload')?.addEventListener('click', () => {
  const btn = document.getElementById('update-banner-reload');
  if (btn) { btn.disabled = true; btn.textContent = 'Reloading…'; }
  // The new worker is already in control by the time this banner exists, so
  // a plain reload picks up the new shell from its cache. Nothing to wait on.
  window.location.reload();
});

// An update that landed before this script ran.
if (window.__anilogUpdatePending) showUpdateBanner();

// ---- Manual update check ----
// The registration in index.html already calls reg.update() on every
// foreground, so this is never *required* — but "background it and wait" is
// an act of faith, and the honest answer to "did it update?" should be a
// button that says so. Also the only way to tell "already latest" apart from
// "the check silently failed", which is what drove people to reinstall.
//
// No reload here: a new worker calls skipWaiting(), and the controllerchange
// listener in index.html does the single reload once it takes over.
async function checkForUpdate() {
  const btn = document.getElementById('update-check-btn');
  const status = document.getElementById('update-status');
  // Checking the value, not the key: some embedded webviews expose the
  // property as undefined, where `'serviceWorker' in navigator` is still true.
  if (!navigator.serviceWorker) {
    if (status) status.textContent = 'Updates need a browser with service workers';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      if (status) status.textContent = 'Not installed as an app yet';
      return;
    }
    // updatefound is the reliable signal — by the time update() resolves, a
    // skipWaiting() worker may already have moved past reg.installing.
    let found = false;
    const onFound = () => { found = true; };
    reg.addEventListener('updatefound', onFound);
    await reg.update();
    await new Promise((r) => setTimeout(r, 700));
    reg.removeEventListener('updatefound', onFound);

    if (found || reg.installing || reg.waiting) {
      // The worker waits now rather than taking over, so this hands off to
      // the banner instead of claiming a reload is already happening.
      if (status) status.textContent = 'Update ready — see the banner';
      if (reg.waiting) reg.waiting.postMessage({ type: 'anilog-skip-waiting' });
      anilogUpdateReady();
    } else {
      if (status) status.textContent = 'Up to date';
      showToast('You’re on the latest version');
    }
  } catch (e) {
    if (status) status.textContent = 'Check failed — are you online?';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Check for updates'; }
  }
}
document.getElementById('update-check-btn')?.addEventListener('click', checkForUpdate);

// ---- Where a tapped push lands ----
// Two routes in, because the app may or may not already be running:
//
//   running  — the SW focuses the window and posts a message, so the loaded
//              app is reused instead of navigated away from.
//   closed   — the SW can only call openWindow(url), so the target rides in
//              the query string and gets picked up on boot below.
//
// Both funnel through openFromNotification, which mirrors handleNotifTap:
// media notifications open the anime, everything else opens the person who
// caused it. AniList has no single-activity view in this app, so the profile
// is the closest real destination — landing on Home was the bug.
function openFromNotification({ mediaId, activityId, userId, userName }) {
  if (mediaId) return openMedia(mediaId);
  if (activityId) return openActivity(activityId);
  if (userId) return openUser(userId, userName || '');
}

navigator.serviceWorker?.addEventListener('message', (e) => {
  const d = e.data || {};
  // anilog-open-media is the pre-v4.46 shape; a worker from the previous
  // build can still be the one that posts, since it controls the page until
  // the update reload lands.
  if (d.type === 'anilog-open') openFromNotification(d);
  else if (d.type === 'anilog-open-media' && d.mediaId) openMedia(d.mediaId);
});

// Cold start from a notification tap: ./?media=123, ./?activity=456, or
// ./?user=789&name=Foo.
(function openFromLaunchUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const mediaId = parseInt(params.get('media') || '', 10) || null;
  const activityId = parseInt(params.get('activity') || '', 10) || null;
  const userId = parseInt(params.get('user') || '', 10) || null;
  if (!mediaId && !activityId && !userId) return;

  // Drop the params before opening, so a refresh doesn't reopen the overlay
  // and the URL doesn't stay dirty.
  history.replaceState(null, '', window.location.pathname);

  // Deferred: the overlay handlers below this line aren't wired yet.
  setTimeout(() => {
    try {
      openFromNotification({ mediaId, activityId, userId, userName: params.get('name') || '' });
    } catch (e) { /* boot continues regardless */ }
  }, 0);
})();

// ============ NOTIFICATIONS ============
// AniList exposes Viewer.unreadNotificationCount for the badge and
// Page.notifications for the list. We poll the count every 90 seconds while
// the tab is visible, refresh the full list on overlay open, and (if the
// user grants permission) fire OS-level notifications for new items using
// the browser's Notification API. Real background push would require a
// backend and VAPID keys we don't have — this delivers ~90% of that value
// as long as the app is open in a tab or as an installed PWA.

let notifState = { unread: 0, pollTimer: null, shownIds: null };
// AniList resets its server-side unread count when we open the overlay, so
// we snapshot the pre-reset count to decide which rows to render as unread.
let notifUnreadCutoff = 0;

function loadShownNotifIds() {
  try {
    const raw = localStorage.getItem('anilog-shown-notif-ids');
    const arr = raw ? JSON.parse(raw) : [];
    notifState.shownIds = new Set(arr.slice(-200));
  } catch (e) { notifState.shownIds = new Set(); }
}
function saveShownNotifIds() {
  try {
    localStorage.setItem(
      'anilog-shown-notif-ids',
      JSON.stringify(Array.from(notifState.shownIds).slice(-200))
    );
  } catch (e) {}
}

function setNotifBadge(n) {
  notifState.unread = n;
  const badge = document.getElementById('notif-count-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// The bell itself is always visible (see index.html) — signed-out users
// can see it exists and tap it to sign in, rather than the feature being
// invisible until they've already found sign-in some other way.
async function initNotifications() {
  const bell = document.getElementById('notif-bell');
  if (!bell) return;
  if (!state.user) {
    stopNotifPolling();
    setNotifBadge(0);
    return;
  }
  if (!notifState.shownIds) loadShownNotifIds();
  // The badge was already set from fetchViewer's unreadNotificationCount —
  // no need to re-request it here. The polling loop keeps it fresh.
  startNotifPolling();
}

function onNotifBellTap() {
  if (!state.user) return openSignInModal();
  openNotifications();
}
window.onNotifBellTap = onNotifBellTap;

function startNotifPolling() {
  if (notifState.pollTimer) return;
  notifState.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && state.user) {
      refreshUnreadCount().catch(() => {});
    }
  }, 90 * 1000);
}
function stopNotifPolling() {
  if (notifState.pollTimer) {
    clearInterval(notifState.pollTimer);
    notifState.pollTimer = null;
  }
}

async function refreshUnreadCount() {
  const q = `query { Viewer { unreadNotificationCount } }`;
  const data = await anilist(q);
  const prev = notifState.unread;
  const now = data?.Viewer?.unreadNotificationCount || 0;
  setNotifBadge(now);
  if (now > prev && 'Notification' in window && Notification.permission === 'granted') {
    fetchAndSurfaceNewNotifs().catch(() => {});
  }
}

async function fetchAndSurfaceNewNotifs() {
  const items = await fetchNotifications(false);
  const fresh = items.filter((n) => n && n.id && !notifState.shownIds.has(n.id));
  for (const n of fresh.slice(0, 5)) {
    try {
      const { title, body, icon, tag } = notifOsPayload(n);
      const osNotif = new Notification(title, { body, icon, tag });
      osNotif.onclick = () => { window.focus(); handleNotifTap(n); osNotif.close(); };
    } catch (e) {}
    notifState.shownIds.add(n.id);
  }
  saveShownNotifIds();
}

const NOTIF_QUERY_BODY = `
  ... on AiringNotification { id type createdAt episode contexts media { id title { userPreferred english romaji } coverImage { large } } }
  ... on FollowingNotification { id type createdAt context user { id name avatar { large } } }
  ... on ActivityLikeNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on ActivityReplyNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on ActivityMentionNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on ActivityMessageNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on ActivityReplyLikeNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on ActivityReplySubscribedNotification { id type createdAt context user { id name avatar { large } } activityId }
  ... on RelatedMediaAdditionNotification { id type createdAt context media { id title { userPreferred english romaji } coverImage { large } } }
  ... on MediaDataChangeNotification { id type createdAt context media { id title { userPreferred english romaji } coverImage { large } } }
`;

// The `reset` fetch above tells AniList's server to zero out the unread
// counter, but two OTHER queries also cache Viewer.unreadNotificationCount
// under their own keys (the boot Viewer query in fetchViewer, and the
// lightweight polling query in refreshUnreadCount) — anilist()'s cache has
// no idea they're related. Without this, whichever of those is still
// within its 15-minute TTL (including the copy persisted to localStorage,
// which survives a real app close) replays the pre-reset count on the next
// load, undoing what the user just saw. Patch every cached response that
// carries that field straight to 0 so nothing can resurrect the old count.
function zeroOutCachedUnreadCounts() {
  Object.keys(cache).forEach((k) => {
    const entry = cache[k];
    if (entry?.Viewer && typeof entry.Viewer.unreadNotificationCount === 'number') {
      entry.Viewer.unreadNotificationCount = 0;
      // Also expire the entry (not just patch its value) so the NEXT read
      // triggers a background refetch instead of serving this now-stale
      // "0" for a full 15 minutes — otherwise a real new notification that
      // lands in that window wouldn't show up until the TTL naturally
      // elapsed. Stale-while-revalidate still returns 0 instantly today;
      // the background fetch self-heals it within one poll cycle if the
      // true server count has already moved on.
      if (typeof cacheExpires !== 'undefined') cacheExpires.set(k, 0);
    }
  });
  if (typeof schedulePersist === 'function') schedulePersist();
}

async function fetchNotifications(reset) {
  const q = `query ($reset: Boolean) {
    Page(page: 1, perPage: 25) {
      notifications(resetNotificationCount: $reset) {
        __typename
        ${NOTIF_QUERY_BODY}
      }
    }
  }`;
  const data = await anilist(q, { reset: !!reset });
  return data?.Page?.notifications || [];
}

async function openNotifications() {
  const overlay = document.getElementById('notif-overlay');
  const body = document.getElementById('notif-body');
  if (!overlay || !body) return;
  notifUnreadCutoff = notifState.unread;
  overlay.classList.add('visible');
  body.innerHTML = `<div style="padding: 40px 20px; text-align:center; color:var(--text-dim);">Loading…</div>`;
  try {
    const items = await fetchNotifications(true);
    setNotifBadge(0);
    zeroOutCachedUnreadCounts();
    // Mark every returned item as "seen" so the OS layer doesn't fire again
    // for items the user just visually reviewed.
    if (!notifState.shownIds) loadShownNotifIds();
    items.forEach((n) => n?.id && notifState.shownIds.add(n.id));
    saveShownNotifIds();
    body.innerHTML = renderNotifOverlay(items);
    wireNotifOverlay(body, items);
  } catch (e) {
    body.innerHTML = `<div class="notif-empty">Couldn't load notifications.</div>`;
  }
}
window.openNotifications = openNotifications;

function renderNotifOverlay(items) {
  const canPrompt = ('Notification' in window) && Notification.permission === 'default';
  const prompt = canPrompt
    ? `<div class="notif-perm-prompt">
         Get an alert when new episodes air.
         <button id="notif-perm-btn">Enable</button>
       </div>`
    : '';
  if (!items.length) {
    return prompt + `<div class="notif-empty">You're all caught up.</div>`;
  }
  const rows = items.map((n, i) => renderNotifRow(n, i)).join('');
  return prompt + `<div class="notif-list">${rows}</div>`;
}

function renderNotifRow(n, idx) {
  const unread = idx < notifUnreadCutoff ? ' unread' : '';
  const { text, avatar, cover, timeText } = notifRowContent(n);
  const thumb = cover
    ? `<div class="notif-cover" style="background-image:url('${cover}');"></div>`
    : `<div class="notif-avatar" style="background-image:url('${avatar || ''}');"></div>`;
  return `<div class="notif-item${unread}" data-notif-index="${idx}">
    ${thumb}
    <div class="notif-body-col">
      <div class="notif-text">${text}</div>
      <div class="notif-time">${escapeHtml(timeText)}</div>
    </div>
    <div class="notif-dot"></div>
  </div>`;
}

function notifRowContent(n) {
  const timeText = formatRelativeTime(n.createdAt);
  const media = n.media;
  const user = n.user;
  const title = media ? escapeHtml(pickTitle(media.title) || 'Unknown') : '';
  const uname = user ? escapeHtml(user.name) : '';
  switch (n.__typename || n.type) {
    case 'AiringNotification':
      return {
        text: `Episode <strong>${n.episode}</strong> of <strong>${title}</strong> aired.`,
        cover: media?.coverImage?.large,
        timeText,
      };
    case 'RelatedMediaAdditionNotification':
      return { text: `<strong>${title}</strong> was added to AniList.`, cover: media?.coverImage?.large, timeText };
    case 'MediaDataChangeNotification':
      return { text: `Details updated for <strong>${title}</strong>.`, cover: media?.coverImage?.large, timeText };
    case 'FollowingNotification':
      return { text: `<strong>${uname}</strong> ${escapeHtml(n.context || 'followed you')}`, avatar: user?.avatar?.large, timeText };
    case 'ActivityLikeNotification':
    case 'ActivityReplyLikeNotification':
      return { text: `<strong>${uname}</strong> liked your activity.`, avatar: user?.avatar?.large, timeText };
    case 'ActivityReplyNotification':
    case 'ActivityReplySubscribedNotification':
      return { text: `<strong>${uname}</strong> replied to your activity.`, avatar: user?.avatar?.large, timeText };
    case 'ActivityMentionNotification':
      return { text: `<strong>${uname}</strong> mentioned you.`, avatar: user?.avatar?.large, timeText };
    case 'ActivityMessageNotification':
      return { text: `<strong>${uname}</strong> sent you a message.`, avatar: user?.avatar?.large, timeText };
    default:
      return { text: `New AniList notification.`, timeText };
  }
}

function notifOsPayload(n) {
  const { text } = notifRowContent(n);
  const strip = text.replace(/<[^>]+>/g, '');
  return {
    title: 'AniLog',
    body: strip,
    icon: n.media?.coverImage?.large || n.user?.avatar?.large || 'icon-192.png',
    tag: `anilog-${n.id}`,
  };
}

function handleNotifTap(n) {
  closeOverlay('notif-overlay');
  if (n.media?.id) return openMedia(n.media.id);
  // Before the profile: "X liked your activity" is about the activity, and
  // X's profile was only ever a stand-in for having nowhere better to send it.
  if (n.activityId) return openActivity(n.activityId);
  if (n.user?.id && n.user?.name) return openUser(n.user.id, n.user.name);
}

function wireNotifOverlay(body, items) {
  body.querySelectorAll('.notif-item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.notifIndex, 10);
      const n = items[idx];
      if (n) handleNotifTap(n);
    });
  });
  const permBtn = body.querySelector('#notif-perm-btn');
  if (permBtn) {
    permBtn.addEventListener('click', async () => {
      try {
        const p = await Notification.requestPermission();
        if (p === 'granted') {
          const wrap = permBtn.closest('.notif-perm-prompt');
          if (wrap) wrap.remove();
          if (typeof toast === 'function') toast('Notifications enabled');
        }
      } catch (e) {}
    });
  }
}

// ============ HOVER / TOUCH PREFETCH ============
// When the user's finger touches down or their mouse hovers over a card,
// we fire the same media-detail query openMedia() will make. On modern
// hardware that lands ~150–300ms before the click event, so by the time
// the detail overlay opens the response is already in the anilist() cache
// and renders instantly. Cheap idempotent op — the Set dedupes so we
// don't spam the API on desktop as the mouse moves across a grid.
const _prefetchedMediaIds = new Set();
// Respect the browser's Save-Data hint (Android Data Saver, some carriers,
// low-battery mode). If the user's actively conserving bandwidth we skip
// speculative prefetches — the click still works, it just takes the normal
// path instead of arriving warm.
function _prefetchAllowed() {
  const c = navigator.connection;
  return !c || !c.saveData;
}
// Hoisted wrapper around requestIdleCallback with a setTimeout fallback for
// (older) Safari. Function declaration so callers earlier in the file can
// reference it during boot before any const at file bottom would be reached.
function _idle(cb, opts) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(cb, opts || { timeout: 2000 });
  return setTimeout(cb, 500);
}
function prefetchMedia(id) {
  if (!id || _prefetchedMediaIds.has(id) || !_prefetchAllowed()) return;
  _prefetchedMediaIds.add(id);
  // Core only — it's the query openMedia awaits before painting, so warming
  // it is what actually makes the tap feel instant. The extras are ~10x the
  // bytes and load behind the render anyway, so speculatively fetching them
  // for every card the user brushes past would waste most of that data.
  const q = `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_CORE} } }`;
  // Low priority: a guess about what might be tapped must never sit in front
  // of a request the user is actually waiting on.
  anilist(q, { id }, { priority: 'low' }).catch(() => {});
}
function _mediaIdFromEvent(e) {
  const el = e.target?.closest?.('[data-media-id]');
  if (!el) return 0;
  return parseInt(el.dataset.mediaId, 10) || 0;
}
document.addEventListener('pointerdown', (e) => {
  const id = _mediaIdFromEvent(e);
  if (id) prefetchMedia(id);
}, { passive: true });
// pointerover handles desktop hover — pointerdown catches touch taps.
// Together they give both platforms a head-start on the detail fetch.
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const id = _mediaIdFromEvent(e);
  if (id) prefetchMedia(id);
}, { passive: true });

// ============ BOOT ============
switchTab(state.landing || 'home');
updateAuthUI();
if (state.accessToken) {
  // With a cached user in localStorage, we know our own userId and can
  // start the list fetch immediately, in parallel with the Viewer refresh.
  // anilist() dedupes the second loadMyList call inside fetchViewer via
  // its in-flight/cache maps, so the double dispatch is free.
  if (state.user?.id) loadMyList();
  fetchViewer();
  // Anything edited while offline last session goes out now.
  flushPendingWrites();
}
updatePendingUI();
// Also fires when fetchViewer resolves and toggles state.user — updateAuthUI
// calls this too (see api.js), but calling here handles the signed-out case
// on cold boot cleanly.
initNotifications();

// ============ IDLE PRELOAD ============
// After boot settles, silently warm the Seasonal tab (the most-visited
// second destination). loadSeasonal() renders into the hidden tab
// container — display:none skips layout & paint so the only cost is the
// JS work of building the HTML string, which is fractional-millisecond
// stuff on any modern phone. Tab switch is then instant on first press.
// Skips if Save-Data is on (no speculative bandwidth) or if the user
// already landed on the Seasonal tab as their entry point.
_idle(() => {
  if (state.activeTab === 'seasonal') return;
  if (!_prefetchAllowed()) return;
  try { loadSeasonal(); } catch (e) {}
}, { timeout: 2000 });
