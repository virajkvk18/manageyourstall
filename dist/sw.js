// ManageYourStall (MYS) offline service worker — created by viraj.
// Precaches every shipped file (scripts/check.mjs enforces the list) and serves same-origin GETs cache-first.
// A new version waits until the page asks it to take over ({type: 'SKIP_WAITING'}), so nobody is reloaded mid-order.
const CACHE = 'mys-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './app.mjs',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './archivo.ttf',
  './space.ttf',
  './space-bold.ttf',
  './css/base.css',
  './css/sell.css',
  './css/checkout.css',
  './css/orders.css',
  './css/dashboard.css',
  './css/menu.css',
  './css/picker.css',
  './css/studio.css',
  './css/more.css',
  './css/money.css',
  './css/collab.css',
  './css/landing.css',
  './css/setup.css',
  './css/stalls.css',
  './util.mjs',
  './constants.mjs',
  './library.mjs',
  './art/classic.mjs',
  './art/snacks.mjs',
  './art/mains.mjs',
  './art/drinks.mjs',
  './art/sweets.mjs',
  './catalog.mjs',
  './domain.mjs',
  './templates.mjs',
  './qr.mjs',
  './storage.mjs',
  './icons.mjs',
  './ui/core.mjs',
  './ui/shell.mjs',
  './ui/sell.mjs',
  './ui/checkout.mjs',
  './ui/orders.mjs',
  './ui/dashboard.mjs',
  './ui/milestones.mjs',
  './ui/menu.mjs',
  './ui/picker.mjs',
  './ui/studio.mjs',
  './ui/onboarding.mjs',
  './ui/more.mjs',
  './ui/games.mjs',
  './ui/data.mjs',
  './ui/money.mjs',
  './ui/collab.mjs',
  './ui/landing.mjs',
  './ui/setup.mjs',
  './ui/stalls.mjs',
  './ui/account.mjs',
  './cloud.mjs',
  './config.mjs',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => (key.startsWith('packet-pataka-shell-') || key.startsWith('mys-shell-')) && key !== CACHE)
            .map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, {ignoreSearch: request.mode === 'navigate'}).then(
      cached =>
        cached ||
        fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())),
    ),
  );
});
