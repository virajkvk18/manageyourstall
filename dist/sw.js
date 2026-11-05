const CACHE='packet-pataka-shell-v2';
const ASSETS=['./','./index.html','./style.css','./app.mjs','./domain.mjs','./storage.mjs','./art.mjs','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./space.ttf','./space-bold.ttf','./archivo.ttf'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('packet-pataka-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).catch(()=>event.request.mode==='navigate'?caches.match('./index.html'):Response.error())));});
