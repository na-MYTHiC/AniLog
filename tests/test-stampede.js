// A write used to mark EVERY cached key stale. The next browse then fires a
// background refresh per key, saturates the 4-slot gate and trips AniList's
// rate limiter — the app appears to stop loading. Measure the blast radius.
const { chromium } = require('playwright');
const mk=(c)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="${c}"/></svg>`);
const IMG=mk('#3a3550');
const media=(i)=>({id:1000+i,title:{userPreferred:'Anime '+i},coverImage:{large:IMG,extraLarge:IMG,color:'#7c5cff'},
  averageScore:80,format:'TV',episodes:12,type:'ANIME',season:'FALL',seasonYear:2023,status:'RELEASING',
  nextAiringEpisode:{episode:9,timeUntilAiring:6000},mediaListEntry:null,startDate:{year:2023,month:1},genres:['Action'],popularity:100});
const MEDIA=Array.from({length:12},(_,i)=>media(i));
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const page=await b.newPage({viewport:{width:412,height:915}});
  await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
    JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
  await page.route('**/*',async r=>{const u=r.request().url();
    if(u.startsWith('data:')||u.includes('localhost:8099'))return r.continue();
    const q=JSON.parse(r.request().postData()||'{}').query||'';
    const J=d=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:d})});
    if(q.includes('SaveMediaListEntry'))return J({SaveMediaListEntry:{id:7,progress:0,status:'PLANNING',score:0}});
    if(q.includes('Viewer'))return J({Viewer:{id:42,name:'me',avatar:{large:IMG},unreadNotificationCount:0,statistics:{anime:{count:3,minutesWatched:1,episodesWatched:1}}}});
    if(q.includes('MediaListCollection'))return J({MediaListCollection:{lists:[{entries:MEDIA.slice(0,3).map((m,i)=>({id:i,status:'CURRENT',score:8,progress:3,media:m}))}]}});
    const al=[...q.matchAll(/^\s*(\w+):\s*Page\(/gm)].map(m=>m[1]);
    if(al.length){const d={};al.forEach(a=>d[a]={pageInfo:{hasNextPage:false},media:MEDIA});return J(d);}
    return J({Page:{pageInfo:{hasNextPage:false},media:MEDIA}});});
  await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
  await page.waitForTimeout(1800);
  // Build a realistic cache: browse everything, open a bunch of detail pages.
  for (const t of ['search','seasonal','social','profile','home']) {
    await page.evaluate(tt=>switchTab(tt),t); await page.waitForTimeout(1000); }
  for (let i=0;i<12;i++){ await page.evaluate(id=>openMedia(id),1000+i); await page.waitForTimeout(220); }
  await page.evaluate(()=>{const o=document.getElementById('detail-overlay'); o.classList.remove('visible');});
  await page.waitForTimeout(1500);

  const due = () => page.evaluate(()=>{
    const now=Date.now(); let total=0, stale=0;
    for (const k of Object.keys(cache)) { total++; }
    // cacheExpires isn't global; infer staleness by asking the module.
    return { total };
  });
  const before = await page.evaluate(()=>Object.keys(cache).length);
  // Count how many keys a write leaves due for a background refresh, by
  // calling anilist() for each cached key and seeing how many hit the network.
  let netCalls = 0;
  await page.route('**/graphql.anilist.co*', async (r)=>{ netCalls++; await r.continue(); });

  await page.evaluate(async()=>{
    await mutateList(`mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
    }`, {mediaId:1005, status:'PLANNING'});
  });
  await page.waitForTimeout(800);
  const after = await page.evaluate(()=>Object.keys(cache).length);

  // Now re-read every cached query and count how many actually go to network.
  const hits = await page.evaluate(async()=>{
    let net=0;
    const origFetch = window.fetch;
    window.fetch = (...a)=>{ if(String(a[0]).includes('anilist')) net++; return origFetch(...a); };
    // Touch each cached key the way a tab revisit would.
    const keys = Object.keys(cache);
    for (const k of keys) {
      const q = k.replace(/^(auth|pub):/,'').replace(/\{.*$/s,'');
    }
    await new Promise(r=>setTimeout(r,100));
    window.fetch = origFetch;
    return net;
  });

  console.log(`cached keys before write: ${before}`);
  console.log(`cached keys after write : ${after}   (MediaListCollection deliberately dropped)`);
  const staleCount = await page.evaluate(()=>{
    // Re-derive staleness the same way anilist() does, via a probe read.
    return typeof cacheExpires !== 'undefined'
      ? [...cacheExpires.values()].filter(v=>v<=Date.now()).length : 'n/a';
  });
  console.log(`keys left DUE for a background refresh: ${staleCount}`);
  await b.close();
})();
