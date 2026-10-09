// The real thing: tap through the UI the way a person does.
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const S=makeState();
  const page=await b.newPage({viewport:{width:412,height:915}});
  const errs=[], warns=[];
  page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text().slice(0,140));
                         if(m.type()==='warning') warns.push(m.text().slice(0,100)); });
  await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
    JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
  await page.route('**/*', handler(S));
  await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
  await page.waitForTimeout(2500);

  const rows=()=>page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
  console.log('[start]'); check('My List has rows', await rows()>0, `rows=${await rows()}`);

  // Go to Search, open a show that is NOT on the list, add it via the sheet.
  await page.evaluate(()=>switchTab('search')); await page.waitForTimeout(1800);
  // 1099 is not in the fake's seeded entries.
  await page.evaluate(()=>openMedia(1099)); await page.waitForTimeout(1800);
  const btn = await page.evaluate(()=>{const b=document.getElementById('detail-list-btn');
    return b?{text:b.textContent.trim(),visible:!!b.offsetParent}:null;});
  check('detail "Add to list" button present', !!btn && btn.visible, JSON.stringify(btn));
  await page.evaluate(()=>document.getElementById('detail-list-btn').click());
  await page.waitForTimeout(900);
  const sheetOpen = await page.evaluate(()=>{const s=document.getElementById('list-edit-modal');
    return !!(s && s.classList.contains('visible'));});
  check('edit sheet opens', sheetOpen);

  await page.evaluate(()=>{
    const chip=document.querySelector('#list-edit-status .chip[data-status="CURRENT"]');
    if(chip) chip.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(()=>{const s=document.getElementById('list-edit-save-btn'); if(s) s.click();});
  await page.waitForTimeout(2500);

  console.log('[after adding via the sheet]');
  check('server recorded the add', S.entries.has(1099), `entries=${S.entries.size}`);
  await page.evaluate(()=>{const o=document.getElementById('detail-overlay'); if(o)o.classList.remove('visible');});
  await page.evaluate(()=>switchTab('home')); await page.waitForTimeout(2200);
  const n=await rows();
  check('My List loads after the add', n>0, `rows=${n}`);
  check('the new show is in My List', await page.evaluate(()=>
    (document.getElementById('my-list-grid')||{}).textContent?.includes('Anime 99')), );
  check('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  if (warns.length) console.log('  (warnings: '+warns.slice(0,3).join(' | ')+')');

  // And bump progress by swipe-equivalent, then reload the list.
  console.log('[after bumping progress]');
  await page.evaluate(async()=>{
    const w=document.querySelector('#my-list-grid .list-row-wrap');
    const id=parseInt(w.dataset.mediaId,10);
    await bumpProgress({media:{id,episodes:12},progress:1,status:'CURRENT'},+1,w);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(()=>loadMyList()); await page.waitForTimeout(1800);
  check('My List still loads after a bump', await rows()>0, `rows=${await rows()}`);
  check('still no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
