// The four views added in v4.90: Up Next on Home, the weekly schedule on
// Seasonal, combinable search filters, and Profile statistics.
//
// What this is actually guarding:
//  - every one of them renders real content against the fake, not a skeleton
//  - a FAILED request shows something retryable, never an empty state
//    (the rule the whole tests/ directory exists to enforce)
//  - +1 on an Up Next card writes once and retires the card
//  - filters go out as GraphQL VARIABLES, never interpolated into the query
//  - filters survive the search box being cleared
//  - the schedule's "My List" scope reuses the Up Next response instead of
//    issuing a second list query
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');

let fails = 0;
const check = (n, ok, d) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d !== undefined ? '  ' + d : ''}`);
};
const FAIL_WORDS = /Couldn't load|Couldn.t load|Retry/i;

const PREFS = { theme: 'dark', themeId: 'iris', accessToken: 'TOK', seasonalView: 'grid', scheduleScope: 'mine' };

async function boot(b, opts = {}) {
  const S = makeState();
  const page = await b.newPage({ viewport: { width: 412, height: 915 } });
  const seen = [];
  await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)),
    { ...PREFS, ...(opts.prefs || {}) });
  await page.route('**/*', handler(S, {
    onRequest: (q, v) => seen.push({ q, v }),
    ...opts,
  }));
  await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  return { page, S, seen };
}

const label = (r) => r.q.includes('SaveMediaListEntry') ? 'MUTATION'
  : r.q.includes('Viewer') ? 'Viewer'
  : r.q.includes('status_in') ? 'Watching'
  : r.q.includes('MediaListCollection') ? 'MyList'
  : r.q.includes('MediaTagCollection') ? 'Tags'
  : /User\s*\(/.test(r.q) ? 'UserStats'
  : r.q.includes('status: RELEASING') ? 'AllAiring'
  : 'Page';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---- Up Next -------------------------------------------------------------
  console.log('Up Next (Home)');
  {
    const { page, seen } = await boot(b);
    const s = await page.evaluate(() => {
      const sec = document.getElementById('up-next');
      return {
        hidden: sec.hidden,
        cards: sec.querySelectorAll('.next-card').length,
        count: document.getElementById('up-next-count').textContent,
        pill: sec.querySelector('.next-ep')?.textContent || '',
        bumps: sec.querySelectorAll('.next-bump').length,
        // The strip must not be a second copy of the list rows below it.
        rows: document.querySelectorAll('#my-list-grid .list-row-wrap').length,
      };
    });
    check('strip is visible with cards', !s.hidden && s.cards > 0, `${s.cards} cards`);
    check('count matches the cards', s.count === String(s.cards), `badge="${s.count}"`);
    check('corner pill holds an episode', /^EP \d+$/.test(s.pill), `"${s.pill}"`);
    check('every card has a +1', s.bumps === s.cards);
    check('list rows still render below', s.rows > 0, `${s.rows} rows`);

    // Only shows you're behind on, and ordered most-behind first.
    const order = await page.evaluate(() => upNextRows.map(e => ({
      behind: airedCount(e.media) - (e.progress || 0),
    })));
    check('only shows you are behind on', order.every(o => o.behind > 0));
    check('most-behind first', order.every((o, i) => i === 0 || order[i - 1].behind >= o.behind),
      order.map(o => o.behind).join(','));

    // +1 writes once, and a card that reaches caught-up leaves the strip.
    const before = await page.evaluate(() => ({
      id: upNextRows[0].media.id,
      behind: airedCount(upNextRows[0].media) - (upNextRows[0].progress || 0),
    }));
    seen.length = 0;
    await page.evaluate(() => document.querySelector('.next-card .next-bump').click());
    await page.waitForTimeout(1400);
    const muts = seen.filter(r => label(r) === 'MUTATION');
    check('+1 fires exactly one mutation', muts.length === 1, `${muts.length}`);
    check('+1 sent the right media and progress',
      muts[0]?.v?.mediaId === before.id && typeof muts[0]?.v?.progress === 'number',
      JSON.stringify(muts[0]?.v));
    const after = await page.evaluate((id) => {
      const card = document.querySelector(`.next-card[data-media-id="${id}"]`);
      return { present: !!card, pill: card?.querySelector('.next-ep')?.textContent || null };
    }, before.id);
    if (before.behind > 1) {
      check('still-behind card stays, pill advances', after.present && after.pill !== null,
        `pill="${after.pill}"`);
    } else {
      check('caught-up card leaves the strip', !after.present);
    }
    await page.close();
  }

  // ---- Weekly schedule ----------------------------------------------------
  console.log('Weekly schedule (Seasonal)');
  {
    const { page, seen } = await boot(b);
    await page.evaluate(() => switchTab('seasonal'));
    await page.waitForTimeout(1200);
    // Computed display, NOT the hidden attribute. .seg, .sort-trigger,
    // .season-nav-btn and .grid all declare their own display, which outranks
    // the UA rule behind `hidden` — asserting on the attribute passed while
    // all four were still painted on screen.
    const visibility = (p) => p.evaluate(() => {
      const on = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      return {
        gridShown: on('seasonal-grid'),
        schedShown: on('seasonal-schedule'),
        sortShown: on('seasonal-sort-btn'),
        scopeShown: on('schedule-scope-seg'),
        arrowsShown: on('season-prev') || on('season-next'),
      };
    });
    const grid = await visibility(page);
    check('grid view: grid up, sort up, arrows up, schedule and scope down',
      grid.gridShown && grid.sortShown && grid.arrowsShown && !grid.schedShown && !grid.scopeShown,
      JSON.stringify(grid));

    seen.length = 0;
    await page.evaluate(() => document.querySelector('#seasonal-view-seg [data-sview="schedule"]').click());
    await page.waitForTimeout(1400);
    const sched = { ...(await visibility(page)), ...(await page.evaluate(() => ({
      title: document.getElementById('seasonal-title').textContent.trim(),
      chips: document.querySelectorAll('.day-chip').length,
      days: document.querySelectorAll('.sched-day').length,
      rows: document.querySelectorAll('#schedule-days .list-row-wrap').length,
      skeletons: document.querySelectorAll('#schedule-days .skeleton').length,
      times: [...document.querySelectorAll('#schedule-days .row-time')].slice(0, 3).map(e => e.textContent),
    }))) };
    check('schedule view swaps grid for schedule and sort for scope',
      sched.schedShown && !sched.gridShown && !sched.sortShown && sched.scopeShown,
      JSON.stringify({ s: sched.schedShown, g: sched.gridShown, so: sched.sortShown, sc: sched.scopeShown }));
    check('season arrows hidden (no season to step)', !sched.arrowsShown);
    check('header reads This Week', sched.title === 'This Week', `"${sched.title}"`);
    check('seven day chips', sched.chips === 7, `${sched.chips}`);
    check('seven day sections', sched.days === 7, `${sched.days}`);
    check('rows rendered, not skeletons', sched.rows > 0 && sched.skeletons === 0,
      `${sched.rows} rows / ${sched.skeletons} skeletons`);
    check('rows lead with an airing time', sched.times.length > 0 && sched.times.every(t => /\d/.test(t)),
      JSON.stringify(sched.times));

    // "My List" must reuse the Up Next response rather than asking again.
    const listCalls = seen.filter(r => label(r) === 'Watching').length;
    check('My List scope issues no new list query', listCalls === 0, `${listCalls} calls`);

    // Every row in the My List scope is a tracked show, so all of them get the
    // full treatment — bar and swipe targets included.
    const mine = await page.evaluate(() => {
      const wraps = [...document.querySelectorAll('#schedule-days .list-row-wrap')];
      return {
        n: wraps.length,
        withBar: wraps.filter(w => w.querySelector('.list-row-bar')).length,
        withActions: wraps.filter(w => w.querySelector('.list-row-action-add')).length,
      };
    });
    check('tracked rows keep the progress bar', mine.withBar === mine.n, `${mine.withBar}/${mine.n}`);
    check('tracked rows keep the swipe targets', mine.withActions === mine.n, `${mine.withActions}/${mine.n}`);

    // All-airing scope: one request.
    seen.length = 0;
    await page.evaluate(() => document.querySelector('#schedule-scope-seg [data-scope="all"]').click());
    await page.waitForTimeout(1500);
    const all = await page.evaluate(() =>
      document.querySelectorAll('#schedule-days .list-row-wrap').length);
    check('all-airing renders rows', all > 0, `${all} rows`);
    const airingCalls = seen.filter(r => label(r) === 'AllAiring').length;
    check('all-airing is one round trip', airingCalls === 1, `${airingCalls} calls`);

    // A row for a show you don't track must not offer a +1 on an entry that
    // doesn't exist, and has nothing to draw a progress bar from. Asserted on
    // the renderer directly: every show the fake serves is on the list, so the
    // scope switch alone can't reach this path.
    const bare = await page.evaluate(() => {
      const m = { id: 99, title: { userPreferred: 'X' }, episodes: 12, averageScore: 80,
        nextAiringEpisode: { airingAt: 0, episode: 3, timeUntilAiring: 600 } };
      const el = document.createElement('div');
      el.innerHTML = renderListEntryRow({ id: null, status: null, score: 0, progress: 0, media: m },
        { lead: '<span class="row-time">7:00 PM</span>', episode: 3, bare: true });
      // progress 0 with episode 3 airing next means two episodes are out and
      // unwatched, so this row must show a "behind". At progress 2 it would be
      // caught up and correctly show none.
      const full = document.createElement('div');
      full.innerHTML = renderListEntryRow({ id: 1, status: 'CURRENT', score: 0, progress: 0, media: m },
        { lead: '<span class="row-time">7:00 PM</span>', episode: 3 });
      return {
        bareActions: el.querySelectorAll('.list-row-action').length,
        bareBar: el.querySelectorAll('.list-row-bar').length,
        bareMeta: el.querySelector('.list-row-meta').textContent.replace(/\s+/g, ' ').trim(),
        fullActions: full.querySelectorAll('.list-row-action').length,
        fullBar: full.querySelectorAll('.list-row-bar').length,
        fullMeta: full.querySelector('.list-row-meta').textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    check('untracked row has no swipe targets and no bar',
      bare.bareActions === 0 && bare.bareBar === 0,
      `${bare.bareActions} actions / ${bare.bareBar} bars`);
    check('untracked row shows no progress and no "behind"',
      !/\d+\/\d+/.test(bare.bareMeta) && !/behind/.test(bare.bareMeta), `"${bare.bareMeta}"`);
    check('untracked row still leads with the time and episode',
      /7:00 PM/.test(bare.bareMeta) && /Ep 3/.test(bare.bareMeta), `"${bare.bareMeta}"`);
    check('tracked row keeps bar, swipe targets, progress and behind',
      bare.fullActions === 2 && bare.fullBar === 1
      && /0\/12/.test(bare.fullMeta) && /2 behind/.test(bare.fullMeta),
      `"${bare.fullMeta}"`);
    await page.close();
  }

  // ---- Schedule failure ---------------------------------------------------
  console.log('Weekly schedule — request fails');
  {
    const S = makeState();
    const page = await b.newPage({ viewport: { width: 412, height: 915 } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)),
      { ...PREFS, seasonalView: 'schedule', scheduleScope: 'all' });
    let allowViewer = true;
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith('data:') || u.includes('localhost:8099')) return route.continue();
      const q = JSON.parse(route.request().postData() || '{}').query || '';
      // Fail only the schedule's own query, so the rest of the app still boots.
      if (q.includes('status: RELEASING')) return route.abort('failed');
      return handler(S)(route);
    });
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(3500);
    await page.evaluate(() => switchTab('seasonal'));
    await page.waitForTimeout(4000);
    const t = await page.evaluate(() => document.getElementById('schedule-days').textContent);
    check('failure says so and offers a retry', FAIL_WORDS.test(t), JSON.stringify(t.trim().slice(0, 70)));
    check('failure is not an empty week', !/Nothing airing in the next/i.test(t));
    void allowViewer;
    await page.close();
  }

  // ---- Search filters -----------------------------------------------------
  console.log('Search filters');
  {
    const { page, seen } = await boot(b);
    await page.evaluate(() => switchTab('search'));
    await page.waitForTimeout(1500);
    const bar0 = await page.evaluate(() => ({
      btn: !!document.getElementById('filter-btn'),
      on: document.getElementById('filter-btn').classList.contains('on'),
      chips: !document.getElementById('filter-active').hidden,
      preShown: !document.getElementById('search-pre').classList.contains('hidden'),
    }));
    check('bar present, nothing set, carousels showing',
      bar0.btn && !bar0.on && !bar0.chips && bar0.preShown, JSON.stringify(bar0));

    await page.evaluate(() => document.getElementById('filter-btn').click());
    await page.waitForTimeout(1200);
    const sheet = await page.evaluate(() => ({
      visible: document.getElementById('filter-modal').classList.contains('visible'),
      sections: [...document.querySelectorAll('#filter-sheet .field-label')].map(e => e.textContent.trim()),
      chips: document.querySelectorAll('#filter-sheet .chip').length,
      tagField: !!document.getElementById('filter-tag-search'),
    }));
    check('sheet opens', sheet.visible);
    check('all eight facets present', sheet.sections.length === 8, sheet.sections.join('|'));
    check('chips rendered', sheet.chips > 20, `${sheet.chips}`);
    check('tags have their own search field', sheet.tagField);
    // Spoiler and adult tags must not reach the sheet.
    const tags = await page.evaluate(() => filterTags);
    check('spoiler/adult tags filtered out',
      tags.includes('Isekai') && !tags.includes('Spoilery Thing') && !tags.includes('Adult Thing'),
      JSON.stringify(tags));

    // Combine three facets and apply.
    seen.length = 0;
    await page.evaluate(() => {
      document.querySelector('#filter-sheet .chip[data-facet="genres"][data-value="Action"]').click();
      document.querySelector('#filter-sheet .chip[data-facet="formats"][data-value="TV"]').click();
      document.querySelector('#filter-sheet .chip[data-facet="year"][data-value="2023"]').click();
    });
    await page.waitForTimeout(1200);
    const applyText = await page.evaluate(() => document.getElementById('filter-apply-btn').textContent.trim());
    check('apply button offers a live count', /Show \d[\d,.KM]* results?/.test(applyText), `"${applyText}"`);
    await page.evaluate(() => document.getElementById('filter-apply-btn').click());
    await page.waitForTimeout(1600);

    const applied = await page.evaluate(() => ({
      on: document.getElementById('filter-btn').classList.contains('on'),
      count: document.getElementById('filter-count').textContent,
      chips: [...document.querySelectorAll('#filter-active .recent-chip')].map(c => c.textContent.trim()),
      clearAll: !!document.getElementById('filter-chip-clear'),
      preHidden: document.getElementById('search-pre').classList.contains('hidden'),
      resultsShown: document.getElementById('search-results').classList.contains('visible'),
      cards: document.querySelectorAll('#search-grid .card').length,
      total: document.getElementById('filter-result-count').textContent.trim(),
    }));
    check('trigger goes filled with a count', applied.on && applied.count === '3', `count="${applied.count}"`);
    check('a removable chip per set value', applied.chips.length === 3, applied.chips.join('|'));
    check('clear-all offered', applied.clearAll);
    check('filters alone replace the carousels with results',
      applied.preHidden && applied.resultsShown && applied.cards > 0, `${applied.cards} cards`);
    check('result total shown on the bar', /result/.test(applied.total), `"${applied.total}"`);

    // The important one: values travel as variables, never as query text.
    const q = seen.filter(r => label(r) === 'Page').pop();
    check('filters sent as GraphQL variables',
      !!q && q.q.includes('genre_in: $genres') && q.v.genres?.[0] === 'Action'
        && q.v.formats?.[0] === 'TV' && q.v.year === 2023,
      JSON.stringify(q?.v));
    check('no filter value interpolated into the query text',
      !!q && !q.q.includes('"Action"') && !q.q.includes('seasonYear: 2023'));

    // Typing then clearing must not throw the filters away.
    await page.evaluate(() => {
      const i = document.getElementById('search-input');
      i.value = 'anime'; i.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.getElementById('search-clear').click());
    await page.waitForTimeout(1400);
    const kept = await page.evaluate(() => ({
      count: document.getElementById('filter-count').textContent,
      preHidden: document.getElementById('search-pre').classList.contains('hidden'),
      cards: document.querySelectorAll('#search-grid .card').length,
    }));
    check('clearing the text keeps the filters',
      kept.count === '3' && kept.preHidden && kept.cards > 0, JSON.stringify(kept));

    // Removing a chip drops exactly that one.
    await page.evaluate(() => document.querySelector('#filter-active .recent-chip .recent-chip-x').click());
    await page.waitForTimeout(1400);
    check('removing a chip drops one filter',
      (await page.evaluate(() => document.getElementById('filter-count').textContent)) === '2');

    // Clear all goes back to the carousels.
    await page.evaluate(() => document.getElementById('filter-chip-clear').click());
    await page.waitForTimeout(1400);
    const cleared = await page.evaluate(() => ({
      on: document.getElementById('filter-btn').classList.contains('on'),
      preShown: !document.getElementById('search-pre').classList.contains('hidden'),
      chips: !document.getElementById('filter-active').hidden,
    }));
    check('clear all returns to the carousels',
      !cleared.on && cleared.preShown && !cleared.chips, JSON.stringify(cleared));
    await page.close();
  }

  // ---- Profile statistics -------------------------------------------------
  console.log('Profile statistics');
  {
    const { page, seen } = await boot(b);
    seen.length = 0;
    await page.evaluate(() => switchTab('profile'));
    await page.waitForTimeout(1600);
    const st = await page.evaluate(() => ({
      sectionShown: !document.getElementById('stats-section').hidden,
      tiles: [...document.querySelectorAll('.stat-tile-value')].map(e => e.textContent.trim()),
      labels: [...document.querySelectorAll('.stat-tile-label')].map(e => e.textContent.trim()),
      segs: document.querySelectorAll('.stat-seg').length,
      legend: document.querySelectorAll('.stat-legend-row').length,
      cols: document.querySelectorAll('.stat-hist-col').length,
      bars: document.querySelectorAll('.stat-bar-row').length,
      skeletons: document.querySelectorAll('#stats-body .skeleton').length,
      more: !!document.getElementById('stats-more-btn'),
      extraHidden: document.getElementById('stats-extra')?.hidden,
      // The card above must agree with the Watched tile.
      card: document.getElementById('profile-card').textContent,
    }));
    check('section visible with no skeletons left',
      st.sectionShown && st.skeletons === 0, `${st.skeletons} skeletons`);
    check('four tiles', st.tiles.length === 4, st.tiles.join('|'));
    check('watched shown in days', /^\d+d( \d+h)?$|^\d+h$|^\d+m$/.test(st.tiles[2]), `"${st.tiles[2]}"`);
    check('tile labels as designed',
      st.labels.join(',') === 'Titles,Episodes,Watched,Mean', st.labels.join(','));
    check('profile card uses the same unit as the tile',
      st.card.includes(st.tiles[2]), `tile="${st.tiles[2]}"`);
    check('status bar drawn with a legend', st.segs === 3 && st.legend === 3,
      `${st.segs} segs / ${st.legend} legend rows`);
    check('ten histogram columns', st.cols === 10, `${st.cols}`);
    check('genre bars rendered', st.bars > 0, `${st.bars}`);
    // Painted width, not just markup. The fill is a span inside a span, and
    // an inline box ignores width — every bar rendered empty and the markup
    // assertion above was perfectly happy about it.
    // Direct children only — the Show-more block is still collapsed, and a
    // hidden element measures zero.
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('#stats-body > .stat-block .stat-bar-fill')]
        .map(e => Math.round(e.getBoundingClientRect().width)));
    check('bar fills have real painted width', widths.length > 0 && widths.every(w => w > 0),
      JSON.stringify(widths));
    check('the largest bar fills its track',
      Math.max(...widths) >= Math.round(
        await page.evaluate(() => document.querySelector('.stat-bar-track').getBoundingClientRect().width)) - 1,
      `max=${Math.max(...widths)}`);
    check('extra stats collapsed behind Show more', st.more && st.extraHidden === true);

    await page.evaluate(() => document.getElementById('stats-more-btn').click());
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => ({
      hidden: document.getElementById('stats-extra').hidden,
      label: document.getElementById('stats-more-btn').textContent.trim(),
      bars: document.querySelectorAll('#stats-extra .stat-bar-row').length,
    }));
    check('Show more reveals formats and years',
      !opened.hidden && opened.label === 'Show less' && opened.bars > 0, JSON.stringify(opened));
    const fmtNames = await page.evaluate(() =>
      [...document.querySelectorAll('#stats-extra .stat-bar-name')].map(e => e.textContent.trim()));
    check('format labels keep their real casing',
      fmtNames.includes('TV') && !fmtNames.includes('Tv'), JSON.stringify(fmtNames));

    // One query, and it is not the boot-time Viewer call.
    const statCalls = seen.filter(r => label(r) === 'UserStats').length;
    check('statistics cost one request, loaded on tab open', statCalls === 1, `${statCalls} calls`);

    // A genre bar goes to the genre browser.
    await page.evaluate(() => document.querySelector('.stat-bar-row[data-stat-kind="genre"]').click());
    await page.waitForTimeout(1200);
    const wentToGenre = await page.evaluate(() =>
      document.getElementById('genre-overlay').classList.contains('visible'));
    check('a genre bar opens the genre browser', wentToGenre);
    await page.close();
  }

  // ---- Profile statistics failure ----------------------------------------
  console.log('Profile statistics — request fails');
  {
    const S = makeState();
    const page = await b.newPage({ viewport: { width: 412, height: 915 } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)), PREFS);
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith('data:') || u.includes('localhost:8099')) return route.continue();
      const q = JSON.parse(route.request().postData() || '{}').query || '';
      if (/User\s*\(/.test(q) && q.includes('statistics')) return route.abort('failed');
      return handler(S)(route);
    });
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => switchTab('profile'));
    await page.waitForTimeout(4500);
    const t = await page.evaluate(() => document.getElementById('stats-body').textContent);
    check('failure says so and offers a retry', FAIL_WORDS.test(t), JSON.stringify(t.trim().slice(0, 70)));
    check('no zeroed-out fake statistics', !/\b0\b.*Titles/i.test(t));
    await page.close();
  }

  // ---- Guest --------------------------------------------------------------
  console.log('Signed out');
  {
    const { page } = await boot(b, { prefs: { accessToken: null } });
    await page.evaluate(() => switchTab('profile'));
    await page.waitForTimeout(900);
    const g = await page.evaluate(() => ({
      stats: document.getElementById('stats-section').hidden,
      upNext: document.getElementById('up-next').hidden,
    }));
    check('statistics hidden for a guest', g.stats === true);
    check('Up Next hidden for a guest', g.upNext === true);
    await page.evaluate(() => { state.seasonalView = 'schedule'; state.scheduleScope = 'mine'; switchTab('seasonal'); });
    await page.waitForTimeout(1200);
    const t = await page.evaluate(() => document.getElementById('schedule-days').textContent);
    check('My List schedule asks a guest to sign in', /Sign in/i.test(t),
      JSON.stringify(t.trim().slice(0, 60)));
    await page.close();
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
