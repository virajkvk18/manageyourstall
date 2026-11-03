import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const p=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}const body=await readFile(p);res.writeHead(200,{'Content-Type':({'html':'text/html','css':'text/css','mjs':'text/javascript','js':'text/javascript','svg':'image/svg+xml','png':'image/png','webmanifest':'application/manifest+json','woff2':'font/woff2'})[p.split('.').pop()]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);}catch{res.writeHead(404).end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
