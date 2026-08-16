// Service worker for the Shopping List PWA.
//
// Strategy: network-first for everything, with the cache as an OFFLINE-ONLY
// fallback. When online you always get the latest files (a normal reload is
// never stale); when offline you get the last-cached copy. The precache below
// just guarantees the app shell is available on a cold offline launch.
const CACHE_NAME = 'shopping-list-v3';
const SHELL = [
  '/static/css/pico.min.css',
  '/static/css/style.css',
  '/static/js/alpine.min.js',
  '/static/js/script.js',
  '/static/img/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs. POST /api/* (mutations) pass straight through.
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Normalize the cache key so the ?key= auth query never creates duplicate or
  // poisoned entries for the page and the list JSON. Static assets carry no key,
  // so they cache under their own request.
  let key = req;
  if (url.pathname === '/api/items') key = '/api/items';
  else if (req.mode === 'navigate') key = '/';

  event.respondWith(networkFirst(req, key));
});

// Try the network; on success refresh the cache and return it. On failure
// (offline) serve the cached copy, tagged X-From-Cache so the client knows.
async function networkFirst(req, key) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  } catch (_) {
    const cached = await cache.match(key);
    if (!cached) return Response.error();
    const headers = new Headers(cached.headers);
    headers.set('X-From-Cache', '1');
    return new Response(await cached.blob(), { status: 200, headers });
  }
}
