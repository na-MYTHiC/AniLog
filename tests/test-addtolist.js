// Two reported symptoms, one scenario:
//  A) after adding to a list, does browsing stall / storm the API?
//  B) does the new list badge show on Search immediately, or only after
//     leaving the tab and coming back?
const { chromium } = require('playwright');
const LAT = 260;
const mk=(c)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="${c}"/></svg>`);
const IMG=mk('#3a3550');
// Server-side truth for list membership, so a refetch really reflects the add.
const listed = new Set();
const media=(i)=>({id:1000+i,title:{userPreferred:'Anime '+i},
  coverImage:{large:IMG,extraLarge:IMG,color:'#7c5cff'},averageScore:80,format:'TV',episodes:12,type:'ANIME',
  season:'FALL',seasonYear:2023,status:'RELEASING',nextAiringEpisode:{episode:9,timeUntilAiring:6000},
  mediaListEntry: listed.has(1000+i) ? {status:'CURRENT'} : null,
  startDate:{year:2023,month:1},genres:['Action'],popularity:100});
const MEDIA=()=>Array.from({length:12},(_,i)=>media(i));

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const page=await b.newPage({viewport:{width:412,height:915}});
  let reqs=[], inflight=0, peak=0;
  await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
    JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
  await page.route('**/*',async r=>{const u=r.request().url();
    if(u.startsWith('data:')||u.includes('localhost:8099'))return r.continue();
    const q=JSON.parse(r.request().postData()||'{}').query||'';
    const v=JSON.parse(r.request().postData()||'{}').variables||{};
    reqs.push(q.includes('SaveMediaListEntry')?'MUTATION':q.includes('Viewer')?'Viewer'
      :q.includes('MediaListCollection')?'MyList':/^\s*\w+:\s*Page\(/m.test(q)?'SearchRows'
      :q.includes('Media(id:')?'Detail':'Page');
    inflight++; peak=Math.max(peak,inflight);
    const send=(d)=>setTimeout(()=>{inflight--; r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:d})});},LAT);
    if(Object.keys(v).some(k=>k.startsWith('__'))) console.log('   !! private key leaked to the API:', JSON.stringify(v));
    if(q.includes('SaveMediaListEntry')){ listed.add(v.mediaId); return send({SaveMediaListEntry:{id:7,progress:0,status:'PLANNING',score:0}}); }
    if(q.includes('DeleteMediaListEntry')) return send({DeleteMediaListEntry:{deleted:true}});
    if(q.includes('Viewer'))return send({Viewer:{id:42,name:'me',avatar:{large:IMG},unreadNotificationCount:0,statistics:{anime:{count:3,minutesWatched:1,episodesWatched:1}}}});
    if(q.includes('MediaListCollection'))return send({MediaListCollection:{lists:[{entries:MEDIA().slice(0,3).map((m,i)=>({id:i,status:'CURRENT',score:8,progress:3,media:m}))}]}});
    const al=[...q.matchAll(/^\s*(\w+):\s*Page\(/gm)].map(m=>m[1]);
    if(al.length){const d={};al.forEach(a=>d[a]={pageInfo:{hasNextPage:false},media:MEDIA()});return send(d);}
    if(q.includes('Media(id:'))return send({Media:{...media(5),bannerImage:IMG,description:'d',meanScore:80,favourites:1,duration:24,studios:{nodes:[{id:1,name:'S'}]},tags:[],trailer:null,source:'MANGA',countryOfOrigin:'JP',externalLinks:[],synonyms:[],endDate:{year:2024,month:1,day:1}}});
    return send({Page:{pageInfo:{hasNextPage:false},media:MEDIA()}});});

  await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
  await page.waitForTimeout(2200);
  // Warm every tab, the way a real session would be.
  for (const t of ['search','seasonal','social','profile','home']) {
    await page.evaluate(tt=>switchTab(tt),t); await page.waitForTimeout(1600); }
  await page.waitForTimeout(1200);

  const badges = () => page.evaluate(()=>{
    const cards=[...document.querySelectorAll('#tab-search .carousel .card')];
    const target=cards.find(c=>(c.getAttribute('onclick')||'').includes('1005'));
    return {total:cards.length, targetHasBadge: target ? !!target.querySelector('.card-badge-on') : null};
  });

  await page.evaluate(()=>switchTab('search')); await page.waitForTimeout(1500);
  console.log('before add — search badge on Anime 5:', JSON.stringify(await badges()));

  // Add media 1005 to the list, exactly as the detail sheet does.
  reqs=[]; peak=0;
  await page.evaluate(async()=>{
    const m=`mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status) { id status progress score }
    }`;
    await mutateList(m, {mediaId:1005, status:'PLANNING'});
  });
  await page.waitForTimeout(1500);
  console.log('right after add  — search badge:', JSON.stringify(await badges()));
  console.log(`   requests during/after add: ${reqs.length} ${JSON.stringify(reqs.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{}))}  peak concurrent: ${peak}`);

  // Leave the tab and come back — the user's workaround.
  reqs=[]; peak=0;
  await page.evaluate(()=>switchTab('home')); await page.waitForTimeout(900);
  await page.evaluate(()=>switchTab('search')); await page.waitForTimeout(1800);
  console.log('after leave+return — search badge:', JSON.stringify(await badges()));

  // Then browse everything and see whether it still loads.
  reqs=[]; peak=0;
  const t0=Date.now();
  for (const t of ['seasonal','social','profile','home','search']) {
    await page.evaluate(tt=>switchTab(tt),t); await page.waitForTimeout(1300); }
  const after=await page.evaluate(()=>({
    rows:document.querySelectorAll('.list-row').length,
    searchCards:document.querySelectorAll('#tab-search .carousel .card').length,
  }));
  console.log(`browsing all tabs after the add: ${reqs.length} requests, peak concurrent ${peak}, ${Date.now()-t0}ms`);
  console.log(`   ${JSON.stringify(reqs.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{}))}`);
  console.log(`   still rendering: list rows=${after.rows} search cards=${after.searchCards}`);

  await page.evaluate(()=>switchTab('search')); await page.waitForTimeout(900);
  await page.evaluate(async()=>{
    await mutateList(`mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
      { id: 7, __mediaId: 1005 });
  });
  await page.waitForTimeout(700);
  console.log('after removing from list  — search badge:', JSON.stringify(await badges()));
  await b.close();
})();
