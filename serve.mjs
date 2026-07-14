import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
const PORT = 8099;

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

http.createServer((q,s)=>{
  let f=path.join(root, q.url==='/'?'index.html':decodeURIComponent(q.url.slice(1)));
  fs.readFile(f,(e,d)=>{
    if(e){s.statusCode=404;s.end('404');return;}
    const t={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.txt':'text/plain'}[path.extname(f)]||'text/plain';
    s.setHeader('content-type',t); s.end(d);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('serving web/ on:');
  console.log(`  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  http://${ip}:${PORT}   (LAN — share this with others on the network)`);
  }
});
