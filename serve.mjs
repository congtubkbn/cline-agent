import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
http.createServer((q,s)=>{
  let f=path.join(root, q.url==='/'?'index.html':decodeURIComponent(q.url.slice(1)));
  fs.readFile(f,(e,d)=>{
    if(e){s.statusCode=404;s.end('404');return;}
    const t={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.txt':'text/plain'}[path.extname(f)]||'text/plain';
    s.setHeader('content-type',t); s.end(d);
  });
}).listen(8099,()=>console.log('serving web/ on http://localhost:8099'));
