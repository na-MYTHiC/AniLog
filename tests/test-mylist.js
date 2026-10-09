// My List across every path it actually has.
const { chromium } = require('playwright');
const { makeState, handler, STATUSES, IMG } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const S=makeState();
  const page=await b.newPage({viewport:{width:412,height:915}});
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  const seen=[];
  await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
    JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
  await page.route('**/*', handler(S,{onRequest:(q,v)=>{
    if(Object.keys(v).some(k=>k.startsWith('__'))) seen.push('LEAKED '+JSON.stringify(v));
  }}));
  await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
  await page.waitForTimeout(2500);

  const rows=()=>page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
  const gridText=()=>page.evaluate(()=>(document.getElementById('my-list-grid')||{}).textContent?.trim().slice(0,70));
  const skeletons=()=>page.evaluate(()=>document.querySelectorAll('#my-list-grid .skeleton').length);

  console.log('[boot]');
  check('My List renders rows', await rows()>0, `rows=${await rows()}`);
  check('no stuck skeletons', await skeletons()===0);
  check('no page errors', errs.length===0, errs[0]||'');

  console.log('[each status filter]');
  for (const st of ['CURRENT','PLANNING','COMPLETED','PAUSED','DROPPED','REPEATING','ALL']) {
    await page.evaluate((s)=>{ state.listStatus=s; savePrefs(); return loadMyList(); }, st);
    await page.waitForTimeout(900);
    const n=await rows();
    const txt=await gridText();
    const emptyOk = n>0 || /is empty/.test(txt||'');
    check(`status ${st}`, emptyOk, `rows=${n}${n?'':' ('+txt+')'}`);
  }

  console.log('[each sort]');
  await page.evaluate(()=>{ state.listStatus='CURRENT'; savePrefs(); });
  for (const so of ['UPDATED_TIME_DESC','SCORE_DESC','PROGRESS_DESC','MEDIA_AVERAGE_SCORE_DESC']) {
    await page.evaluate((s)=>{ state.listSort=s; savePrefs(); return loadMyList(); }, so);
    await page.waitForTimeout(900);
    check(`sort ${so}`, await rows()>0, `rows=${await rows()}`);
  }

  console.log('[after a write]');
  const before=await rows();
  await page.evaluate(async()=>{
    const m=`mutation ($mediaId: Int, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id progress status }
    }`;
    await mutateList(m,{mediaId:1000,progress:5});
  });
  await page.waitForTimeout(500);
  await page.evaluate(()=>loadMyList()); await page.waitForTimeout(1200);
  check('My List still loads after a write', await rows()>0, `rows=${await rows()} (was ${before})`);
  // Read the specific row, not the first 70 characters of the grid (which are
  // the swipe action labels).
  const meta = await page.evaluate(()=>{
    const w=document.querySelector('#my-list-grid .list-row-wrap[data-media-id="1000"]');
    return w ? (w.querySelector('.list-row-meta')||{}).textContent?.trim() : 'row not found';
  });
  check('progress reflects the write', /\b5\/12\b/.test(meta||''), meta);

  console.log('[add a brand new show, then My List]');
  await page.evaluate(async()=>{
    const m=`mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
    }`;
    await mutateList(m,{mediaId:1099,status:'CURRENT'});
  });
  await page.evaluate(()=>loadMyList()); await page.waitForTimeout(1200);
  check('My List loads after adding a new show', await rows()>0, `rows=${await rows()}`);

  check('no private key reached the API', seen.length===0, seen[0]||'');
  check('still no page errors', errs.length===0, errs[0]||'');
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
