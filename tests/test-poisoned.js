// A device upgrading FROM v4.86/4.87 carries a persisted cache where every
// entry was marked stale (exp: 0), plus whatever shapes those versions wrote.
// Does the app recover, and how hard does it hit the API doing it?
const { chromium } = require('playwright');
const { makeState, handler } = require('./anilist-fake');
let fails=0;
const check=(n,ok,d)=>{ if(!ok) fails++; console.log(`  ${ok?'ok  ':'FAIL'}  ${n}${d!==undefined?'  '+d:''}`); };
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  for (const variant of ['all stale (v4.86/87 legacy)','corrupt entry','huge blob']) {
    const S=makeState();
    const page=await b.newPage({viewport:{width:412,height:915}});
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    let reqs=0, peak=0, inflight=0;
    await page.addInitScript((v)=>{
      localStorage.setItem('anilog-prefs',JSON.stringify({theme:'dark',themeId:'iris',accessToken:'TOK'}));
      const blob={};
      const mk=(i)=>({Page:{pageInfo:{hasNextPage:false},media:[{id:2000+i,title:{userPreferred:'Cached '+i},
        coverImage:{large:'x'},mediaListEntry:{status:'CURRENT'},episodes:12}]}});
      for(let i=0;i<40;i++) blob['auth:query{Page'+i+'}{}']={data:mk(i),exp:0};   // stale
      if(v==='corrupt entry'){ blob['auth:broken']={data:null,exp:0};
        blob['auth:broken2']={exp:0}; blob['auth:broken3']={data:{Page:{media:null}},exp:0}; }
      if(v==='huge blob'){ for(let i=0;i<400;i++) blob['auth:big'+i]={data:mk(i),exp:0}; }
      try{ localStorage.setItem('anilog-cache-v1',JSON.stringify(blob)); }catch(e){}
    }, variant);
    await page.route('**/*', async r=>{
      const u=r.request().url();
      if(!u.startsWith('data:')&&!u.includes('localhost:8099')){ reqs++; inflight++; peak=Math.max(peak,inflight);
        const res=await handler(S)(r); inflight--; return res; }
      return handler(S)(r);
    });
    const t0=Date.now();
    await page.goto('http://localhost:8099/index.html',{waitUntil:'load'});
    await page.waitForTimeout(4000);
    const rows=await page.evaluate(()=>document.querySelectorAll('#my-list-grid .list-row-wrap').length);
    console.log(`[${variant}]`);
    check('My List renders', rows>0, `rows=${rows}, ${reqs} requests, peak ${peak}, ${Date.now()-t0}ms`);
    check('no page errors', errs.length===0, errs[0]||'');
    await page.close();
  }
  console.log(fails?`\n${fails} FAILURE(S)`:'\nALL PASS');
  await b.close(); process.exit(fails?1:0);
})();
