const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.env.ROOT||'/home/user/AniLog';
const T={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((req,res)=>{let p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]));
  if(p.endsWith('/'))p+='index.html';
  fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'Content-Type':T[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});
}).listen(8099,'127.0.0.1',()=>console.log('up'));
