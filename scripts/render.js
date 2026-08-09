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
      const items = result?.items || [];
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
  const themeColor = state.theme === 'amoled' ? '#000000' : state.theme === 'light' ? '#f7f7fa' : '#0d0d12';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColor);
  // Icon is now a static black & white SVG (see icon.svg) — no theme-driven
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

function renderCard(m) {
  if (!m) return '';
  const score = m.averageScore ? `<div class="card-score">★ ${(m.averageScore / 10).toFixed(1)}</div>` : '';
  const count = m.episodes ? ` · ${m.episodes} ep` : '';
  const meta = m.format ? `<div class="card-meta">${m.format.replace(/_/g, ' ')}${count}</div>` : '';
  return `
    <div class="card" data-media-id="${m.id}" onclick="openMedia(${m.id})">
      <div class="card-image" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">
        ${coverImg(m.coverImage?.large)}
        ${score}
      </div>
      <div class="card-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
      ${meta}
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

// Walk PREQUEL/SEQUEL chains outward from the source media to surface every
// season in the franchise. Each step costs one AniList call; capped by depth.
// Returns a flat list of edges (with the same shape as direct relations).
async function expandRelations(directEdges, sourceMediaId) {
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
    const next = [];

    const responses = await Promise.all(toFetch.map(async (id) => {
      const q = `query ($id: Int) {
        Media(id: $id) {
          relations {
            edges {
              relationType
              node {
                id type
                title { userPreferred english romaji }
                coverImage { large color }
                averageScore format episodes season seasonYear
                startDate { year month day }
              }
            }
          }
        }
      }`;
      const data = await anilist(q, { id });
      return data?.Media?.relations?.edges || [];
    }));

    for (const edges of responses) {
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
    }
    frontier = next;
    depth++;
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


function renderListEntryRow(entry) {
  const m = entry.media;
  if (!m) return '';
  const progress = entry.progress || 0;
  const total = m.episodes || 0;
  let aired = total;
  if (m.nextAiringEpisode && m.nextAiringEpisode.episode > 0) {
    aired = m.nextAiringEpisode.episode - 1;
  } else if (m.status === 'NOT_YET_RELEASED') {
    aired = 0;
  }
  aired = Math.min(aired, total || aired);
  const behind = Math.max(0, aired - progress);
  const denom = total > 0 ? total : Math.max(aired, progress, 12);
  const progressPct = Math.max(0, Math.min(100, (progress / denom) * 100));
  const airedPct = Math.max(0, Math.min(100, (aired / denom) * 100));

  const sep = '<span class="sep">·</span>';
  const parts = [];
  parts.push(`<strong>${progress}</strong>/${total || '?'}`);
  // AniList community score — always show when available
  if (m.averageScore) {
    parts.push(`<span class="row-score-community">★ ${(m.averageScore / 10).toFixed(1)}</span>`);
  }
  // The user's own score (only if they've rated it) — tinted in the accent color
  if (entry.score > 0) {
    parts.push(`<span class="row-score-user">★ ${entry.score} you</span>`);
  }
  if (m.nextAiringEpisode && m.nextAiringEpisode.timeUntilAiring > 0) {
    parts.push(`Ep ${m.nextAiringEpisode.episode} in ${formatHM(m.nextAiringEpisode.timeUntilAiring)}`);
  }
  if (behind > 0) parts.push(`<span class="behind">${behind} behind</span>`);

  return `
    <div class="list-row-wrap" data-media-id="${m.id}">
      <div class="list-row-action list-row-action-sub">−1</div>
      <div class="list-row-action list-row-action-add">+1</div>
      <div class="list-row">
        <div class="list-row-cover" style="background-color:${m.coverImage?.color || 'var(--surface-2)'};">${coverImg(m.coverImage?.large)}</div>
        <div class="list-row-body">
          <div class="list-row-title">${escapeHtml(pickTitle(m.title) || 'Unknown')}</div>
          <div class="list-row-bar">
            ${aired > 0 ? `<div class="list-row-bar-aired" style="width:${airedPct}%"></div>` : ''}
            ${progress > 0 ? `<div class="list-row-bar-watched" style="width:${progressPct}%"></div>` : ''}
          </div>
          <div class="list-row-meta">${parts.join(' ' + sep + ' ')}</div>
        </div>
      </div>
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
  const char = edge?.node;
  if (!char) return '';
  // Prefer anime appearances (this is an anime-only app), fall back to first
  const mediaList = edge.media || [];
  const media = mediaList.find(m => m.type === 'ANIME') || mediaList[0];
  if (!media) return '';
  const role = edge.role ? capitalize(edge.role) : '';
  const mediaTitle = pickTitle(media.title);
  return `
    <div class="va-role-row" data-media-id="${media.id}" data-char-id="${char.id}">
      <div class="va-role-char">${coverImg(char.image?.large)}</div>
      <div class="va-role-info">
        <div class="va-role-name">${escapeHtml(char.name?.userPreferred || '')}</div>
        ${role ? `<div class="va-role-tag">${escapeHtml(role)}</div>` : ''}
        <div class="va-role-show">${escapeHtml(mediaTitle)}</div>
      </div>
      <div class="va-role-cover" style="background-color:${media.coverImage?.color || 'var(--surface-2)'};">${coverImg(media.coverImage?.large)}</div>
    </div>
  `;
}

