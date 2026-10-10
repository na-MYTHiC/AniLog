// The mobile contract. Every check here failed at least once on the way in,
// and none of them is visible in a desktop browser at 1280px — which is
// exactly why they need a test rather than a look.
//
//  - nothing paints outside the app frame at any phone width
//  - nothing you can tap is smaller than the documented floor
//  - no text field is under 16px (Safari zooms the page in on focus below it,
//    and leaves you zoomed)
//  - the `hidden` attribute actually hides, for every element that uses it
//  - index.html carries no inline style attributes
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { makeState, handler } = require('./anilist-fake');

let fails = 0;
const check = (n, ok, d) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d !== undefined ? '  ' + d : ''}`);
};

// 44px is the floor for a standalone control. --tap-sm (36px) is the
// documented exception for chips and pills that sit several to a row, where
// 44 would force a wrap on a 360px screen; 40px is a segmented-control button
// inside its own 44px track.
const TAP_MIN = 36;
const TAPPABLE = [
  'button', 'a[href]', 'input', 'textarea', '[onclick]',
  '.chip', '.card', '.list-row', '.recent-chip', '.sort-option', '.theme-option',
  '.nav-btn', '.day-chip', '.stat-bar-row', '.season-chip', '.season-year',
  '.friend-avatar', '.genre-pill', '.stat-pill.score-clickable', '.section-link',
].join(', ');

// Phone sizes that matter: the narrowest Android still sold, the common
// iPhone, a Pixel, and the largest iPhone.
const SIZES = [[360, 800, 'android 360'], [393, 852, 'iPhone 16'], [412, 915, 'pixel'], [430, 932, 'iPhone Pro Max']];

const VIEWS = [
  ['home',     () => switchTab('home')],
  ['search',   () => switchTab('search')],
  ['seasonal', () => switchTab('seasonal')],
  ['schedule', () => { state.seasonalView = 'schedule'; switchTab('seasonal'); }],
  ['social',   () => switchTab('social')],
  ['profile',  () => switchTab('profile')],
  ['detail',   () => openMedia(1000)],
  ['filters',  () => { switchTab('search'); setTimeout(() => document.getElementById('filter-btn').click(), 300); }],
  ['edit',     () => openListEditSheet({ id: 1000, title: { userPreferred: 'A' }, episodes: 12 },
                                       { id: 1, status: 'CURRENT', score: 8, progress: 3 })],
  ['season picker', () => { switchTab('seasonal'); setTimeout(() => openSeasonModal(), 300); }],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---- static: no inline styles in the markup --------------------------------
  console.log('Markup');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const inline = html.match(/ style="[^"]*"/g) || [];
  check('index.html has no inline style attributes', inline.length === 0,
    inline.slice(0, 3).join(' | '));

  // ---- layout and targets ----------------------------------------------------
  for (const [w, h, name] of SIZES) {
    console.log(`${name} — ${w}x${h}`);
    const S = makeState();
    const page = await b.newPage({ viewport: { width: w, height: h } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)),
      { theme: 'dark', density: 'comfortable', themeId: 'iris', accent: '#7c5cff', accessToken: 'TOK' });
    await page.route('**/*', handler(S));
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2300);

    const overflow = [];
    const small = [];
    for (const [vname, fn] of VIEWS) {
      await page.evaluate(fn);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(({ TAP_MIN, TAPPABLE }) => {
        const out = { over: [], small: [] };
        const frame = document.querySelector('.app').getBoundingClientRect();
        const visible = (el, cs) =>
          cs.display !== 'none' && cs.visibility !== 'hidden' &&
          (el.offsetParent !== null || cs.position === 'fixed');
        // An element inside a horizontal scroller is MEANT to run past the
        // frame — that's what makes it scrollable.
        const inScroller = (el) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll') return true;
          }
          return false;
        };
        document.querySelectorAll('.app *').forEach((el) => {
          const cs = getComputedStyle(el);
          if (!visible(el, cs)) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          if ((r.right > frame.right + 1.5 || r.left < frame.left - 1.5) && !inScroller(el)) {
            out.over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
          }
        });
        document.querySelectorAll(TAPPABLE).forEach((el) => {
          const cs = getComputedStyle(el);
          if (!visible(el, cs) || cs.pointerEvents === 'none') return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          if (r.height < TAP_MIN - 0.5 || r.width < TAP_MIN - 0.5) {
            out.small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        });
        return out;
      }, { TAP_MIN, TAPPABLE });
      r.over.forEach(x => overflow.push(`${vname}: ${x}`));
      r.small.forEach(x => small.push(`${vname}: ${x}`));
      await page.evaluate(() => { closeTopLayer(); closeTopLayer(); });
      await page.waitForTimeout(200);
    }
    check('nothing paints outside the app frame', overflow.length === 0,
      [...new Set(overflow)].slice(0, 4).join(' | '));
    check(`every target is at least ${TAP_MIN}px`, small.length === 0,
      [...new Set(small)].slice(0, 6).join(' | '));
    await page.close();
  }

  // ---- text fields, hidden, and viewport units -------------------------------
  console.log('Mobile behaviour');
  {
    const S = makeState();
    const page = await b.newPage({ viewport: { width: 393, height: 852 } });
    await page.addInitScript((p) => localStorage.setItem('anilog-prefs', JSON.stringify(p)),
      { theme: 'dark', density: 'comfortable', themeId: 'iris', accent: '#7c5cff', accessToken: 'TOK' });
    await page.route('**/*', handler(S));
    await page.goto('http://localhost:8099/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2300);
    // Open every layer that owns a text field so none is measured while
    // display:none (where computed font-size still resolves, but let's be sure
    // they're all reachable).
    await page.evaluate(() => { switchTab('search'); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.getElementById('filter-btn').click(); });
    await page.waitForTimeout(1200);

    const fields = await page.evaluate(() =>
      [...document.querySelectorAll('input[type="text"], input:not([type]), input[type="number"], textarea')]
        .map(el => ({
          id: el.id || el.className,
          size: parseFloat(getComputedStyle(el).fontSize),
        })));
    const tooSmall = fields.filter(f => f.size < 16);
    check('no text field under 16px (iOS zooms below it)', tooSmall.length === 0,
      tooSmall.map(f => `${f.id}=${f.size}px`).join(' | ') || `${fields.length} fields checked`);

    // The `hidden` attribute has to win against the author display rules —
    // .seg, .sort-trigger, .season-nav-btn and .grid all declare their own.
    const hiddenWorks = await page.evaluate(() => {
      const probes = ['seg', 'sort-trigger', 'grid', 'chip', 'card', 'list-row', 'carousel'];
      return probes.map((cls) => {
        const el = document.createElement('div');
        el.className = cls;
        el.hidden = true;
        document.body.appendChild(el);
        const d = getComputedStyle(el).display;
        el.remove();
        return { cls, d };
      }).filter(x => x.d !== 'none');
    });
    check('[hidden] beats every component display rule', hiddenWorks.length === 0,
      JSON.stringify(hiddenWorks));

    // dvh, not vh: with a browser URL bar showing, a 100%-height app puts its
    // bottom nav below the fold.
    const css = await page.evaluate(async () => {
      const res = await fetch('./styles/base.css');
      return res.text();
    });
    check('app height uses dvh, not vh', !/height:\s*min\([^)]*100vh/.test(css) && /100dvh/.test(css));
    check('document blocks overscroll chaining', /overscroll-behavior:\s*none/.test(css));
    check('text autosizing pinned', /text-size-adjust:\s*100%/.test(css));

    await page.close();
  }

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
