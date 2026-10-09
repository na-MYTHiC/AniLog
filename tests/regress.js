// Consolidated regression: boot, every tab, grid columns, the onLine fix, and
// the error states. Rebuilt after the container wiped the scratchpad.
const { chromium } = require('playwright');
const mk=(c)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="${c}"/></svg>`);
const IMG=mk('#4a4260');
const TITLES=['Short','Also Short','Daemons of the Shadow Realm','Ordinary','Rascal Does Not Dream',
  'Fine','JoJos Bizarre Adventure Steel Ball Run','Tiny','Tenseishitaraslimedattakenseasonfourextended',
  'Ok','The Dangers in My Heart','Next'];
const MEDIA=TITLES.map((t,i)=>({id:1000+i,title:{userPreferred:t,english:t,romaji:t},
  coverImage:{large:IMG,extraLarge:IMG,color:'#7c5cff'},averageScore:80,format:'TV',episodes:12,type:'ANIME',
  season:'FALL',seasonYear:2023,status:'RELEASING',nextAiringEpisode:{episode:9,timeUntilAiring:6000},
  mediaListEntry:i%4?null:{status:'CURRENT'},startDate:{year:2023,month:1},genres:['Action'],popularity:100}));
const LIST=MEDIA.slice(0,6).map((m,i)=>({id:i,status:'CURRENT',score:8,progress:3,media:m}));
const stub=(mode)=>async r=>{const u=r.request().url();
  if(u.startsWith('data:')||u.includes('localhost:8099'))return r.continue();
  if(mode==='dead')return r.fulfill({status:500,body:'err'});
  const q=JSON.parse(r.request().postData()||'{}').query||'';
  const J=d=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:d})});
  if(q.includes('Viewer'))return J({Viewer:{id:42,name:'me',avatar:{large:IMG},unreadNotificationCount:0,statistics:{anime:{count:6,minutesWatched:1,episodesWatched:1}}}});
  if(q.includes('MediaListCollection'))return J({MediaListCollection:{lists:[{entries:LIST}]}});
  if(q.includes('Studio'))return J({Studio:{id:1,name:'Madhouse',media:{pageInfo:{hasNextPage:false},nodes:MEDIA}}});
  if(q.includes('characters('))return J({Media:{id:1000,characters:{edges:[]}}});
  if(q.includes('recommendations'))return J({Media:{id:1000,relations:{edges:[]},recommendations:{edges:[]}}});
  const al=[...q.matchAll(/^\s*(\w+):\s*Page\(/gm)].map(m=>m[1]);
  if(al.length){const d={};al.forEach(a=>d[a]={pageInfo:{hasNextPage:false},media:MEDIA});return J(d);}
  if(q.includes('Media(id:'))return J({Media:{...MEDIA[0],bannerImage:IMG,description:'d',meanScore:80,favourites:1,duration:24,studios:{nodes:[{id:1,name:'S'}]},tags:[],trailer:null,source:'MANGA',countryOfOrigin:'JP',externalLinks:[],synonyms:[],endDate:{year:2024,month:1,day:1}}});
  return J({Page:{pageInfo:{hasNextPage:false},media:MEDIA}});};
let fails=0;
const check=(name,ok,detail)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${name}${detail?'  '+detail:''}`); };

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});

  // --- boot + every tab, in both densities, checking grid columns too ---
  for (const density of ['compact','comfortable']) {
    const page=await b.newPage({viewport:{width:412,height:915}});
    const errs=[],bad=[];
    page.on('pageerror',e=>errs.push(e.message));
    page.on('response',r=>{if(r.url().includes('localhost:8099')&&r.status()>=400)bad.push(r.status()+' '+r.url());});
    await page.addInitScript(d=>localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',density:d,accessToken:'TOK'})),density);
    await page.route('**/*',stub('ok'));
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(2000);
    console.log(`[${density}]`);
    check('home list renders', await page.evaluate(()=>document.querySelectorAll('.list-row').length)>0);
    for (const t of ['search','seasonal','social','profile']) {
      await page.evaluate(tt=>switchTab(tt),t); await page.waitForTimeout(1100); }
    check('all tabs render', await page.evaluate(()=>document.querySelectorAll('.card,.settings-row,.activity-card').length)>5);
    // grid columns even?
    const grids=async()=>page.evaluate(()=>{
      const out={};
      for (const g of document.querySelectorAll('.grid')) {
        if(!g.offsetParent) continue;
        const cards=[...g.querySelectorAll('.card')]; if(cards.length<2) continue;
        const byTop={}; cards.forEach(c=>{const t=Math.round(c.getBoundingClientRect().top);
          (byTop[t]=byTop[t]||[]).push(Math.round(c.getBoundingClientRect().width));});
        const w=[...new Set(Object.values(byTop).flat())];
        out[g.id]={spread:Math.max(...w)-Math.min(...w), overflow:g.scrollWidth-g.clientWidth};
      }
      return out;});
    await page.evaluate(()=>switchTab('seasonal')); await page.waitForTimeout(1200);
    let g=await grids();
    check('seasonal columns even', Object.values(g).every(v=>v.spread<=1&&v.overflow<=0), JSON.stringify(g));
    await page.evaluate(()=>{ if(typeof openGenre==='function') openGenre('Action'); }); await page.waitForTimeout(1200);
    g=await grids();
    check('genre columns even', Object.values(g).every(v=>v.spread<=1&&v.overflow<=0), JSON.stringify(g));
    check('no 4xx', bad.length===0, bad[0]||'');
    check('no page errors', errs.length===0, errs[0]||'');
    await page.close();
  }

  // --- navigator.onLine lying must not stop anything loading ---
  {
    const page=await b.newPage({viewport:{width:412,height:915}});
    let served=0;
    await page.addInitScript(()=>{localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'}));
      Object.defineProperty(navigator,'onLine',{get:()=>false});});
    await page.route('**/*',async r=>{ if(!r.request().url().includes('localhost:8099')&&!r.request().url().startsWith('data:')) served++; return stub('ok')(r); });
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(2500);
    console.log('[navigator.onLine lies about being offline]');
    check('still makes requests', served>0, `${served} request(s)`);
    check('still renders the list', await page.evaluate(()=>document.querySelectorAll('.list-row').length)>0);
    await page.close();
  }

  // --- a dead API must say "couldn't reach", not "sign in" ---
  {
    const page=await b.newPage({viewport:{width:412,height:915}});
    await page.addInitScript(()=>localStorage.setItem('anilog-prefs',
      JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'})));
    await page.route('**/*',stub('dead'));
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(6000);
    const st=await page.evaluate(()=>({
      offline:(()=>{const e=document.getElementById('home-offline');return !!(e&&e.offsetParent);})(),
      signin:(()=>{const e=document.getElementById('home-empty');return !!(e&&e.offsetParent);})()}));
    console.log('[AniList returning 500 for everything]');
    check('shows "couldn\'t reach AniList"', st.offline);
    check('does NOT tell a signed-in user to sign in', !st.signin);
    await page.close();
  }

  console.log(fails? `\n${fails} FAILURE(S)` : '\nALL PASS');
  await b.close();
  process.exit(fails?1:0);
})();
