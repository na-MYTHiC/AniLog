// AniLog — utilities + render helpers.
// Everything that turns data into HTML strings lives here.
// Pure functions when possible; no event wiring (that lives in views/overlays/main).

// ============ FORMATTERS / TEXT HELPERS ============

// ============ INFINITE SCROLL HELPER ============
// Watches a sentinel at the end of `grid` inside `scrollContainer` and calls
// `fetchPage(page)` whenever the sentinel scrolls into view. fetchPage must
// return `{ items, hasMore }`. Items are rendered via `renderer` (defaults
// to renderCard). After each appended batch, `onAppend(grid)` runs (used by
// the social feed to re-attach like/reply handlers).
//
// Returned object exposes `.reload()` to reset pagination and re-fetch from
// page 1, and `.destroy()` to tear down the observer.
// skeletonFn (optional) fills the grid with placeholders while page 1 is in
// flight. It belongs here rather than at each call site: reload() clears the
// grid as its first act, so a caller that painted skeletons beforehand just
// had them thrown away a moment later.
function setupInfiniteScroll(grid, scrollContainer, fetchPage, renderer, onAppend, skeletonFn, emptyMessage) {
  const render = renderer || renderCard;
  const sentinel = document.createElement('div');
  sentinel.className = 'scroll-sentinel';
  sentinel.style.cssText = 'grid-column: 1/-1; padding: 18px; text-align: center; color: var(--text-dim); font-size: 12px;';

  let page = 1;
  let hasMore = true;
  let loading = false;
  let reqId = 0;
  let observer = null;
  // Counted across pages so the empty state only appears once we've actually
  // run out. A caller can't decide this right after reload(): a page can come
  // back with zero renderable items and still have more pages behind it —
  // which is normal now that Studio filters out producer-only credits.
  let appended = 0;

  function clearSkeletons() {
    grid.querySelectorAll(':scope > .is-placeholder').forEach((el) => el.remove());
  }

  function showSkeletons() {
    if (typeof skeletonFn !== 'function') return;
    // Render into a detached node, tag each child, then move them in — so we
    // can remove exactly these later without touching real results.
    const holder = document.createElement('div');
    skeletonFn(holder);
    Array.from(holder.children).forEach((child) => {
      child.classList.add('is-placeholder');
      grid.insertBefore(child, sentinel);
    });
  }

  async function loadNext() {
    if (loading || !hasMore) return;
    loading = true;
    const myReq = reqId;
    // Page 1 shows skeletons instead of the tiny sentinel caption; later
    // pages show the caption, since real content already fills the screen.
    sentinel.textContent = page === 1 && typeof skeletonFn === 'function' ? '' : 'Loading…';
    try {
      const result = await fetchPage(page);
      if (myReq !== reqId) return;
      // A null result means the request FAILED. Treated as `items: []` it
      // rendered the caller's empty message — "No results.", "No results for
      // this genre." — so an outage or a rate limit looked exactly like a
      // genuinely empty page. Fall into the catch below, which already shows
      // "Couldn't load more." with a Retry.
      if (result === null || result === undefined) throw new Error('fetch failed');
      const items = result.items || [];
      clearSkeletons();
      sentinel.insertAdjacentHTML('beforebegin', items.map(render).join(''));
      if (typeof onAppend === 'function') onAppend(grid);
      appended += items.length;
      hasMore = !!result?.hasMore;
      page += 1;
      if (hasMore) {
        sentinel.textContent = '';
      } else if (appended === 0 && emptyMessage) {
        sentinel.textContent = emptyMessage;
      } else {
        sentinel.textContent = appended === 0 ? '' : '— end of list —';
      }
    } catch (e) {
      clearSkeletons();
      // Rebuilt as a button so a failed page can be re-requested in place.
      // The observer won't retry on its own: the sentinel is already in view,
      // so no new intersection fires until something scrolls.
      sentinel.innerHTML = `<span>Couldn't load more.</span> <button class="retry-btn" type="button">Retry</button>`;
      const btn = sentinel.querySelector('.retry-btn');
      if (btn) btn.addEventListener('click', () => {
        sentinel.textContent = 'Loading…';
        loadNext();
      });
    } finally {
      loading = false;
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNext();
    }, { root: scrollContainer, rootMargin: '400px 0px' });
    observer.observe(sentinel);
  }

  return {
    async reload() {
      reqId += 1;
      page = 1;
      hasMore = true;
      loading = false;
      appended = 0;
      grid.innerHTML = '';
      grid.appendChild(sentinel);
      sentinel.textContent = '';
      showSkeletons();
      setupObserver();
      await loadNext();
    },
    destroy() {
      if (observer) observer.disconnect();
      sentinel.remove();
    },
  };
}

// Cover art as a real <img> rather than a CSS background-image. Only <img>
// gets native loading="lazy" (so offscreen covers in a long infinite-scroll
// list aren't fetched at all) and decoding="async" (so decode work stays off
// the main thread). The wrapper div keeps the size/radius/shadow and its
// background-color — AniList's dominant colour — shows as a placeholder
// while the image loads, and remains if it fails.
//
// alt is intentionally empty: every cover sits next to its title as real
// text, so describing it again would just make screen readers repeat it.
function coverImg(url) {
  if (!url) return '';
  return `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Pick title respecting the English preference toggle
function pickTitle(t) {
  if (!t) return '';
  if (state.preferEnglish && t.english) return t.english;
  return t.userPreferred || t.romaji || t.english || '';
}


function capitalize(s) { return s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : ''; }
function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function formatNextEpisode(next) {
  const s = next.timeUntilAiring;
  if (!s || s <= 0) return `airs soon`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  let parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (!d && m) parts.push(m + 'm');
  return `${next.episode} in ${parts.join(' ')}`;
}


function formatHM(seconds) {
  if (!seconds || seconds <= 0) return 'soon';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${m}m`;
}

// Local wall-clock time an episode airs, in the viewer's own locale and their
// own 12/24-hour convention. A broadcast schedule is only useful in local time.
function formatClock(unixSeconds) {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// "18d 4h", not "437 hours". Days are the unit people actually quote at each
// other for time spent watching.
function formatWatchTime(minutes) {
  const mins = Math.max(0, Math.round(minutes || 0));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${mins}m`;
}

// The rolling seven days starting today, as local-midnight boundaries.
//
// Rolling, not Monday-to-Sunday: "what's coming" is the question a schedule
// answers, and a calendar week puts half of itself in the past by Thursday.
// It also means every weekly show lands in exactly one bucket — a Monday show
// viewed on Tuesday is six days out, still inside the window.
function scheduleWindow() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const weekday = start.toLocaleDateString(undefined, { weekday: 'long' });
    days.push({
      offset: i,
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000),
      // "Today" beats "Thu" for the day you're standing in; past that the
      // weekday alone is ambiguous once you're several days out, so the date
      // comes along in the section heading (not in the chip, which has to
      // stay one short word for seven of them to fit the rail).
      chip: i === 0 ? 'Today' : start.toLocaleDateString(undefined, { weekday: 'short' }),
      title: i === 0 ? `Today · ${weekday}`
        : i === 1 ? `Tomorrow · ${weekday}`
        : `${weekday} · ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    });
  }
  return days;
}

function labelForSort(value) {
  return MEDIA_SORT_OPTIONS.find(o => o.value === value)?.label || 'Sort';
}
function listStatusLabel(v) { return LIST_STATUS_OPTIONS.find(o => o.value === v)?.label || 'Watching'; }
function listSortLabel(v) { return LIST_SORT_OPTIONS.find(o => o.value === v)?.label || 'Score'; }

// ============ THEME / DENSITY / SEG STATE ============

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  // Resolve the effective accent. Bright themes (Snow) become invisible on a
  // white surface, so they carry a `lightColor` we swap in for the light theme.
  const themeDef = (typeof THEMES !== 'undefined' ? THEMES : []).find(t => t.id === state.themeId);
  const effectiveAccent = (state.theme === 'light' && themeDef?.lightColor) || state.accent;
  document.documentElement.style.setProperty('--accent', effectiveAccent);
  const hex = effectiveAccent.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.15)`);
  // Pick a legible foreground for accent-background surfaces. Pale accents
  // (Snow) need dark text; everything else stays with white. Uses relative
  // luminance so any future light-hued theme picks up the right color too.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  document.documentElement.style.setProperty('--accent-on', lum > 0.7 ? '#0d0d12' : '#ffffff');
  // Read the theme's own --bg rather than repeating it here. This used to be a
  // parallel ternary listing the same three hex values the stylesheet already
  // defines, which is one edit away from the status bar and the app disagreeing.
  // It also has to match what the document paints, because Android tints the
  // status bar from this and the gesture bar from the page background.
  const themeColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim() || '#0d0d12';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColor);
  // Icon is now a static black & white SVG (see assets/icons/icon.svg) — no theme-driven
  // override. The browser tab + apple-touch-icon point straight at the file.
}
function applyDensity() {
  document.documentElement.setAttribute('data-density', state.density);
}
applyTheme();
applyDensity();

function syncSegState(segId, key, value) {
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset[key] === value);
  });
}

// ============ SKELETONS ============

// Skeleton card that mirrors a real .card's layout — full-width cover with
// the right aspect ratio, a title bar, and a meta line. Width values come
// from the density CSS vars so it doesn't fight the surrounding grid.
function skeletonCard() {
  return `
    <div class="card">
      <div class="card-image skeleton"></div>
      <div class="skeleton" style="height: var(--card-title-size); border-radius: 4px; margin-top: var(--card-title-mt); width: 88%;"></div>
      <div class="skeleton" style="height: var(--card-meta-size); border-radius: 4px; margin-top: 4px; width: 55%;"></div>
    </div>`;
}


function skeletonFill(el, n) {
  el.innerHTML = Array(n).fill(skeletonCard()).join('');
}


// Takes the media array directly rather than a whole response, because the
// search tab now fetches all its carousels in one aliased query — each row's
// data arrives under its own alias, not under a shared `Page`.
function renderCarouselInto(el, media, onRetry) {
  if (!el) return;
  if (Array.isArray(media) && media.length) {
    el.innerHTML = media.map(renderCard).join('');
    return;
  }
  // A failed row used to be a dead end — the only way back was leaving the
  // tab and returning. Give it a way to ask again in place.
  el.innerHTML = `
    <div class="load-failed">
      <span>Couldn't load.</span>
      ${typeof onRetry === 'function' ? '<button class="retry-btn" type="button">Retry</button>' : ''}
    </div>`;
  const btn = el.querySelector('.retry-btn');
  if (btn) btn.addEventListener('click', () => {
    el.innerHTML = '';
    skeletonFill(el, 6);
    onRetry();
  });
}

// Home tab is the My List placeholder — no carousels to load until sign-in is wired.

function skeletonFillVARoles(el, n) {
  el.innerHTML = Array(n).fill(`
    <div class="va-role-row">
      <div class="va-role-char skeleton"></div>
      <div class="va-role-info">
        <div class="skeleton" style="height: 13px; width: 60%; border-radius: 4px;"></div>
        <div class="skeleton" style="height: 10px; width: 30%; border-radius: 4px; margin-top: 6px;"></div>
        <div class="skeleton" style="height: 11px; width: 80%; border-radius: 4px; margin-top: 6px;"></div>
      </div>
      <div class="va-role-cover skeleton"></div>
    </div>
  `).join('');
}

function skeletonFillRows(el, n) {
  el.innerHTML = Array(n).fill(`
    <div class="list-row">
      <div class="list-row-cover skeleton"></div>
      <div class="list-row-body">
        <div class="skeleton" style="height: var(--row-title-size); width: 70%; border-radius: 4px;"></div>
        <div class="skeleton" style="height: var(--row-bar-h); border-radius: 999px; margin-top: 4px;"></div>
        <div class="skeleton" style="height: var(--row-meta-size); width: 45%; border-radius: 4px; margin-top: 4px;"></div>
      </div>
    </div>
  `).join('');
}


// ============ CARD / ROW RENDERERS ============

// ============ CARD BADGES ============
// Under the title rather than over the cover: an icon sitting on the artwork
// was both hard to read and in the way. These are words, in the line where
// the format ("TV") used to be — that told you almost nothing, while episode
// count and list membership are what you actually scan for.
//
// Nothing renders for a show that isn't on a list, so an unbadged card means
// "not added" without having to say so.
// Labels only. These carried a colour each (green Watching, blue Planning
// and so on), which meant six fixed hues sitting next to ten user-selectable
// accents and two themes — a palette the app doesn't control, clashing with
// one it does. The word already says which list it is, so the pill is drawn
// in theme tokens and the colour is gone.
const LIST_STATUS_BADGES = {
  CURRENT:   'Watching',
  PLANNING:  'Planning',
  COMPLETED: 'Completed',
  PAUSED:    'Paused',
  DROPPED:   'Dropped',
  REPEATING: 'Rewatch',
};

// Episodes you can actually watch right now, not the announced total.
//
// nextAiringEpisode only exists while a show is airing, so its presence is
// the "is this ongoing" signal and episode-1 is what has aired. Falling back
// to the total covers finished shows (no countdown) and airing ones with no
// published schedule. Ongoing shows with no announced total used to fail both
// halves of that and render no badge at all.
//
// Zero is dropped by the callers rather than shown: a show whose first
// episode is still pending says more by having no badge than by claiming
// "0 ep".
//
// One function, not two. The card badge and the My List row each had their
// own copy of this reasoning and the two disagreed in both directions — the
// card's didn't clamp to the announced total, so a bad countdown could claim
// more episodes than exist, and it ignored NOT_YET_RELEASED, so an unreleased
// show with a published episode count advertised its whole run as already out.
function airedCount(m) {
  if (!m) return 0;
  const total = m.episodes || 0;
  const next = m.nextAiringEpisode?.episode;
  let aired;
  // A countdown is authoritative — use it even when it works out to zero,
  // rather than falling through to the total. `aired || m.episodes` did fall
  // through, so a show still waiting on episode 1 advertised its full
  // announced run as already out.
  if (Number.isFinite(next)) aired = Math.max(next - 1, 0);
  else if (m.status === 'NOT_YET_RELEASED') aired = 0;
  else aired = total;
  return total > 0 ? Math.min(aired, total) : aired;
}

// Update the list badge on every card for one media that's already on screen.
//
// Adding a show used to leave Search and Seasonal showing the old state until
// those tabs were rebuilt from scratch — and they only rebuild when their
// container is empty, so in practice the badge could stay wrong indefinitely.
// Rewriting the one span is far cheaper than re-rendering a tab, and it keeps
// every view consistent the moment the write lands.
function repaintListBadges(mediaId, entry) {
  const label = LIST_STATUS_BADGES[entry?.status];
  document.querySelectorAll(`.card[data-media-id="${mediaId}"]`).forEach((card) => {
    let wrap = card.querySelector('.card-badges');
    const existing = wrap?.querySelector('.card-badge-on');

    if (!label) { if (existing) existing.remove(); }
    else if (existing) { existing.textContent = label; }
    else {
      // No status badge yet — and possibly no badge row at all, when the card
      // had neither an episode count nor a list status.
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'card-badges';
        card.appendChild(wrap);
      }
      const span = document.createElement('span');
      span.className = 'card-badge card-badge-on';
      span.textContent = label;
      wrap.appendChild(span);
    }
    // An empty badge row is hidden by CSS in carousels, but leaving a stray
    // element behind would still affect layout in the grids.
    if (wrap && !wrap.children.length) wrap.remove();
  });
}

function cardBadges(m) {
  const out = [];
  const eps = airedCount(m);
  if (eps) out.push(`<span class="card-badge">${eps} ep</span>`);
  const st = LIST_STATUS_BADGES[m.mediaListEntry?.status];
  if (st) out.push(`<span class="card-badge card-badge-on">${st}</span>`);
  return out.length ? `<div class="card-badges">${out.join('')}</div>` : '';
}

function renderCard(m) {
  if (!m) return '';
  const score = m.averageScore ? `<div class="card-score">★ ${(m.averageScore / 10).toFixed(1)}</div>` : '';
  return `
    <div class="card" data-media-id="${m.id}" onclick="openMedia(${m.id})">
      <div class="card-image" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">
        ${coverImg(m.coverImage?.large)}
        ${score}
      </div>
      <div class="card-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
      ${cardBadges(m)}
    </div>
  `;
}


function filterRelations(edges) {
  const allowed = state.strictRelations
    ? ['PREQUEL', 'SEQUEL']
    : ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'OTHER'];
  return (edges || []).filter(e => e.node?.type === 'ANIME' && allowed.includes(e.relationType));
}

// Sort relation edges by start date (oldest first). Falls back to seasonYear.
function sortRelationsByDate(edges) {
  return edges.slice().sort((a, b) => {
    const ay = a.node?.startDate?.year || a.node?.seasonYear || 9999;
    const by = b.node?.startDate?.year || b.node?.seasonYear || 9999;
    if (ay !== by) return ay - by;
    const am = a.node?.startDate?.month || 1;
    const bm = b.node?.startDate?.month || 1;
    return am - bm;
  });
}

// Fields each relation card needs. Shared by the batched walk below and its
// per-id fallback so the two can't drift apart.
const RELATION_EDGE_FIELDS = `
  relationType
  node {
    id type
    title { userPreferred english romaji }
    coverImage { large color }
    averageScore format episodes season seasonYear
    startDate { year month day }
  }
`;

// One request for a whole BFS level. Falls back to the old per-id queries if
// the batch form fails for any reason, so a franchise still resolves — just
// slower — rather than the section coming up empty.
async function fetchRelationEdges(ids) {
  const BATCH = 25;   // keep each query under AniList's complexity ceiling
  const chunks = [];
  for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));

  const batched = `query ($ids: [Int]) {
    Page(perPage: ${BATCH}) {
      media(id_in: $ids) {
        id
        relations { edges { ${RELATION_EDGE_FIELDS} } }
      }
    }
  }`;

  try {
    const pages = await Promise.all(chunks.map((chunk) =>
      // Low priority: this runs below the fold, and yielding the fast lane
      // keeps a tap on another card responsive while the walk continues.
      anilist(batched, { ids: chunk }, { priority: 'low' })
    ));
    const media = pages.flatMap((d) => d?.Page?.media || []);
    // A non-empty frontier that comes back with nothing means the batch form
    // isn't doing what we think it is — take the fallback rather than
    // silently reporting the franchise as one season long.
    if (media.length) return media.flatMap((m) => m.relations?.edges || []);
    if (!ids.length) return [];
  } catch (e) { /* fall through */ }

  const single = `query ($id: Int) { Media(id: $id) { relations { edges { ${RELATION_EDGE_FIELDS} } } } }`;
  const responses = await Promise.all(ids.map(async (id) => {
    try {
      const data = await anilist(single, { id }, { priority: 'low' });
      return data?.Media?.relations?.edges || [];
    } catch (e) { return []; }
  }));
  return responses.flat();
}

// Walk PREQUEL/SEQUEL chains outward from the source media to surface every
// season in the franchise. One AniList call per level of the walk (not per
// neighbour), capped by depth. `onProgress` is handed the results so far after
// every level, so the carousel fills in as the chain resolves instead of
// staying on the direct relations until the whole walk finishes.
// Returns a flat list of edges (with the same shape as direct relations).
async function expandRelations(directEdges, sourceMediaId, onProgress) {
  const chainTypes = ['PREQUEL', 'SEQUEL'];
  const broadTypes = state.strictRelations
    ? chainTypes
    : ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'OTHER'];

  const collected = new Map();   // id → edge
  const visited = new Set([sourceMediaId]);

  // Seed: every direct relation that matches the broad filter goes in
  (directEdges || []).forEach(e => {
    const n = e.node;
    if (n && n.type === 'ANIME' && broadTypes.includes(e.relationType) && !visited.has(n.id)) {
      collected.set(n.id, e);
    }
  });

  // BFS along PREQUEL/SEQUEL only (the actual season chain)
  let frontier = (directEdges || [])
    .filter(e => e.node?.type === 'ANIME' && chainTypes.includes(e.relationType) && !visited.has(e.node.id))
    .map(e => e.node.id);

  const MAX_DEPTH = 6;
  let depth = 0;

  while (frontier.length && depth < MAX_DEPTH) {
    const toFetch = frontier.filter(id => !visited.has(id));
    toFetch.forEach(id => visited.add(id));
    if (!toFetch.length) break;
    const next = [];

    const edges = await fetchRelationEdges(toFetch);

    for (const edge of edges) {
      const n = edge.node;
      if (!n || n.type !== 'ANIME' || visited.has(n.id)) continue;
      if (broadTypes.includes(edge.relationType) && !collected.has(n.id)) {
        collected.set(n.id, edge);
      }
      // Only PREQUEL/SEQUEL continue the chain — side stories don't recurse
      if (chainTypes.includes(edge.relationType)) {
        next.push(n.id);
      }
    }
    frontier = next;
    depth++;
    if (onProgress && collected.size) {
      try { onProgress(sortRelationsByDate(Array.from(collected.values()))); }
      catch (e) { /* a painting failure shouldn't abandon the walk */ }
    }
  }

  return sortRelationsByDate(Array.from(collected.values()));
}

// Card variant with a colored relation-type tag overlaid on the cover (no score — it overlapped)
function renderRelationCard(edge) {
  const m = edge.node;
  if (!m) return '';
  const relationLabel = capitalize(edge.relationType.replace(/_/g, ' '));
  const count = m.episodes ? ` · ${m.episodes} ep` : '';
  const meta = m.format ? `<div class="card-meta">${m.format.replace(/_/g, ' ')}${count}</div>` : '';
  return `
    <div class="card" data-media-id="${m.id}" onclick="openMedia(${m.id})">
      <div class="card-image" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">
        ${coverImg(m.coverImage?.large)}
        <div class="relation-tag">${escapeHtml(relationLabel)}</div>
      </div>
      <div class="card-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
      ${meta}
    </div>
  `;
}


// Two modes, one component. The full row is what My List shows: progress bar,
// how far behind you are, and the swipe targets behind it. `bare` drops all
// three, which is what a schedule row for a show you AREN'T tracking needs —
// there's no progress to draw, "11 behind" is meaningless for something you
// never started, and offering +1 on an entry that doesn't exist would be a
// lie. Growing a second row component for that would have put two slightly
// different row geometries next to each other in the same list.
//
// `opts` is defended against being a number because the common call is
// `entries.map(renderListEntryRow)`, which would hand the array index in.
function renderListEntryRow(entry, opts) {
  const m = entry.media;
  if (!m) return '';
  const o = (opts && typeof opts === 'object') ? opts : {};
  const bare = o.bare === true;
  const progress = entry.progress || 0;
  const total = m.episodes || 0;
  const aired = airedCount(m);
  const behind = Math.max(0, aired - progress);
  const denom = total > 0 ? total : Math.max(aired, progress, 12);
  const progressPct = Math.max(0, Math.min(100, (progress / denom) * 100));
  const airedPct = Math.max(0, Math.min(100, (aired / denom) * 100));

  const sep = '<span class="sep">·</span>';
  const parts = [];
  // Airing time, on a schedule row. First, because it's what that row is
  // sorted and grouped by.
  if (o.lead) parts.push(o.lead);
  if (!bare) parts.push(`<strong>${progress}</strong>/${total || '?'}`);
  // Which episode is airing. Supplied by the schedule, where the countdown
  // below would just restate the time already at the front of the line.
  if (o.episode) parts.push(`Ep ${o.episode}`);
  // AniList community score. Dropped on a schedule row: the meta line is one
  // nowrap line, and on a row that already leads with a time and an episode
  // the score is what pushes "4 behind" — the only part you can act on — past
  // the ellipsis.
  if (m.averageScore && !o.episode) {
    parts.push(`<span class="row-score-community">★ ${(m.averageScore / 10).toFixed(1)}</span>`);
  }
  // The user's own score (only if they've rated it) — tinted in the accent color
  if (entry.score > 0) {
    parts.push(`<span class="row-score-user">★ ${entry.score} you</span>`);
  }
  if (!o.episode && m.nextAiringEpisode && m.nextAiringEpisode.timeUntilAiring > 0) {
    parts.push(`Ep ${m.nextAiringEpisode.episode} in ${formatHM(m.nextAiringEpisode.timeUntilAiring)}`);
  }
  if (!bare && behind > 0) parts.push(`<span class="behind">${behind} behind</span>`);

  return `
    <div class="list-row-wrap" data-media-id="${m.id}">
      ${bare ? '' : `<div class="list-row-action list-row-action-sub">−1</div>
      <div class="list-row-action list-row-action-add">+1</div>`}
      <div class="list-row">
        <div class="list-row-cover" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">${coverImg(m.coverImage?.large)}</div>
        <div class="list-row-body">
          <div class="list-row-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
          ${bare ? '' : `<div class="list-row-bar">
            ${aired > 0 ? `<div class="list-row-bar-aired" style="width:${airedPct}%"></div>` : ''}
            ${progress > 0 ? `<div class="list-row-bar-watched" style="width:${progressPct}%"></div>` : ''}
          </div>`}
          <div class="list-row-meta">${parts.join(' ' + sep + ' ')}</div>
        </div>
      </div>
    </div>
  `;
}

// ============ UP NEXT CARD (Home) ============
// A .card with two substitutions. The corner pill holds the episode you're
// about to watch rather than the community score — in this one strip that's
// the reason the card is there — and a +1 sits under the title so the action
// the strip exists for doesn't need a trip through the detail page.
// "N behind" rides in the normal .card-badge slot, so nothing new is invented
// for it.
function renderNextCard(entry) {
  const m = entry?.media;
  if (!m) return '';
  const next = (entry.progress || 0) + 1;
  const behind = Math.max(0, airedCount(m) - (entry.progress || 0));
  const badge = behind > 1
    ? `<div class="card-badges"><span class="card-badge">${behind} behind</span></div>`
    : '';
  return `
    <div class="card next-card" data-media-id="${m.id}">
      <div class="card-image" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">
        ${coverImg(m.coverImage?.large)}
        <div class="next-ep">EP ${next}</div>
      </div>
      <div class="card-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
      ${badge}
      <button class="next-bump" type="button" data-bump="${m.id}">+1</button>
    </div>
  `;
}

// Attach swipe-to-update + tap-to-open to each row wrap

// A voice actor's role is two things at once — a character, and the show
// they're in. This used to be a grid of large circular character portraits
// with the show relegated to a line of grey text, so scanning "what has this
// person been in" meant reading rather than looking. Now a row carrying both
// images: character on the left (who), show cover on the right (where).
function renderVACharCard(edge) {
  if (!edge) return '';

  // Accepts both shapes AniList can hand back for "who did this person play":
  //   characterMedia — edge.node is the MEDIA, edge.characters the cast
  //   characters     — edge.node is the CHARACTER, edge.media the shows
  // The app queries the first; tolerating the second means a change of
  // endpoint can't silently empty this screen again, which is exactly how
  // it broke: every edge failed the media check and rendered an empty
  // string, so the list looked blank with nothing logged.
  let char, media, roleRaw;
  if (edge.characters || edge.characterRole) {
    media = edge.node;
    char = (edge.characters || [])[0];
    roleRaw = edge.characterRole;
  } else {
    char = edge.node;
    const list = edge.media || [];
    // Prefer anime appearances (this is an anime-only app), fall back to first
    media = list.find(m => m.type === 'ANIME') || list[0];
    roleRaw = edge.role;
  }
  if (!media) return '';

  const role = roleRaw ? capitalize(roleRaw) : '';
  const mediaTitle = pickTitle(media.title);
  return `
    <div class="va-role-row" data-media-id="${media.id}" data-char-id="${char?.id || ''}">
      <div class="va-role-char">${coverImg(char?.image?.large)}</div>
      <div class="va-role-info">
        <div class="va-role-name">${escapeHtml(char?.name?.userPreferred || mediaTitle)}</div>
        ${role ? `<div class="va-role-tag">${escapeHtml(role)}</div>` : ''}
        <div class="va-role-show">${escapeHtml(mediaTitle)}</div>
      </div>
      <div class="va-role-cover" style="background-color:${media.coverImage?.color || 'var(--surface-2)'};">${coverImg(media.coverImage?.large)}</div>
    </div>
  `;
}


// ============ PROFILE STATISTICS ============
// Every graphic here is divs sized with a percentage width or height. A chart
// library would be the largest single thing in the app's payload and it would
// buy one screen, so the three shapes this needs — a stacked bar, a ten-column
// histogram and a list of bars — are drawn by hand.

function statTile(value, label) {
  return `
    <div class="stat-tile">
      <div class="stat-tile-value">${escapeHtml(String(value))}</div>
      <div class="stat-tile-label">${escapeHtml(label)}</div>
    </div>`;
}

// Status split. Ordered to match LIST_STATUS_OPTIONS so the segments come in
// the same sequence as the status picker on Home, rather than in whatever
// order reads best in isolation.
function renderStatStack(statuses) {
  const order = LIST_STATUS_OPTIONS.filter(o => o.value !== 'ALL').map(o => o.value);
  const rows = order
    .map(st => ({ st, count: (statuses || []).find(s => s.status === st)?.count || 0 }))
    .filter(r => r.count > 0);
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (!total) return '';
  return `
    <div class="stat-block">
      <span class="field-label">Status</span>
      <div class="stat-stack">
        ${rows.map(r => `<div class="stat-seg" data-status="${r.st}" style="width:${(r.count / total * 100).toFixed(2)}%"></div>`).join('')}
      </div>
      <div class="stat-legend">
        ${rows.map(r => `
          <div class="stat-legend-row">
            <i class="stat-dot" data-status="${r.st}"></i>
            <span>${escapeHtml(listStatusLabel(r.st))}</span>
            <strong>${formatNum(r.count)}</strong>
          </div>`).join('')}
      </div>
    </div>`;
}

// Score distribution, bucketed to the 1-10 scale the app's own rate modal
// writes. AniList reports whatever scale the account is set to, so a 100-point
// score is folded into the matching ten-point bucket instead of being dropped.
//
// Not tappable, unlike the bars below it. "The 23 titles you rated 8" would
// need a score-filtered list view, which the app doesn't have — so the columns
// are drawn as what they are rather than as buttons that lead somewhere vague.
function renderStatHist(scores) {
  const buckets = Array(10).fill(0);
  (scores || []).forEach((s) => {
    const raw = Number(s?.score);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const ten = raw > 10 ? Math.round(raw / 10) : Math.round(raw);
    buckets[Math.min(10, Math.max(1, ten)) - 1] += s.count || 0;
  });
  const max = Math.max(...buckets);
  if (!max) return '';
  return `
    <div class="stat-block">
      <span class="field-label">Your scores</span>
      <div class="stat-hist">
        ${buckets.map((n, i) => `
          <div class="stat-hist-col" role="img" aria-label="${n} rated ${i + 1}">
            <span class="stat-hist-bar" style="height:${(n / max * 100).toFixed(1)}%"></span>
          </div>`).join('')}
      </div>
      <div class="stat-hist-axis"><span>1</span><span>5</span><span>10</span></div>
    </div>`;
}

// A list of labelled bars — genres, formats, release years. `kind` names what
// a row links to; a row with no kind renders as a plain, non-tappable bar
// rather than pretending to be a button.
function renderStatBars(label, rows, kind) {
  const top = (rows || [])
    .filter(r => r && r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  if (!top.length) return '';
  const max = top[0].count;
  return `
    <div class="stat-block">
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="stat-bars">
        ${top.map(r => `
          <button class="stat-bar-row" type="button"
                  ${kind ? `data-stat-kind="${kind}" data-stat-value="${escapeHtml(String(r.name))}"` : 'disabled'}>
            <span class="stat-bar-name">${escapeHtml(String(r.name))}</span>
            <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${(r.count / max * 100).toFixed(1)}%"></span></span>
            <span class="stat-bar-count">${formatNum(r.count)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

// Matches the shape of the real block (tiles, then three graphics) so the
// card doesn't change height when the data lands.
function statsSkeleton() {
  const bar = (w, h, mt) => `<div class="skeleton" style="height:${h}; width:${w}; border-radius: 999px; margin-top:${mt};"></div>`;
  return `
    <div class="stat-tiles">
      ${Array(4).fill(`<div class="stat-tile">
        ${bar('60%', '19px', '0')}
        ${bar('80%', '10px', '7px')}
      </div>`).join('')}
    </div>
    <div class="stat-block">
      ${bar('30%', '11px', '0')}
      ${bar('100%', 'var(--stat-bar-h)', '12px')}
    </div>
    <div class="stat-block">
      ${bar('30%', '11px', '0')}
      ${bar('100%', 'var(--chart-h)', '12px')}
    </div>`;
}
