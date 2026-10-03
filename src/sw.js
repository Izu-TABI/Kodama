// Kodama's service worker. The build turns this file into dist/sw.js, filling
// in this version's files (see vite.config.js). With it the app opens without
// a connection, and so do the dictionary, the TED list and the speech runtime
// once they have been used. TED video and the translator always use the network.
const BUILT = '__BUILT__';
const SHELL = __SHELL__; // the page, its scripts and styles: kept when this version installs
const ASSETS = __ASSETS__; // every built file of this version
const SHELL_CACHE = `kodama-shell-${BUILT}`;
const DATA_CACHE = 'kodama-data';
const FONT_CACHE = 'kodama-fonts';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // The version before this one stays, for pages still open on it.
    const shells = (await caches.keys()).filter(k => k.startsWith('kodama-shell-')).sort();
    await Promise.all(shells.slice(0, -2).map(k => caches.delete(k)));
    // Built files no version uses any more (an old speech runtime).
    const data = await caches.open(DATA_CACHE);
    const current = new Set(ASSETS);
    for (const request of await data.keys()) {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/assets/') && !current.has(pathname)) await data.delete(request);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else if (url.origin === location.origin) {
    if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
    else if (/^\/(dict|ted|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') event.respondWith(fresh(event, DATA_CACHE));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(fresh(event, FONT_CACHE));
  }
  // Anything else (TED streams and thumbnails, the translator, speech models) goes to the network.
});

// The page: from the network, so a new version shows up; the kept copy when offline or slow.
async function page(request) {
  try {
    return await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(reject, 4000))]);
  } catch {
    return (await caches.match('/')) ?? Response.error();
  }
}

// Built files never change under the same name.
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) (await caches.open(DATA_CACHE)).put(request, response.clone());
  return response;
}

// The kept copy at once, refreshed in the background for next time.
async function fresh(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const update = fetch(event.request).then(response => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  });
  if (!hit) return update;
  event.waitUntil(update.catch(() => {}));
  return hit;
}
