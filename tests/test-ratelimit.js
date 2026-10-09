// Add to list, then have AniList rate-limit the refetch — exactly what happens
// on a real device after a burst of activity.
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const S=makeState();
  const page=await b.newPage({viewport:{width:412,height:915}});
  let limitList=false;
  await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
    JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
  await page.route('**/*', async r=>{
    const u=r.request().url();
    if(!u.startsWith('data:')&&!u.includes('localhost:8099')){
      const q=JSON.parse(r.request().postData()||'{}').query||'';
      if(limitList && q.includes('MediaListCollection'))
        return r.fulfill({status:429,headers:{'Retry-After':'1'},body:'rate limited'});
    }
    return handler(S)(r);
  });
  await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
  await page.waitForTimeout(2500);
  const rows=()=>page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
  const txt=()=>page.evaluate(()=>(document.getElementById('my-list-grid')||{}).textContent||'');
  console.log('[healthy]'); check('My List has rows', await rows()>0, `rows=${await rows()}`);

  // Write, then rate-limit the refetch.
  limitList=true;
  await page.evaluate(async()=>{
    await mutateList(`mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
    }`, {mediaId:1099,status:'CURRENT'});
  });
  await page.evaluate(()=>loadMyList());
  await page.waitForTimeout(25000);   // let all 429 waits play out
  const n=await rows(), t=await txt();
  console.log('[after a write, with the list refetch rate-limited]');
  check('My List still shows the user\'s shows', n>0, `rows=${n}`);
  check('does NOT claim the list is empty', !/is empty/.test(t), /is empty/.test(t)?('shows: '+t.trim().slice(0,60)):'');
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
