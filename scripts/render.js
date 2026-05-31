// AniLog — utilities + render helpers.
// Everything that turns data into HTML strings lives here.
// Pure functions when possible; no event wiring (that lives in views/overlays/main).

// ============ FORMATTERS / TEXT HELPERS ============

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
  document.documentElement.style.setProperty('--accent', state.accent);
  const hex = state.accent.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.15)`);
  const themeColor = state.theme === 'amoled' ? '#000000' : state.theme === 'light' ? '#f7f7fa' : '#0d0d12';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColor);
  // Icon is now a static black & white SVG (see icon.svg) — no theme-driven
  // override. The browser tab + apple-touch-icon point straight at the file.
}
function applyDensity() {
  document.documentElement.setAttribute('data-density', state.density);
}
function applyViewMode() {
  document.documentElement.setAttribute('data-view', state.viewMode || 'mobile');
}
applyTheme();
applyDensity();
applyViewMode();

function syncSegState(segId, key, value) {
  document.querySelectorAll(`#${segId} .seg-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset[key] === value);
  });
}

// ============ SKELETONS ============

function skeletonCard() {
  return `<div class="card"><div class="card-image skeleton"></div><div class="card-title skeleton" style="height:14px; border-radius:4px; margin-top:8px;"></div></div>`;
}


function skeletonFill(el, n) {
  el.innerHTML = Array(n).fill(skeletonCard()).join('');
}


function renderIntoEl(el, data) {
  if (data?.Page?.media?.length) {
    el.innerHTML = data.Page.media.map(renderCard).join('');
  } else {
    el.innerHTML = `<div style="padding:20px; color:var(--text-dim); font-size:13px;">Couldn't load.</div>`;
  }
}

// Home tab is the My List placeholder — no carousels to load until sign-in is wired.

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
    <div class="card" onclick="openMedia(${m.id})">
      <div class="card-image" style="background-image:url('${m.coverImage?.large || ''}'); background-color:${m.coverImage?.color || 'var(--surface-2)'};">
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
    <div class="card" onclick="openMedia(${m.id})">
      <div class="card-image" style="background-image:url('${m.coverImage?.large || ''}'); background-color:${m.coverImage?.color || 'var(--surface-2)'};">
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
        <div class="list-row-cover" style="background-image:url('${m.coverImage?.large || ''}'); background-color:${m.coverImage?.color || 'var(--surface-2)'};"></div>
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

function renderVACharCard(edge) {
  const char = edge?.node;
  if (!char) return '';
  // Prefer anime appearances (this is an anime-only app), fall back to first
  const mediaList = edge.media || [];
  const media = mediaList.find(m => m.type === 'ANIME') || mediaList[0];
  if (!media) return '';
  const role = edge.role ? capitalize(edge.role) : '';
  const mediaTitle = pickTitle(media.title);
  const showLine = role ? `${role} · ${mediaTitle}` : mediaTitle;
  return `
    <div class="va-char-card" data-media-id="${media.id}" data-char-id="${char.id}">
      <div class="va-char-image" style="background-image:url('${char.image?.large || ''}'); background-color:${media.coverImage?.color || 'var(--surface-2)'};"></div>
      <div class="va-char-name">${escapeHtml(char.name?.userPreferred || '')}</div>
      <div class="va-char-show">${escapeHtml(showLine)}</div>
    </div>
  `;
}

