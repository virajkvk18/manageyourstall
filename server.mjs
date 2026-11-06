// Local static server for dist/ (development and Playwright). Binds to loopback only.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const types = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  webmanifest: 'application/manifest+json', woff2: 'font/woff2', ttf: 'font/ttf',
};
const port = Number(process.env.PORT || 4173);

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = path.resolve(root, '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!p.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(p);
    res.writeHead(200, {'Content-Type': types[p.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
