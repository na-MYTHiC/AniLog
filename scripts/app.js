// AniLog — application UI.
// All tabs, overlays, modals, detail views, swipe handling, and boot calls.
// Depends on: config.js (constants), state.js (state, cache, runtime vars),
//             api.js (anilist client, auth), render.js (helpers, renderers).

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
syncSegState('view-seg', 'view', state.viewMode || 'mobile');
syncSegState('density-seg', 'density', state.density);
syncSegState('landing-seg', 'landing', state.landing);
syncSegState('lang-seg', 'lang', state.preferEnglish ? 'english' : 'default');
syncSegState('relations-seg', 'relations', state.strictRelations ? 'strict' : 'all');
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

  // Top three rows — fixed sort, single carousel each
  const rows = [
    { id: 'trending-row', sort: 'TRENDING_DESC' },
    { id: 'top-row',      sort: 'SCORE_DESC' },
    { id: 'popular-row',  sort: 'POPULARITY_DESC' },
  ];
  for (const r of rows) {
    if (searchReqId !== myReq) return;
    const q = `query { Page(perPage: 12) { media(sort: ${r.sort}, type: ANIME, isAdult: false) { ${MEDIA_FRAGMENT} } } }`;
    const el = document.getElementById(r.id);
    if (cache['pub:' + q + '{}']) {
      renderIntoEl(el, cache['pub:' + q + '{}']);
    } else {
      skeletonFill(el, 6);
      const data = await anilist(q);
      if (searchReqId !== myReq) return;
      renderIntoEl(el, data);
    }
  }

  // Then the genre rows — popularity-sorted, filtered by the genre name
  for (const genre of SEARCH_GENRES) {
    if (searchReqId !== myReq) return;
    const el = document.querySelector(`[data-genre-row="${genre}"]`);
    if (!el) continue;
    const q = `query ($genre: String) { Page(perPage: 12) { media(genre: $genre, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${MEDIA_FRAGMENT} } } }`;
    const vars = { genre };
    const cacheKey = 'pub:' + q + JSON.stringify(vars);
    if (cache[cacheKey]) {
      renderIntoEl(el, cache[cacheKey]);
    } else {
      skeletonFill(el, 6);
      const data = await anilist(q, vars);
      if (searchReqId !== myReq) return;
      renderIntoEl(el, data);
    }
  }
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

async function doSearch(query) {
  const q = `query ($s: String) { Page(perPage: 30) { media(search: $s, type: ANIME, isAdult: false, sort: [POPULARITY_DESC]) { ${MEDIA_FRAGMENT} } } }`;
  const data = await anilist(q, { s: query });
  const results = data?.Page?.media || [];

  if (results.length > 0) {
    searchGrid.innerHTML = results.map(renderCard).join('');
    saveRecentSearch(query);
  } else {
    searchGrid.innerHTML = `<div class="no-results" style="grid-column: 1/-1;">No results for "${escapeHtml(query)}"</div>`;
  }
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

async function loadSeasonal() {
  updateSeasonalHeader();
  const grid = document.getElementById('seasonal-grid');
  skeletonFill(grid, 8);
  const q = `query ($season: MediaSeason, $year: Int, $sort: [MediaSort]) { Page(perPage: 24) { media(season: $season, seasonYear: $year, type: ANIME, sort: $sort, isAdult: false) { ${MEDIA_FRAGMENT} } } }`;
  const data = await anilist(q, { season: seasonalView.season, year: seasonalView.year, sort: [state.seasonalSort] });
  if (data?.Page?.media?.length) {
    grid.innerHTML = data.Page.media.map(renderCard).join('');
  } else {
    grid.innerHTML = `<div style="padding:40px 20px; color:var(--text-dim); font-size:13px; grid-column: 1/-1; text-align:center;">No releases found for ${capitalize(seasonalView.season)} ${seasonalView.year}.</div>`;
  }
}

document.getElementById('season-prev').addEventListener('click', () => {
  shiftSeason('prev');
  loadSeasonal();
});
document.getElementById('season-next').addEventListener('click', () => {
  shiftSeason('next');
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
    const meanScore = stats?.meanScore ? stats.meanScore.toFixed(1) : '—';
    card.innerHTML = `
      <div class="empty-icon" style="width: 72px; height: 72px; border-radius: 50%; padding: 0; overflow: hidden; background: var(--surface-2);">
        ${u.avatar?.large || u.avatar?.medium
          ? `<img src="${u.avatar.large || u.avatar.medium}" alt="${escapeHtml(u.name)}" style="width: 100%; height: 100%; object-fit: cover;">`
          : `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`}
      </div>
      <div class="empty-title">${escapeHtml(u.name)}</div>
      <div class="empty-text">
        <strong>${stats?.count || 0}</strong> anime · <strong>${meanScore}</strong> mean · <strong>${hours}h</strong> watched
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

  // Optimistic re-render of just this row
  const fresh = renderListEntryRow(entry);
  const tmp = document.createElement('div');
  tmp.innerHTML = fresh;
  const newWrap = tmp.firstElementChild;
  wrap.replaceWith(newWrap);
  attachListRowHandlers(newWrap, entry);

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
  const data = await anilist(mutation, variables);
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

function openListEditSheet(media, entry) {
  editingEntry = entry;
  editingMediaId = media.id;
  const isNew = !entry.id;
  document.getElementById('list-edit-title').textContent = isNew
    ? `Add to list — ${pickTitle(media.title) || 'Anime'}`
    : pickTitle(media.title) || 'Edit Entry';
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

async function setListStatus(newStatus) {
  if (!editingMediaId) return;
  const mutation = `mutation ($mediaId: Int, $status: MediaListStatus) {
    SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
  }`;
  const data = await anilist(mutation, { mediaId: editingMediaId, status: newStatus });
  if (data?.SaveMediaListEntry) {
    closeListEditSheet();
    openMedia(editingMediaId);
  }
}

async function removeFromList() {
  if (!editingEntry?.id) return;
  const mutation = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;
  const data = await anilist(mutation, { id: editingEntry.id });
  if (data?.DeleteMediaListEntry?.deleted) {
    const mid = editingMediaId;
    closeListEditSheet();
    openMedia(mid);
  }
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

  const vars = isAll
    ? { userId: state.user.id, sort: [state.listSort] }
    : { userId: state.user.id, status: state.listStatus, sort: [state.listSort] };

  const data = await anilist(q, vars);
  if (myListReqId !== myReq) return;
  const entries = (data?.MediaListCollection?.lists || []).flatMap(l => l.entries || []);
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
  }
}

// ============ SOCIAL TAB (friends-only activity feed) ============
let socialReqId = 0;

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
  if (act.status === 'CURRENT' && act.progress) return `Watched episode <strong>${escapeHtml(String(act.progress))}</strong>`;
  if (act.status === 'COMPLETED') return `Completed`;
  if (act.status === 'PLANNING') return `Planning to watch`;
  if (act.status === 'PAUSED') return `Paused`;
  if (act.status === 'DROPPED') return `Dropped`;
  if (act.status === 'REPEATING') return `Rewatching${act.progress ? ` (ep ${escapeHtml(String(act.progress))})` : ''}`;
  return act.status ? escapeHtml(String(act.status)) : '';
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
  const replyList = (act.replies || []).map(renderReply).join('');

  // Compact two-line body: action + anime title inline, then reactions.
  // Anime cover floats on the right as a small thumb so each card stays
  // ~80px tall instead of the previous ~180px stacked layout.
  const contentInner = isText
    ? `<div class="activity-text">${escapeHtml(act.text || '').slice(0, 600)}</div>`
    : `<div class="activity-content">${activityActionText(act)}${m ? ` <strong>${escapeHtml(pickTitle(m.title) || 'Unknown')}</strong>` : ''}</div>`;

  const thumb = (!isText && m)
    ? `<div class="activity-thumb" data-media-id="${m.id}" style="background-image:url('${m.coverImage?.large || ''}'); background-color:${m.coverImage?.color || 'var(--surface-2)'};"></div>`
    : '';

  return `
    <div class="activity-card" data-activity-id="${act.id}">
      <div class="activity-avatar" style="background-image:url('${avatar}');"></div>
      <div class="activity-body">
        <div class="activity-meta-row">
          <span class="activity-user">${escapeHtml(name)}</span>
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
        <div class="activity-replies" data-activity-id="${act.id}">
          <div class="activity-reply-list">${replyList}</div>
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

  // Friends-only — sign-in is required (AniList's isFollowing filter needs auth)
  if (!state.user) {
    feed.innerHTML = `
      <div class="empty" style="padding: 50px 20px;">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3-3-3 3"/><path d="M19 8v6"/></svg>
        </div>
        <div class="empty-title">Sign in to see your friends</div>
        <div class="empty-text">When you sign in we'll show updates from everyone you follow on AniList.</div>
        <button class="btn-primary" onclick="signIn()">Sign in with AniList</button>
      </div>`;
    return;
  }

  feed.innerHTML = Array(5).fill(`
    <div class="activity-card">
      <div class="activity-avatar skeleton"></div>
      <div class="activity-body">
        <div class="skeleton" style="height: 14px; width: 40%; border-radius: 4px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 52px; border-radius: 8px;"></div>
      </div>
    </div>
  `).join('');

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

  // Try friends-only first
  const friendsQ = `query { Page(perPage: 25) { activities(isFollowing: true, sort: ID_DESC) { ${activityBody} } } }`;
  const friendsData = await anilist(friendsQ);
  if (socialReqId !== myReq) return;
  const friends = (friendsData?.Page?.activities || []).filter(a => a && (a.type === 'ANIME_LIST' || a.type === 'TEXT'));

  if (friends.length > 0) {
    feed.innerHTML = friends.map(renderActivity).join('');
    attachActivityHandlers(feed);
    return;
  }

  // No friend activity — fall back to everyone's feed with a clear notice on top
  const globalQ = `query { Page(perPage: 25) { activities(hasRepliesOrTypeText: false, sort: ID_DESC) { ${activityBody} } } }`;
  const globalData = await anilist(globalQ);
  if (socialReqId !== myReq) return;
  const everyone = (globalData?.Page?.activities || []).filter(a => a && (a.type === 'ANIME_LIST' || a.type === 'TEXT'));

  const notice = `
    <div class="social-fallback-notice">
      <strong>You don't have any followed friends with recent activity.</strong>
      Showing everyone's activity below — follow people on AniList to see them here first.
    </div>`;
  if (!everyone.length) {
    feed.innerHTML = notice + `<div class="no-results" style="padding: 40px 20px;">No recent activity at all right now.</div>`;
    return;
  }
  feed.innerHTML = notice + everyone.map(renderActivity).join('');
  attachActivityHandlers(feed);
}

// Wire taps, likes, reply expansion + submission for every activity card in the feed
function attachActivityHandlers(feed) {
  feed.querySelectorAll('.activity-thumb').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.mediaId, 10);
      if (!isNaN(id)) openMedia(id);
    });
  });

  feed.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!state.user) return openSignInModal();
      const id = parseInt(btn.dataset.activityId, 10);
      if (isNaN(id)) return;
      const mutation = `mutation ($id: Int) {
        ToggleLikeV2(id: $id, type: ACTIVITY) { ... on ListActivity { id likeCount isLiked } ... on TextActivity { id likeCount isLiked } }
      }`;
      const data = await anilist(mutation, { id });
      const updated = data?.ToggleLikeV2;
      if (updated) {
        btn.classList.toggle('liked', updated.isLiked);
        const countEl = btn.querySelector('span');
        if (countEl) countEl.textContent = updated.likeCount;
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', updated.isLiked ? 'currentColor' : 'none');
      }
    });
  });

  // Reply count button toggles the inline replies panel
  feed.querySelectorAll('.reply-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.activityId;
      const panel = feed.querySelector(`.activity-replies[data-activity-id="${id}"]`);
      if (!panel) return;
      panel.classList.toggle('open');
      // Auto-focus the input when opening so the user can type immediately
      if (panel.classList.contains('open')) {
        const input = panel.querySelector('.activity-reply-input');
        if (input) setTimeout(() => input.focus(), 50);
      }
    });
  });

  // Submit a reply via SaveActivityReply
  feed.querySelectorAll('.activity-reply-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.user) return openSignInModal();
      const input = form.querySelector('.activity-reply-input');
      const text = input.value.trim();
      if (!text) return;
      const sendBtn = form.querySelector('.activity-reply-send');
      sendBtn.disabled = true;
      const activityId = parseInt(form.dataset.activityId, 10);
      const mutation = `mutation ($activityId: Int, $text: String) {
        SaveActivityReply(activityId: $activityId, text: $text) {
          id text createdAt user { id name avatar { large medium } }
        }
      }`;
      const data = await anilist(mutation, { activityId, text });
      sendBtn.disabled = false;
      const reply = data?.SaveActivityReply;
      if (reply) {
        const list = form.parentElement.querySelector('.activity-reply-list');
        if (list) list.insertAdjacentHTML('beforeend', renderReply(reply));
        input.value = '';
        // Bump the count next to the reply icon
        const card = form.closest('.activity-card');
        const count = card?.querySelector('.reply-count');
        if (count) count.textContent = (parseInt(count.textContent || '0', 10) + 1);
      }
    });
  });
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

async function loadCategory() {
  const grid = document.getElementById('category-grid');
  skeletonFill(grid, 12);
  const seasonClause = categoryState.isSeasonal ? `season: ${state.season}, seasonYear: ${state.seasonYear},` : '';
  const q = `query { Page(perPage: 50) { media(${seasonClause} sort: ${categoryState.sort}, type: ${categoryState.type}, isAdult: false) { ${MEDIA_FRAGMENT} } } }`;
  const data = await anilist(q);
  if (data?.Page?.media) grid.innerHTML = data.Page.media.map(renderCard).join('');
  else grid.innerHTML = `<div style="padding:20px; color:var(--text-dim); font-size:13px; grid-column: 1/-1;">Couldn't load.</div>`;
}

document.getElementById('category-sort-btn').addEventListener('click', () => {
  openSortModal(categoryState.sort, (newSort) => {
    categoryState.sort = newSort;
    document.getElementById('category-sort-label').textContent = labelForSort(newSort);
    loadCategory();
  });
});

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

async function loadGenre() {
  const grid = document.getElementById('genre-grid');
  skeletonFill(grid, 12);
  const q = `query ($genre: String, $type: MediaType, $sort: [MediaSort]) {
    Page(perPage: 50) {
      media(genre: $genre, type: $type, sort: $sort, isAdult: false) {
        ${MEDIA_FRAGMENT}
      }
    }
  }`;
  const data = await anilist(q, { genre: genreState.genre, type: genreState.type, sort: [genreState.sort] });
  if (data?.Page?.media?.length) {
    grid.innerHTML = data.Page.media.map(renderCard).join('');
  } else {
    grid.innerHTML = `<div class="no-results" style="grid-column: 1/-1;">No results for ${escapeHtml(genreState.genre)}.</div>`;
  }
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

async function loadStudio() {
  const grid = document.getElementById('studio-grid');
  skeletonFill(grid, 12);
  const q = `query ($id: Int, $sort: [MediaSort]) {
    Studio(id: $id) {
      media(sort: $sort, isMain: true, type: ANIME, perPage: 50) {
        nodes { ${MEDIA_FRAGMENT} }
      }
    }
  }`;
  const data = await anilist(q, { id: studioState.id, sort: [studioState.sort] });
  const items = data?.Studio?.media?.nodes;
  if (items?.length) {
    grid.innerHTML = items.map(renderCard).join('');
  } else {
    grid.innerHTML = `<div class="no-results" style="grid-column: 1/-1;">No works found.</div>`;
  }
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
  body.innerHTML = `
    <div class="char-hero">
      <div class="char-hero-image" style="background-image:url('${char.image?.large || ''}');"></div>
      <div class="char-hero-name">${escapeHtml(char.name?.userPreferred || '')}</div>
      ${edge.role ? `<div class="char-hero-role">${escapeHtml(edge.role.toLowerCase())} character</div>` : ''}
    </div>
    ${vas.length ? `
      <div class="detail-section" style="border-top: none; padding-top: 20px;">
        <h4>Voice Actors</h4>
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
const STAFF_SORT_OPTIONS = [
  { value: 'FAVOURITES_DESC', label: 'Popular' },
  { value: 'ROLE',            label: 'Main Roles' },
  { value: 'ID_DESC',         label: 'Latest' },
];
function staffSortLabel(v) {
  return STAFF_SORT_OPTIONS.find(o => o.value === v)?.label || 'Sort';
}

async function openVA(id, name) {
  staffState.id = id;
  staffState.name = name;
  staffState.sort = 'FAVOURITES_DESC';
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

async function loadStaff() {
  const grid = document.getElementById('staff-grid');
  skeletonFill(grid, 12);
  const q = `query ($id: Int, $sort: [CharacterSort]) {
    Staff(id: $id) {
      characters(sort: $sort, perPage: 50) {
        edges {
          role
          node {
            id
            name { userPreferred }
            image { large }
          }
          media {
            id
            title { userPreferred english romaji }
            coverImage { color }
            type
          }
        }
      }
    }
  }`;
  const data = await anilist(q, { id: staffState.id, sort: [staffState.sort] });
  const edges = data?.Staff?.characters?.edges;
  if (edges?.length) {
    grid.innerHTML = edges.map(renderVACharCard).filter(Boolean).join('');
    grid.querySelectorAll('.va-char-card').forEach(card => {
      card.addEventListener('click', () => {
        openMedia(parseInt(card.dataset.mediaId, 10));
      });
    });
  } else {
    grid.innerHTML = `<div class="no-results" style="grid-column: 1/-1;">No roles found.</div>`;
  }
}


// ============ MEDIA DETAIL ============
async function openMedia(id) {
  const overlay = document.getElementById('detail-overlay');
  const body = document.getElementById('detail-body');
  document.getElementById('detail-title').textContent = 'Loading…';
  body.innerHTML = `<div style="padding: 40px 20px; text-align:center; color:var(--text-dim);">Loading…</div>`;
  overlay.classList.add('visible');

  const q = `query ($id: Int) { Media(id: $id) { ${MEDIA_DETAIL_FRAGMENT} } }`;
  const data = await anilist(q, { id });
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

  const filteredRelations = filterRelations(m.relations?.edges);
  const recs = (m.recommendations?.edges || [])
    .map(e => e.node?.mediaRecommendation)
    .filter(r => r?.type === 'ANIME');

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
      <button class="btn-secondary" onclick="alert('Share sheet opens in the real app.')">Share</button>
    </div>
    ${mainStudio ? `
      <div class="detail-section">
        <h4>Studio</h4>
        <div class="genre-row">
          <div class="genre-pill studio-pill" data-studio-id="${mainStudio.id}" data-studio-name="${escapeHtml(mainStudio.name)}">${escapeHtml(mainStudio.name)}</div>
        </div>
      </div>` : ''}
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
    <div class="detail-section" data-relations-section ${filteredRelations.length ? '' : 'hidden'}>
      <h4>Relations</h4>
      <div class="carousel" data-relations-carousel>
        ${filteredRelations.map(renderRelationCard).join('')}
      </div>
    </div>
    ${recs.length ? `
      <div class="detail-section">
        <h4>Recommendations</h4>
        <div class="carousel">
          ${recs.map(renderCard).join('')}
        </div>
      </div>` : ''}
    ${m.characters?.edges?.length ? `
      <div class="detail-section">
        <h4>Characters</h4>
        <div class="character-row">
          ${m.characters.edges.map(e => `
            <div class="character-card" data-character-id="${e.node.id}">
              <div class="character-image" style="background-image:url('${e.node.image?.large || ''}');"></div>
              <div class="character-name">${escapeHtml(e.node.name?.userPreferred || '')}</div>
              <div class="character-role">${e.role ? escapeHtml(e.role.toLowerCase()) : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
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

  // Wire up the clickable studio (both the inline subtitle link AND the prominent pill)
  body.querySelectorAll('.sub-studio, .studio-pill').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = parseInt(el.dataset.studioId, 10);
      const name = el.dataset.studioName;
      if (!isNaN(id) && name) openStudio(id, name);
    });
  });

  // Expand the season chain in the background — walk PREQUEL/SEQUEL outward
  // so the user sees every season, not just the directly adjacent one.
  const relSection = body.querySelector('[data-relations-section]');
  const relCarousel = body.querySelector('[data-relations-carousel]');
  if (relSection && relCarousel) {
    const targetId = m.id;
    expandRelations(m.relations?.edges, m.id).then(expanded => {
      // Bail if the user opened a different anime in the meantime
      if (!currentMedia || currentMedia.id !== targetId) return;
      if (!expanded.length) {
        relSection.hidden = true;
        return;
      }
      relSection.hidden = false;
      relCarousel.innerHTML = expanded.map(renderRelationCard).join('');
    }).catch(() => { /* swallow — the directly-rendered list stays as fallback */ });
  }
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
  // Character cards → character overlay
  body.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      openCharacter(parseInt(card.dataset.characterId, 10));
    });
  });
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
  const data = await anilist(mutation, { mediaId: ratingMediaId, score });
  if (data?.SaveMediaListEntry) {
    const mid = ratingMediaId;
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

document.querySelectorAll('#view-seg .seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    syncSegState('view-seg', 'view', b.dataset.view);
    state.viewMode = b.dataset.view;
    applyViewMode();
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

// Wire the list-edit modal status chips and remove button
document.querySelectorAll('#list-edit-status .chip').forEach(c => {
  c.addEventListener('click', () => setListStatus(c.dataset.status));
});
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

// Boot — always run switchTab so state.activeTab + DOM stay in sync regardless of localStorage
switchTab(state.landing || 'home');
updateAuthUI();
if (state.accessToken) {
  fetchViewer();
}
