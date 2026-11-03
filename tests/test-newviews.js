// The three views added in v4.90: the weekly schedule on Seasonal,
// combinable search filters, and Profile statistics.
//
// What this is actually guarding:
//  - every one of them renders real content against the fake, not a skeleton
//  - a FAILED request shows something retryable, never an empty state
//    (the rule the whole tests/ directory exists to enforce)
//  - filters go out as GraphQL VARIABLES, never interpolated into the query
//  - filters survive the search box being cleared
//  - the schedule's "My List" scope issues one list query and no more
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
      emptyDays: [...document.querySelectorAll('.sched-day')].filter(d => !d.querySelector('.list-row-wrap')).length,
      chipDays: [...document.querySelectorAll('.day-chip')].map(c => c.dataset.day).join(),
      sectionDays: [...document.querySelectorAll('.sched-day')].map(d => d.dataset.day).join(),
      nothing: /Nothing airing/.test(document.getElementById('schedule-days').textContent),
      rows: document.querySelectorAll('#schedule-days .list-row-wrap').length,
      skeletons: document.querySelectorAll('#schedule-days .skeleton').length,
      times: [...document.querySelectorAll('#schedule-days .row-time')].slice(0, 3).map(e => e.textContent),
    }))) };
    check('schedule view swaps grid for schedule and sort for scope',
      sched.schedShown && !sched.gridShown && !sched.sortShown && sched.scopeShown,
      JSON.stringify({ s: sched.schedShown, g: sched.gridShown, so: sched.sortShown, sc: sched.scopeShown }));
    check('season arrows hidden (no season to step)', !sched.arrowsShown);
    check('header reads This Week', sched.title === 'This Week', `"${sched.title}"`);
    // Only days with something airing: four "Nothing airing" headings in a
    // row pushed the week's episodes below the fold.
    check('a section per day that has episodes, and no empty ones',
      sched.days > 0 && sched.days <= 7 && sched.emptyDays === 0 && !sched.nothing, JSON.stringify(sched));
    check('the day chips are the same days as the sections',
      sched.chips === sched.days && sched.chipDays === sched.sectionDays, `${sched.chipDays} / ${sched.sectionDays}`);
    // Pinned on the painter itself: two shows on days 2 and 5 of the week.
    const skip = await page.evaluate(() => {
      const days = scheduleWindow();
      const mk = (d, id) => ({ airingAt: days[d].from + 3600, episode: 3,
        media: { id, title: { userPreferred: 'S' + id }, episodes: 12, coverImage: {} }, entry: null });
      const saved = scheduleItems;
      paintSchedule([mk(2, 801), mk(5, 802)]);
      const r = {
        sections: [...document.querySelectorAll('.sched-day')].map(d => d.dataset.day).join(),
        chips: [...document.querySelectorAll('.day-chip')].map(c => c.dataset.day).join(),
        active: document.querySelector('.day-chip.active')?.dataset.day,
      };
      paintSchedule(saved);
      return r;
    });
    check('quiet days are skipped, busy ones kept in order', skip.sections === '2,5' && skip.chips === '2,5', JSON.stringify(skip));
    check('the first day shown starts highlighted', skip.active === '2', JSON.stringify(skip));
    check('rows rendered, not skeletons', sched.rows > 0 && sched.skeletons === 0,
      `${sched.rows} rows / ${sched.skeletons} skeletons`);
    check('rows lead with an airing time', sched.times.length > 0 && sched.times.every(t => /\d/.test(t)),
      JSON.stringify(sched.times));

    // One list query for the scope, not one per repaint.
    const listCalls = seen.filter(r => label(r) === 'Watching').length;
    check('My List scope is one list query', listCalls === 1, `${listCalls} calls`);

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
      const lines = (root) => [...root.querySelectorAll('.list-row-meta')]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim());
      return {
        bareActions: el.querySelectorAll('.list-row-action').length,
        bareBar: el.querySelectorAll('.list-row-bar').length,
        bareLines: lines(el),
        fullActions: full.querySelectorAll('.list-row-action').length,
        fullBar: full.querySelectorAll('.list-row-bar').length,
        fullLines: lines(full),
      };
    });
    check('untracked row has no swipe targets and no bar',
      bare.bareActions === 0 && bare.bareBar === 0,
      `${bare.bareActions} actions / ${bare.bareBar} bars`);
    check('untracked row shows no progress and no "behind"',
      !bare.bareLines.some(l => /\d+\/\d+/.test(l) || /behind/.test(l)),
      JSON.stringify(bare.bareLines));
    check('untracked row still leads with the time and episode',
      /7:00 PM/.test(bare.bareLines[0]) && /Ep 3/.test(bare.bareLines[0]),
      JSON.stringify(bare.bareLines));
    check('tracked row keeps the bar and the swipe targets',
      bare.fullActions === 2 && bare.fullBar === 1,
      `${bare.fullActions} actions / ${bare.fullBar} bars`);
    // The split that stops the one thing you can act on being ellipsised: the
    // primary line carries the event and the "behind", the secondary carries
    // progress and scores. Measured at 360px, four items on one line overflowed.
    check('schedule row leads with time, episode and "behind"',
      /7:00 PM/.test(bare.fullLines[0]) && /Ep 3/.test(bare.fullLines[0])
      && /2 behind/.test(bare.fullLines[0]), JSON.stringify(bare.fullLines[0]));
    check('progress drops to the second line on a schedule row',
      !/0\/12/.test(bare.fullLines[0]) && /0\/12/.test(bare.fullLines[1] || ''),
      JSON.stringify(bare.fullLines));
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

  // ---- Following, and a friend's profile -----------------------------------
  // Profile lists who you follow; each opens their stats and their list, and
  // that list works like yours — same bar, counts, sort and List Style — but
  // can't be changed.
  console.log('Following and friend profiles');
  for (const listStyle of ['ring', 'grid']) {
    const { page, seen } = await boot(b, { prefs: { listStyle } });
    await page.evaluate(() => switchTab('profile'));
    await page.waitForTimeout(1600);
    if (listStyle === 'ring') {
      const hero = await page.evaluate(() => [...document.querySelectorAll('.profile-follow-btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
      check('your name carries Following and Followers counts, as on AniList', hero.join('|') === '13 Following|4 Followers', JSON.stringify(hero));
      check('no Social card at the bottom of Profile', await page.evaluate(() => !document.getElementById('following-section')));
      const fav = await page.evaluate(() => ({ shown: !document.getElementById('favourites-section').hidden,
        cards: document.querySelectorAll('#favourites-carousel .card').length,
        count: document.getElementById('favourites-count').textContent }));
      check('Favourites show as a carousel, from the stats request', fav.shown && fav.cards === 5 && fav.count === '5', JSON.stringify(fav));
      const followCalls = seen.filter(r => r.q.includes('following(') && r.q.includes('followers('));
      check('Following and Followers counts come in one request', followCalls.length === 1, `${followCalls.length}`);
    }
    // Tapping a count opens the list of people as its own page.
    const list = () => page.evaluate(() => ({
      open: document.getElementById('follow-overlay').classList.contains('visible'),
      title: document.getElementById('follow-title').textContent,
      active: document.querySelector('#follow-seg .seg-btn.active')?.dataset.follow,
      names: [...document.querySelectorAll('#follow-list .follow-row.user-tap')].map(e => e.dataset.userName),
    }));
    if (listStyle === 'ring') {
      await page.evaluate(() => document.querySelector('.profile-follow-btn[data-follow="followers"]').click());
      await page.waitForTimeout(500);
      const fl = await list();
      check('Followers opens a list of the people who follow you', fl.open && fl.title === 'Followers' && fl.active === 'followers'
        && fl.names.join() === 'fan0,fan1,fan2,fan3', JSON.stringify(fl));
      await page.evaluate(() => document.querySelector('#follow-seg [data-follow="following"]').click());
      await page.waitForTimeout(300);
      const fg = await list();
      check('the switch at the top flips to Following, everyone listed', fg.title === 'Following' && fg.names.length === 13, JSON.stringify(fg));
      await page.evaluate(() => closeOverlay('follow-overlay'));
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => document.querySelector('.profile-follow-btn[data-follow="following"]').click());
    await page.waitForTimeout(500);
    seen.length = 0;
    await page.evaluate(() => document.querySelector('#follow-list .user-tap').click());
    await page.waitForTimeout(1800);
    const u = await page.evaluate(() => ({
      open: document.getElementById('user-overlay').classList.contains('visible'),
      title: document.getElementById('user-title').textContent,
      tiles: [...document.querySelectorAll('#ustats-body .stat-tile-label')].map(e => e.textContent.trim()).join(','),
      stack: document.querySelectorAll('#ustats-body .stat-seg').length,
      hist: document.querySelectorAll('#ustats-body .stat-hist').length,
      allBars: document.querySelectorAll('#ustats-body .stat-bar-row').length,
      moreBtn: !!document.querySelector('#ustats-body .stat-more'),
      bar: !!document.querySelector('#user-body .list-bar #user-status-btn') && !!document.getElementById('user-sort-btn'),
      oldTriggers: document.querySelectorAll('#user-body .sort-trigger').length,
      label: document.getElementById('user-status-label').textContent.trim(),
      count: document.getElementById('user-status-count').textContent.trim(),
      cls: document.getElementById('user-list-rows').className,
      rows: document.querySelectorAll('#user-list-rows .list-row-wrap').length,
      cards: document.querySelectorAll('#user-list-rows .list-card').length,
      swipe: document.querySelectorAll('#user-list-rows .list-row-action').length,
      you: /\byou\b/.test(document.getElementById('user-list-rows').textContent),
    }));
    check(`${listStyle}: tapping someone opens their profile`, u.open && u.title === 'friend0', JSON.stringify(u));
    if (listStyle === 'ring') {
      check('their stats: the same three tiles, all of it showing, no Show more',
        u.tiles === 'Titles,Episodes,Watched' && u.stack === 3 && u.hist === 1 && u.allBars === 6 && !u.moreBtn, JSON.stringify(u));
      check('their list has your bar: the list name with its count, and sort', u.bar && u.oldTriggers === 0
        && u.label === 'Watching' && /^\d+$/.test(u.count), JSON.stringify(u));
      check('drawn in your List Style', /\blst-ring\b/.test(u.cls) && u.rows > 0, u.cls);
      check('read-only: no swipe targets, and scores aren\'t labelled "you"', u.swipe === 0 && !u.you, JSON.stringify(u));
      // The dropdown switches their list, with counts in the sheet.
      seen.length = 0;
      await page.evaluate(() => document.getElementById('user-status-btn').click());
      await page.waitForTimeout(300);
      const sheet = await page.evaluate(() => [...document.querySelectorAll('.sort-option-count')].map(e => e.textContent.trim()));
      check('the dropdown shows each list\'s count', sheet.length === 7 && sheet.every(c => /^\d+$/.test(c)), JSON.stringify(sheet));
      await page.evaluate(() => [...document.querySelectorAll('.sort-option')].find(o => /Completed/.test(o.textContent)).click());
      await page.waitForTimeout(900);
      const sw = await page.evaluate(() => ({
        label: document.getElementById('user-status-label').textContent.trim(),
        statuses: [...document.querySelectorAll('#user-list-rows .list-row-wrap')].length,
      }));
      const calls = seen.filter(r => r.q.includes('MediaListCollection') && r.v.status === 'COMPLETED');
      check('picking a list switches to it in one request', sw.label === 'Completed' && sw.statuses > 0
        && calls.length === 1 && calls[0].v.userId === 7000, JSON.stringify({ sw, calls: calls.map(c => c.v) }));
    } else {
      check('Grid style draws their list as posters', /\blst-grid\b/.test(u.cls) && u.cards > 0 && u.rows === 0, JSON.stringify(u));
    }
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
      more: !!document.querySelector('#stats-body .stat-more'),
      // The card above must agree with the Watched tile.
      card: document.getElementById('profile-card').textContent,
    }));
    check('section visible with no skeletons left',
      st.sectionShown && st.skeletons === 0, `${st.skeletons} skeletons`);
    // Mean is gone: AniList's meanScore is on the account's own scale, and
    // dividing it by ten was only right for one of them.
    check('three tiles, no Mean', st.tiles.length === 3, st.tiles.join('|'));
    check('watched shown in days', /^\d+d( \d+h)?$|^\d+h$|^\d+m$/.test(st.tiles[2]), `"${st.tiles[2]}"`);
    check('tile labels as designed',
      st.labels.join(',') === 'Titles,Episodes,Watched', st.labels.join(','));
    check('profile card uses the same unit as the tile',
      st.card.includes(st.tiles[2]), `tile="${st.tiles[2]}"`);
    check('status bar drawn with a legend', st.segs === 3 && st.legend === 3,
      `${st.segs} segs / ${st.legend} legend rows`);
    check('ten histogram columns', st.cols === 10, `${st.cols}`);
    check('genre bars rendered', st.bars > 0, `${st.bars}`);
    // Painted width, not just markup. The fill is a span inside a span, and
    // an inline box ignores width — every bar rendered empty and the markup
    // assertion above was perfectly happy about it.
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('#stats-body > .stat-block .stat-bar-fill')]
        .map(e => Math.round(e.getBoundingClientRect().width)));
    check('bar fills have real painted width', widths.length > 0 && widths.every(w => w > 0),
      JSON.stringify(widths));
    check('the largest bar fills its track',
      Math.max(...widths) >= Math.round(
        await page.evaluate(() => document.querySelector('.stat-bar-track').getBoundingClientRect().width)) - 1,
      `max=${Math.max(...widths)}`);
    // Everything at once: genres, formats and release years, no Show more.
    check('every statistic shows, nothing behind Show more', !st.more && st.bars === 6, `${st.bars} bars, more=${st.more}`);
    const fmtNames = await page.evaluate(() =>
      [...document.querySelectorAll('#stats-body .stat-bar-name')].map(e => e.textContent.trim()));
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
    }));
    check('statistics hidden for a guest', g.stats === true);
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
