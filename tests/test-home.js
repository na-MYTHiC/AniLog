// The Home tab: the list dropdown in the bar title, the list/grid switch, sort,
// the bar sharing its corner with the floating bell, and the four list styles
// with the Cover Colours tint.
//
// What this guards:
//  - the counts are the server's truth, and a FAILED count is not a zero
//  - the list dropdown switches with one list request and no sideways scroll
//  - grid view renders cards, survives a reload, and its retry panel spans
//    the whole grid instead of one cell
//  - every style renders in list and grid, with and without the tint, and a
//    swipe still writes +1 and repaints in the SAME style
//  - a cover colour that isn't a hex colour can't inject CSS
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

  // ---- list dropdown and counts ------------------------------------------------
  console.log('List dropdown');
  {
    const { page, S, seen } = await boot(b, { listStatus: 'CURRENT' });
    const t = truth(S);
    await page.waitForTimeout(800);   // the counts are on the low-priority lane
    const title = await page.evaluate(() => ({
      label: document.getElementById('list-status-label').textContent,
      count: document.getElementById('list-status-count').textContent,
      shown: getComputedStyle(document.getElementById('list-status-btn')).display !== 'none',
      rail: !!document.getElementById('status-rail'),
    }));
    check('title is the list name and its count', title.shown && title.label === 'Watching'
      && title.count === String(t.CURRENT), JSON.stringify(title));
    check('no sideways-scrolling rail any more', !title.rail);

    await page.evaluate(() => document.getElementById('list-status-btn').click());
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => ({
      open: document.getElementById('sort-modal').classList.contains('visible'),
      title: document.getElementById('sort-modal-title').textContent,
      opts: [...document.querySelectorAll('#sort-list .sort-option')].map(o => ({
        v: o.dataset.value,
        n: o.querySelector('.sort-option-count')?.textContent ?? null,
        on: !!o.querySelector('.sort-option-check'),
      })),
    }));
    check('dropdown opens the list sheet', sheet.open && sheet.title === 'My List', JSON.stringify(sheet.title));
    check('every list is in the sheet, all visible at once', sheet.opts.length === STATUSES.length + 1,
      sheet.opts.map(o => o.v).join(','));
    check('each list shows its server count', sheet.opts.every(o => o.n === String(t[o.v] || 0)),
      sheet.opts.map(o => `${o.v}=${o.n}/${t[o.v] || 0}`).join(' '));
    check('current list is ticked', sheet.opts.filter(o => o.on).map(o => o.v).join() === 'CURRENT');

    seen.length = 0;
    await page.evaluate(() => document.querySelector('#sort-list .sort-option[data-value="COMPLETED"]').click());
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      status: state.listStatus,
      label: document.getElementById('list-status-label').textContent,
      count: document.getElementById('list-status-count').textContent,
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      sheetOpen: document.getElementById('sort-modal').classList.contains('visible'),
    }));
    check('picking a list switches to it and closes the sheet', after.status === 'COMPLETED'
      && after.label === 'Completed' && !after.sheetOpen, JSON.stringify(after));
    check('title count follows', after.count === String(t.COMPLETED), `${after.count} / ${t.COMPLETED}`);
    check('rows are the picked list', after.rows === t.COMPLETED, `${after.rows} rows, server has ${t.COMPLETED}`);
    const listReqs = seen.filter(r => r.q.includes('MediaListCollection') && r.v.status === 'COMPLETED').length;
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
    await page.evaluate(() => document.getElementById('list-status-btn').click());
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      title: document.getElementById('list-status-count').textContent,
      sheetCounts: [...document.querySelectorAll('#sort-list .sort-option-count')].map(e => e.textContent),
      opts: document.querySelectorAll('#sort-list .sort-option').length,
      rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
    }));
    check('title shows no count rather than a wrong one', r.title === '', JSON.stringify(r.title));
    check('sheet lists every list without claiming zeros', r.opts === STATUSES.length + 1 && r.sheetCounts.length === 0,
      JSON.stringify(r.sheetCounts));
    check('the list itself still loads', r.rows > 0, `${r.rows} rows`);
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
      allChip: document.getElementById('list-status-count').textContent,
    }));
    const total = truth(S).ALL;
    check('All shows each show once', r.rows === total && new Set(r.ids).size === r.ids.length,
      `${r.rows} rows, ${new Set(r.ids).size} unique, server ${total}`);
    check('All count in the title agrees with the rows', r.allChip === String(r.rows), `title ${r.allChip} / rows ${r.rows}`);
    await page.close();
  }

  // ---- the bar and the bell --------------------------------------------------
  // The bell is the bar's last control: on its centre line, inside the gutter,
  // and scrolling away with it rather than floating over the list.
  console.log('Bar and bell');
  for (const [w, density] of [[360, 'compact'], [393, 'comfortable'], [430, 'spacious']]) {
    const S = makeState();
    const page = await b.newPage({ viewport: { width: w, height: 860 } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)), { ...BASE, density, listStatus: 'ALL' });
    await page.route('**/*', handler(S));
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2400);
    const g = await page.evaluate(async () => {
      const bellEl = document.getElementById('notif-bell');
      const bell = bellEl.getBoundingClientRect();
      const acts = document.getElementById('list-actions').getBoundingClientRect();
      const bar = document.querySelector('#tab-home .list-bar').getBoundingClientRect();
      const content = document.getElementById('content');
      content.scrollTop = 300;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = bellEl.getBoundingClientRect();
      return {
        inBar: !!bellEl.closest('.list-bar'),
        gap: Math.round(bell.left - acts.right),
        dy: Math.round((acts.top + acts.height / 2) - (bell.top + bell.height / 2)),
        right: Math.round(bar.right - bell.right),
        scrolled: Math.round(bell.top - after.top), moved: content.scrollTop,
      };
    });
    check(`${w}px: bell sits in the bar, after the controls, on their centre line`,
      g.inBar && g.gap >= 4 && Math.abs(g.dy) <= 1 && g.right >= 14, JSON.stringify(g));
    check(`${w}px: bell scrolls with the list`, g.moved > 0 && g.scrolled === g.moved, JSON.stringify(g));
    await page.close();
  }

  // ---- the tab is called List --------------------------------------------------
  {
    const { page } = await boot(b, {});
    const t = await page.evaluate(() => {
      const n = document.querySelector('.nav-btn[data-tab="home"]');
      return { label: n.textContent.trim(), aria: n.getAttribute('aria-label'),
               landing: document.querySelector('[data-landing="home"]').textContent.trim() };
    });
    check('first tab reads List everywhere', t.label === 'List' && t.aria === 'List' && t.landing === 'List', JSON.stringify(t));
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

  // ---- list styles ---------------------------------------------------------------
  console.log('List styles');
  const MARK = { classic: '.list-row-meta-sub', cards: '.lr-edge', ring: '.lr-ring', editorial: '.lr-big' };
  const GMARK = { classic: '.card-progress, .card-title', cards: '.lc-body', ring: '.lc-ring-badge', editorial: '.lc-caps' };
  for (const style of ['classic', 'cards', 'ring', 'editorial']) {
    for (const tint of [false, true]) {
      const tag = `${style}${tint ? '+tint' : ''}`;
      const { page, seen } = await boot(b, { listStatus: 'CURRENT', listView: 'list', listStyle: style, listTint: tint });
      const l = await page.evaluate(([mark]) => {
        const g = document.getElementById('my-list-grid');
        const wraps = [...g.querySelectorAll('.list-row-wrap')];
        const frame = document.querySelector('.app').getBoundingClientRect();
        const spill = [...g.querySelectorAll('*')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.width && (r.right > frame.right + 1 || r.left < frame.left - 1);
        }).length;
        const w0 = wraps[0];
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const rowAccent = w0 ? getComputedStyle(w0).getPropertyValue('--row-accent').trim() : '';
        return {
          cls: g.className, rows: wraps.length,
          marked: wraps.filter(w => w.querySelector(mark)).length,
          swipeTargets: wraps.filter(w => w.querySelector('.list-row-action-add')).length,
          tinted: wraps.every(w => /^--tint:\s*(#[0-9a-f]{3,8}|var\(--accent\))/i.test(w.getAttribute('style') || '')),
          rowAccent, accent, spill,
        };
      }, [MARK[style]]);
      check(`${tag}: list renders in its style`, l.rows > 0 && l.marked === l.rows
        && new RegExp(`\\blst-${style}\\b`).test(l.cls) && /\blst-tint\b/.test(l.cls) === tint,
        `${l.marked}/${l.rows} · ${l.cls}`);
      check(`${tag}: nothing spills off the screen`, l.spill === 0, `${l.spill} elements`);
      if (style !== 'classic') check(`${tag}: every row keeps its swipe targets`, l.swipeTargets === l.rows);
      check(`${tag}: tint ${tint ? 'replaces' : 'leaves'} the theme accent`,
        tint ? (l.rowAccent && l.rowAccent !== l.accent) : !l.rowAccent, `row-accent="${l.rowAccent}"`);

      // A real swipe: +1 written once, and the row repainted in the same style.
      if (!tint) {
        const box = await page.evaluate(() => {
          const r = document.querySelector('#my-list-grid .list-row').getBoundingClientRect();
          return { x: r.left + r.width * 0.75, y: r.top + r.height / 2,
                   id: +document.querySelector('#my-list-grid .list-row-wrap').dataset.mediaId };
        });
        const before = await page.evaluate((id) => {
          for (const g of Object.values(cache)) {
            const e = (g?.MediaListCollection?.lists || []).flatMap(l => l.entries || []).find(x => x.media?.id === id);
            if (e) return e.progress;
          }
          return null;
        }, box.id);
        seen.length = 0;
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.x - 130, box.y, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(1000);
        const muts = seen.filter(r => r.q.includes('SaveMediaListEntry'));
        const kept = await page.evaluate(([id, mark]) =>
          !!document.querySelector(`#my-list-grid .list-row-wrap[data-media-id="${id}"] ${mark}`), [box.id, MARK[style]]);
        check(`${tag}: swipe writes +1 once`, muts.length === 1 && muts[0].v.mediaId === box.id
          && muts[0].v.progress === (before || 0) + 1, JSON.stringify(muts.map(m => m.v)));
        check(`${tag}: the repainted row keeps its style`, kept);
      }

      // Same style in grid.
      await page.evaluate(() => document.querySelector('#list-view-seg [data-view="grid"]').click());
      await page.waitForTimeout(800);
      // Layout, not just markup: the Ring grid once had every card collapse into
      // one 27px circle (a class-name collision) while a markup check passed.
      const gr = await page.evaluate(([mark]) => {
        const g = document.getElementById('my-list-grid');
        const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
        const gw = g.getBoundingClientRect().width;
        const cards = [...g.querySelectorAll('.list-card')];
        const boxes = cards.map(c => c.getBoundingClientRect());
        const minW = gw / cols * 0.7;
        const tops = new Set(boxes.map(r => Math.round(r.top)));
        return {
          n: cards.length,
          marked: cards.filter(c => c.querySelector(mark)).length,
          sized: boxes.filter(r => r.width >= minW && r.height >= r.width).length,
          rows: tops.size, cols,
          positionedCards: cards.filter(c => getComputedStyle(c).position === 'absolute').length,
        };
      }, [GMARK[style]]);
      check(`${tag}: grid renders in its style`, gr.n > 0 && gr.marked === gr.n, `${gr.marked}/${gr.n}`);
      check(`${tag}: every card is laid out as a real grid cell`,
        gr.sized === gr.n && gr.positionedCards === 0 && gr.rows === Math.ceil(gr.n / gr.cols),
        `${gr.sized}/${gr.n} sized, ${gr.rows} rows x ${gr.cols} cols, ${gr.positionedCards} absolutely positioned`);
      await page.close();
    }
  }

  // ---- settings drive it live ----------------------------------------------------
  console.log('Settings');
  {
    const { page } = await boot(b, { listStatus: 'CURRENT', listView: 'list' });
    await page.evaluate(() => switchTab('profile'));
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => ({
      style: !!document.querySelector('#list-style-seg'),
      tint: !!document.querySelector('#list-tint-seg'),
      // Both live in Appearance, after Card Density.
      order: [...document.querySelectorAll('#tab-profile .settings-label')].map(e => e.textContent.trim()),
    }));
    const iDensity = rows.order.indexOf('Card Density');
    check('List Style and Cover Colours are in Appearance, after Card Density',
      rows.style && rows.tint && rows.order[iDensity + 1] === 'List Style' && rows.order[iDensity + 2] === 'Cover Colours',
      rows.order.slice(iDensity, iDensity + 3).join(' → '));
    await page.evaluate(() => document.querySelector('#list-style-seg [data-style="editorial"]').click());
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('#list-tint-seg [data-tint="on"]').click());
    await page.waitForTimeout(200);
    const live = await page.evaluate(() => ({
      cls: document.getElementById('my-list-grid').className,
      big: document.querySelectorAll('#my-list-grid .lr-big').length,
      saved: JSON.parse(localStorage.getItem('anilog-prefs')),
    }));
    check('choosing a style repaints My List straight away', /\blst-editorial\b/.test(live.cls) && live.big > 0, live.cls);
    check('the tint switch applies without a rebuild', /\blst-tint\b/.test(live.cls));
    check('both are saved', live.saved.listStyle === 'editorial' && live.saved.listTint === true,
      JSON.stringify({ s: live.saved.listStyle, t: live.saved.listTint }));
    await page.close();
  }

  // ---- a cover colour can't inject CSS -------------------------------------------
  console.log('Tint safety');
  {
    const { page } = await boot(b, {});
    const r = await page.evaluate(() => {
      const evil = { id: 5, title: { userPreferred: 'X' }, episodes: 12,
        coverImage: { large: '', color: '#fff;background:url(https://evil.example/x)' } };
      const html = renderListEntryRow({ id: 1, status: 'CURRENT', progress: 1, score: 0, media: evil }, { style: 'cards' })
        + renderListCard({ id: 1, status: 'CURRENT', progress: 1, score: 0, media: evil }, { style: 'ring' });
      const el = document.createElement('div');
      el.innerHTML = html;
      return [...el.querySelectorAll('[style*="--tint"]')].map(e => e.getAttribute('style'));
    });
    check('a non-hex cover colour falls back to the accent', r.length === 2
      && r.every(st => st.includes('--tint:var(--accent)') && !st.includes('url(')), JSON.stringify(r));
    await page.close();
  }

  // ---- guest -------------------------------------------------------------------
  console.log('Signed out');
  {
    const { page } = await boot(b, { accessToken: null });
    const r = await page.evaluate(() => ({
      picker: getComputedStyle(document.getElementById('list-status-btn')).display,
      plain: getComputedStyle(document.getElementById('list-title-static')).display,
      actions: getComputedStyle(document.getElementById('list-actions')).display,
    }));
    check('a guest sees a plain "My List" title, no list controls',
      r.picker === 'none' && r.plain !== 'none' && r.actions === 'none', JSON.stringify(r));
    await page.close();
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
