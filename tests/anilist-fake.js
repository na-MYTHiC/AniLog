// A fake AniList that answers the way the real one does: MediaListCollection
// split into one list PER STATUS, entries carrying their own status, and
// server-side truth that a write actually changes.
const IMG='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#4a4260"/></svg>');
const STATUSES=['CURRENT','PLANNING','COMPLETED','PAUSED','DROPPED','REPEATING'];
function makeState(){
  const entries=new Map();          // mediaId -> {id,status,score,progress}
  for(let i=0;i<14;i++){
    entries.set(1000+i,{id:500+i,status:STATUSES[i%STATUSES.length],score:7+(i%4),progress:i%12});
  }
  return {entries, nextEntryId:900};
}
const media=(id)=>({id,title:{userPreferred:'Anime '+(id-1000),english:'Anime '+(id-1000),romaji:'Anime '+(id-1000)},
  coverImage:{large:IMG,extraLarge:IMG,color:'#7c5cff'},averageScore:70+(id%30),format:'TV',episodes:12,
  type:'ANIME',season:'FALL',seasonYear:2023,status:'RELEASING',
  nextAiringEpisode:{airingAt:0,episode:9,timeUntilAiring:6000},startDate:{year:2023,month:1,day:1},
  genres:['Action'],popularity:500});
function handler(S, opts={}){
  return async (route)=>{
    const u=route.request().url();
    if(u.startsWith('data:')||u.includes('localhost:8099'))return route.continue();
    const body=JSON.parse(route.request().postData()||'{}');
    const q=body.query||'', v=body.variables||{};
    if(opts.onRequest) opts.onRequest(q,v);
    const J=(d)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:d})});
    const withEntry=(id)=>{const e=S.entries.get(id);
      return {...media(id), mediaListEntry: e?{id:e.id,status:e.status,score:e.score,progress:e.progress}:null};};

    if(q.includes('Viewer')) return J({Viewer:{id:42,name:'me',avatar:{large:IMG,medium:IMG},
      unreadNotificationCount:0,statistics:{anime:{count:S.entries.size,minutesWatched:9000,episodesWatched:140}}}});

    if(q.includes('MediaListCollection')){
      // Real AniList returns one list per status; when status: is supplied it
      // returns only that one.
      const want=v.status||null;
      const byStatus={};
      for(const [mid,e] of S.entries){
        if(want && e.status!==want) continue;
        (byStatus[e.status]=byStatus[e.status]||[]).push(
          {id:e.id,status:e.status,score:e.score,progress:e.progress,media:media(mid)});
      }
      const lists=Object.keys(byStatus).map(st=>({name:st,status:st,entries:byStatus[st]}));
      return J({MediaListCollection:{lists}});
    }
    if(q.includes('SaveMediaListEntry')){
      const mid=v.mediaId; const cur=S.entries.get(mid)||{id:++S.nextEntryId,status:'PLANNING',score:0,progress:0};
      if(v.status!==undefined) cur.status=v.status;
      if(v.progress!==undefined) cur.progress=v.progress;
      if(v.score!==undefined) cur.score=v.score;
      S.entries.set(mid,cur);
      return J({SaveMediaListEntry:{id:cur.id,status:cur.status,progress:cur.progress,score:cur.score}});
    }
    if(q.includes('DeleteMediaListEntry')){
      for(const [mid,e] of S.entries) if(e.id===v.id){ S.entries.delete(mid); break; }
      return J({DeleteMediaListEntry:{deleted:true}});
    }
    if(q.includes('characters(')) return J({Media:{id:v.id,characters:{edges:[]}}});
    if(q.includes('recommendations')) return J({Media:{id:v.id,relations:{edges:[]},recommendations:{edges:[]}}});
    const al=[...q.matchAll(/^\s*(\w+):\s*Page\(/gm)].map(m=>m[1]);
    if(al.length){const d={};al.forEach(a=>d[a]={pageInfo:{hasNextPage:false},
      media:Array.from({length:12},(_,i)=>withEntry(1000+i))});return J(d);}
    if(q.includes('Media(id:')) return J({Media:{...withEntry(v.id||1000),bannerImage:IMG,description:'desc',
      meanScore:80,favourites:10,duration:24,studios:{nodes:[{id:1,name:'Madhouse'}]},tags:[],trailer:null,
      source:'MANGA',countryOfOrigin:'JP',externalLinks:[],synonyms:[],endDate:{year:2024,month:3,day:1}}});
    return J({Page:{pageInfo:{hasNextPage:false},media:Array.from({length:12},(_,i)=>withEntry(1000+i))}});
  };
}
module.exports={makeState,handler,STATUSES,IMG};
