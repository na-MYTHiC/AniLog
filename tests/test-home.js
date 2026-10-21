// The Home tab's controls: the status rail with counts, the list/grid switch,
// sort in the bar, and the bar sharing its corner with the floating bell.
//
// What this guards:
//  - the counts are the server's truth, and a FAILED count is not a zero
//  - one tap on a chip switches list (it used to be tap, sheet, tap)
//  - a saved off-screen status is scrolled into view once the rail shows
//  - grid view renders cards, survives a reload, and its retry panel spans
//    the whole grid instead of one cell
//  - All excludes custom lists (they repeat entries already under a status)
//  - the bar's controls never slide under the bell
//  - one-line titles keep every row the same height
const { chromium } = require('playwright');
const { makeState, handler, STATUSES } = require('./anilist-fake');

let fails = 0;
const check = (n, ok, d) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d !== undefined ? '  ' + d : ''}`);
};
const BASE = { theme: 'dark', density: 'comfortable', themeId: 'iris', accent: '#7c5cff', accessToken: 'TOK' };

async function boot(b, prefs = {}, wrap) {
  const S = makeState();
  const page = await b.newPage({ viewport: { width: 393, height: 852 } });
  // Seed once per tab. addInitScript runs on EVERY navigation, so a plain
  // setItem here would overwrite whatever the app saved and make a reload
  // test meaningless. sessionStorage survives the reload; a fresh tab doesn't.
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('anilog-prefs', JSON.stringify(p));
    sessionStorage.setItem('seeded', '1');
  }, { ...BASE, ...prefs });
  const seen = [];
  const h = handler(S, { onRequest: (q, v) => seen.push({ q, v }) });
  await page.route('**/*', wrap ? wrap(h, S) : h);
  await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  return { page, S, seen };
}

// Server truth, from the fake's own state.
const truth = (S) => {
  const c = {}; let total = 0;
  for (const e of S.entries.values()) { c[e.status] = (c[e.status] || 0) + 1; total++; }
  c.ALL = total;
  return c;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---- rail and counts ------------------------------------------------------
  console.log('Status rail');
  {
    const { page, S, seen } = await boot(b, { listStatus: 'CURRENT' });
    const t = truth(S);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.status-chip')].map(c => ({
      status: c.dataset.status,
      n: c.querySelector('.chip-n')?.textContent ?? null,
      active: c.classList.contains('active'),
      selected: c.getAttribute('aria-selected'),
    })));
    check('a chip for every status plus All', chips.length === STATUSES.length + 1,
      chips.map(c => c.status).join(','));
    check('counts match the server', chips.every(c => String(t[c.status] || 0) === c.n),
      chips.map(c => `${c.status}=${c.n}/${t[c.status] || 0}`).join(' '));
    check('selected list is the active chip, and says so',
      chips.filter(c => c.active).length === 1 && chips.find(c => c.active).status === 'CURRENT'
        && chips.find(c => c.active).selected === 'true');

    // One tap switches list.
    seen.length = 0;
    await page.evaluate(() => document.querySelector('.status-chip[data-status="PLANNING"]').click());
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      status: state.listStatus,
      active: document.querySelector('.status-chip.active')?.dataset.status,
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      sheetOpen: document.getElementById('sort-modal').classList.contains('visible'),
    }));
    check('one tap switches list, no sheet', after.status === 'PLANNING' && after.active === 'PLANNING'
      && !after.sheetOpen, JSON.stringify(after));
    check('rows are the tapped list', after.rows === t.PLANNING, `${after.rows} rows, server has ${t.PLANNING}`);
    const listReqs = seen.filter(r => r.q.includes('MediaListCollection') && r.v.status === 'PLANNING').length;
    check('switching is one list request', listReqs === 1, `${listReqs}`);
    await page.close();
  }

  // ---- a failed count is not zero ------------------------------------------
  console.log('Counts fail');
  {
    const { page } = await boot(b, { listStatus: 'CURRENT' }, (h) => async (route) => {
      const q = JSON.parse(route.request().postData() || '{}').query || '';
      if (q.includes('isCustomList entries { status }')) return route.abort('failed');
      return h(route);
    });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({
      chips: document.querySelectorAll('.status-chip').length,
      numbers: [...document.querySelectorAll('.status-chip .chip-n')].map(e => e.textContent),
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
    }));
    check('chips still render', r.chips === STATUSES.length + 1);
    check('no chip claims zero when the count failed', r.numbers.length === 0, JSON.stringify(r.numbers));
    check('the list itself still loads', r.rows > 0, `${r.rows} rows`);
    await page.close();
  }

  // ---- saved off-screen status is revealed ----------------------------------
  console.log('Reveal');
  {
    const { page } = await boot(b, { listStatus: 'ALL' });
    const r = await page.evaluate(() => {
      const rail = document.getElementById('status-rail').getBoundingClientRect();
      const c = document.querySelector('.status-chip.active').getBoundingClientRect();
      return { left: Math.round(c.left), right: Math.round(c.right), railL: Math.round(rail.left), railR: Math.round(rail.right) };
    });
    check('saved "All" chip is on screen after boot', r.left >= r.railL && r.right <= r.railR, JSON.stringify(r));
    await page.close();
  }

  // ---- grid view ---------------------------------------------------------------
  console.log('Grid view');
  {
    const { page, S } = await boot(b, { listStatus: 'CURRENT', listView: 'list' });
    await page.evaluate(() => document.querySelector('#list-view-seg [data-view="grid"]').click());
    await page.waitForTimeout(900);
    const g = await page.evaluate(() => ({
      cards: document.querySelectorAll('#my-list-grid .list-card').length,
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      cls: document.getElementById('my-list-grid').className,
      progress: [...document.querySelectorAll('#my-list-grid .card-progress-n')].map(e => e.textContent),
      fills: [...document.querySelectorAll('#my-list-grid .card-progress-track i')]
        .map(e => Math.round(e.getBoundingClientRect().width)),
      pressed: document.querySelector('#list-view-seg [data-view="grid"]').classList.contains('active'),
    }));
    const watching = truth(S).CURRENT;
    check('grid renders a card per entry and no rows', g.cards === watching && g.rows === 0,
      `${g.cards} cards / ${g.rows} rows (server ${watching})`);
    check('grid uses the list-grid columns', /\blist-grid\b/.test(g.cls), g.cls);
    check('cards show progress as a fraction', g.progress.length > 0 && g.progress.every(p => /^\d+\/(\d+|\?)$/.test(p)),
      JSON.stringify(g.progress));
    check('progress fills actually paint', g.fills.some(w => w > 0), JSON.stringify(g.fills));
    check('toggle reflects grid', g.pressed);

    // Survives a reload.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2600);
    const reloaded = await page.evaluate(() => ({
      view: state.listView,
      cards: document.querySelectorAll('#my-list-grid .list-card').length,
    }));
    check('grid view persists across reload', reloaded.view === 'grid' && reloaded.cards > 0, JSON.stringify(reloaded));

    // Back to list: rows return with their swipe targets.
    await page.evaluate(() => document.querySelector('#list-view-seg [data-view="list"]').click());
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => ({
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      swipe: document.querySelectorAll('#my-list-grid .list-row-action-add').length,
      cards: document.querySelectorAll('#my-list-grid .list-card').length,
    }));
    check('list view returns rows with swipe targets', back.rows > 0 && back.swipe === back.rows && back.cards === 0,
      JSON.stringify(back));
    await page.close();
  }

  // ---- grid failure panel spans the grid -----------------------------------
  console.log('Grid fails');
  {
    const { page } = await boot(b, { listStatus: 'CURRENT', listView: 'grid' }, (h) => async (route) => {
      const q = JSON.parse(route.request().postData() || '{}').query || '';
      if (q.includes('MediaListCollection') && q.includes('progress media')) return route.abort('failed');
      return h(route);
    });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => {
      const grid = document.getElementById('my-list-grid');
      const panel = grid.querySelector('.no-results');
      return {
        text: grid.textContent.replace(/\s+/g, ' ').trim().slice(0, 50),
        retry: !!grid.querySelector('.retry-btn'),
        panelW: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        gridW: Math.round(grid.getBoundingClientRect().width),
      };
    });
    check('failure says so with a retry', /Couldn.t load/.test(r.text) && r.retry, r.text);
    check('failure panel spans the whole grid, not one cell', r.panelW > r.gridW * 0.8, `${r.panelW}/${r.gridW}px`);
    await page.close();
  }

  // ---- All skips custom lists ------------------------------------------------
  console.log('All and custom lists');
  {
    // AniList returns custom lists alongside status lists when no status is
    // given; this fake adds one that repeats two entries.
    const { page, S } = await boot(b, { listStatus: 'ALL' }, (h, S) => async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const q = body.query || '', v = body.variables || {};
      if (q.includes('MediaListCollection') && !v.status && !q.includes('status_in')) {
        const orig = route.fulfill.bind(route);
        route.fulfill = async (opts) => {
          const json = JSON.parse(opts.body);
          const lists = json.data?.MediaListCollection?.lists || [];
          const dup = lists.flatMap(l => l.entries).slice(0, 2);
          lists.push({ name: 'Favourites', isCustomList: true, status: null, entries: dup });
          return orig({ ...opts, body: JSON.stringify(json) });
        };
      }
      return h(route);
    });
    const r = await page.evaluate(() => ({
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      ids: [...document.querySelectorAll('#my-list-grid .list-row-wrap')].map(w => w.dataset.mediaId),
      allChip: document.querySelector('.status-chip[data-status="ALL"] .chip-n')?.textContent,
    }));
    const total = truth(S).ALL;
    check('All shows each show once', r.rows === total && new Set(r.ids).size === r.ids.length,
      `${r.rows} rows, ${new Set(r.ids).size} unique, server ${total}`);
    check('All chip agrees with the rows', r.allChip === String(r.rows), `chip ${r.allChip} / rows ${r.rows}`);
    await page.close();
  }

  // ---- the bar and the bell --------------------------------------------------
  console.log('Bar and bell');
  for (const [w, density] of [[360, 'compact'], [393, 'comfortable'], [430, 'spacious']]) {
    const S = makeState();
    const page = await b.newPage({ viewport: { width: w, height: 860 } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)), { ...BASE, density });
    await page.route('**/*', handler(S));
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2400);
    const g = await page.evaluate(() => {
      const bell = document.getElementById('notif-bell').getBoundingClientRect();
      const acts = document.getElementById('list-actions').getBoundingClientRect();
      return {
        gap: Math.round(bell.left - acts.right),
        dy: Math.round((acts.top + acts.height / 2) - (bell.top + bell.height / 2)),
      };
    });
    check(`${w}px: controls clear the bell and share its centre line`, g.gap >= 4 && Math.abs(g.dy) <= 1,
      `gap ${g.gap}px, Δy ${g.dy}px`);
    await page.close();
  }

  // ---- row rhythm --------------------------------------------------------------
  console.log('Row rhythm');
  {
    const { page } = await boot(b, { listStatus: 'ALL' });
    const r = await page.evaluate(() => {
      // A title long enough to wrap twice at this width.
      const t = document.querySelector('#my-list-grid .list-row-title');
      t.textContent = 'An Extremely Long Light Novel Adaptation Title That Goes On: Season Two Part Three';
      const hs = [...document.querySelectorAll('#my-list-grid .list-row')].slice(0, 6)
        .map(e => Math.round(e.getBoundingClientRect().height));
      const cs = getComputedStyle(document.documentElement);
      const expect = parseFloat(cs.getPropertyValue('--row-cover-h')) + 2 * parseFloat(cs.getPropertyValue('--row-pad-y'));
      return { hs, expect };
    });
    check('every row is cover + padding tall, long title or not',
      r.hs.every(h => Math.abs(h - r.expect) <= 1), `${JSON.stringify(r.hs)} expected ${r.expect}`);
    await page.close();
  }

  // ---- guest -------------------------------------------------------------------
  console.log('Signed out');
  {
    const { page } = await boot(b, { accessToken: null });
    const r = await page.evaluate(() => ({
      rail: getComputedStyle(document.getElementById('status-rail')).display,
      actions: getComputedStyle(document.getElementById('list-actions')).display,
    }));
    check('rail and list controls hidden for a guest', r.rail === 'none' && r.actions === 'none', JSON.stringify(r));
    await page.close();
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
