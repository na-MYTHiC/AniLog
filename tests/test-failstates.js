// Every browsing view: when the request FAILS, does it say so, or does it
// pretend there's nothing there?
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
const EMPTY_WORDS=/No results|is empty|No voice actors|Nothing/i;
const FAIL_WORDS=/Couldn't load|Couldn.t load|Retry/i;
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const views=[
    ['seasonal',  ()=>`switchTab('seasonal')`,                 '#seasonal-grid'],
    ['search',    ()=>`switchTab('search')`,                   '#tab-search'],
    ['genre',     ()=>`openGenre('Action')`,                   '#genre-grid'],
    ['see all',   ()=>`openCategory('Top 100','SCORE_DESC')`,  '#category-grid'],
    ['social',    ()=>`switchTab('social')`,                   '#tab-social'],
  ];
  for (const [name, action, sel] of views) {
    const S=makeState();
    const page=await b.newPage({viewport:{width:412,height:915}});
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
    // Boot healthy so the shell and viewer exist, then kill the API.
    let dead=false;
    await page.route('**/*', async r=>{
      const u=r.request().url();
      if(dead && !u.startsWith('data:') && !u.includes('localhost:8099'))
        return r.fulfill({status:500,body:'err'});
      return handler(S)(r);
    });
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(2200);
    dead=true;
    await page.evaluate((a)=>eval(a), action());
    await page.waitForTimeout(9000);
    const t=await page.evaluate((s)=>{const e=document.querySelector(s);
      return e?e.textContent:'(no element)';}, sel);
    const saysEmpty=EMPTY_WORDS.test(t), saysFailed=FAIL_WORDS.test(t);
    // Serving a stale cache is the BEST outcome, not a failure to report —
    // seasonal is preloaded on idle, so it legitimately still has content.
    const hasRealContent = await page.evaluate((s)=>{const e=document.querySelector(s);
      return e ? e.querySelectorAll('.card,.activity-card,.list-row-wrap').length : 0;}, sel);
    const acceptable = saysFailed || hasRealContent > 0;
    check(`${name}: failure reported OR cache served`, acceptable,
      acceptable ? (saysFailed?'reported':`served ${hasRealContent} cached item(s)`)
                 : `text: ${t.trim().replace(/\s+/g,' ').slice(0,60)}`);
    check(`${name}: never claims "no results" on a failure`, !saysEmpty);
    if(errs.length) check(`${name}: no page errors`, false, errs[0]);
    await page.close();
  }
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
