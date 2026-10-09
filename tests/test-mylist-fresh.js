// Does a just-added show appear in My List on its own, and does a genuine
// failure (no cache at all) say "couldn't load" rather than "empty"?
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});

  // --- A: added show shows up without navigating away ---
  {
    const S=makeState();
    const page=await b.newPage({viewport:{width:412,height:915}});
    await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
    await page.route('**/*', handler(S));
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(2500);
    const before=await page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
    await page.evaluate(async()=>{
      await mutateList(`mutation ($mediaId: Int, $status: MediaListStatus) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
      }`, {mediaId:1099,status:'CURRENT'});
      loadMyList();            // the user is sitting on Home
    });
    await page.waitForTimeout(2500);
    const after=await page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
    const hasNew=await page.evaluate(()=>(document.getElementById('my-list-grid')||{}).textContent?.includes('Anime 99'));
    console.log('[added show appears without navigating]');
    check('row count grew', after>before, `${before} -> ${after}`);
    check('the new show is listed', !!hasNew);
    await page.close();
  }

  // --- B: genuine failure with nothing cached ---
  {
    const S=makeState();
    const page=await b.newPage({viewport:{width:412,height:915}});
    await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
    await page.route('**/*', async r=>{
      const u=r.request().url();
      if(!u.startsWith('data:')&&!u.includes('localhost:8099')){
        const q=JSON.parse(r.request().postData()||'{}').query||'';
        if(q.includes('MediaListCollection')) return r.fulfill({status:500,body:'err'});
      }
      return handler(S)(r);
    });
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(7000);
    const t=await page.evaluate(()=>(document.getElementById('my-list-grid')||{}).textContent||'');
    console.log('[list request fails, nothing cached]');
    check('says it couldn\'t load', /Couldn't load your list/.test(t), t.trim().slice(0,50));
    check('does NOT say the list is empty', !/is empty/.test(t));
    check('offers a retry', await page.evaluate(()=>!!document.querySelector('#my-list-grid .retry-btn')));
    // and the retry works once the API recovers
    await page.unroute('**/*'); await page.route('**/*', handler(S));
    await page.evaluate(()=>document.querySelector('#my-list-grid .retry-btn').click());
    await page.waitForTimeout(2500);
    check('retry recovers the list', await page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length)>0);
    await page.close();
  }
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
