// CyberManju OS — The Stem Array Web service worker (web/service-worker.js).
// Role: keeps the Ren'Py engine (~37 MB of wasm + engine data) and the start-up
//       assets on the device, so a repeat visit no longer re-downloads the whole
//       engine before the first frame.
// Exports: service worker lifecycle + fetch/message handlers.
// Integrates: build_web.sh and tools/stamp_service_worker.py (content stamp),
//       tools/validate_web_candidate.py, tools/smoke_web_build.py, and Ren'Py's
//       renpy-pre.js (loadCache / clearCache messages, pwa_catalog.json).
// Contracts: navigation and pwa_catalog.json stay network-first so a deploy is
//       seen immediately; Range requests are never intercepted (the engine
//       streams the archive with them); only status-200 same-origin responses are
//       stored; an unstamped source checkout (placeholder still present) never
//       intercepts anything, so a stale dev copy can never serve old bytes.
//
// Cache invalidation is a content stamp: build_web.sh hashes every shipped file
// and writes the digest into __STEM_CACHE_VERSION__, so the cache name changes
// exactly when bytes change — no manual cache-busting and no stale game.

var CACHE_PREFIX = 'stem-array-vn-';
var CACHE_VERSION = '__STEM_CACHE_VERSION__';
var STAMPED = CACHE_VERSION.indexOf('__STEM') !== 0;
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// What the first frame needs: engine, engine data, archive, presplash.
// The 111 progressive chapter/sprite images are cached on first use instead —
// preloading 72 MiB at install would double the initial download.
var PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'renpy-pre.js',
  'renpy.js',
  'renpy.wasm',
  'renpy.data',
  'game.zip',
  'web-presplash.jpg',
  // The loading overlay is the first thing painted, so it is part of the
  // start-up payload; the chapter art it zooms on is cached with it.
  'loading/loading.css',
  'loading/loading.js',
  'loading/02.webp',
  'loading/02-small.webp',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png'
];

function isCacheable(response) {
  return !!response && response.status === 200 && response.type !== 'opaque';
}

async function precache() {
  var cache = await caches.open(CACHE_NAME);
  // One failure (a missing icon, a quota limit) must not disable the worker.
  await Promise.all(PRECACHE.map(async function (path) {
    try {
      var response = await fetch(new Request(path, { cache: 'no-cache' }));
      if (isCacheable(response)) {
        await cache.put(path, response);
      }
    } catch (error) {
      console.log('Stem Array precache skipped: ' + path + ' (' + error + ')');
    }
  }));
}

self.addEventListener('install', function (event) {
  if (!STAMPED) return;
  event.waitUntil(precache());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    if (STAMPED) {
      // Safe here: without skipWaiting this runs only once pages of the previous
      // version are gone, so no live game is reading the caches being dropped.
      var names = await caches.keys();
      await Promise.all(names.map(function (name) {
        if (name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME) {
          return caches.delete(name);
        }
      }));
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  var cache = await caches.open(CACHE_NAME);
  var cached = await cache.match(request);
  if (cached) return cached;
  var response = await fetch(request);
  if (isCacheable(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  var cache = await caches.open(CACHE_NAME);
  try {
    var response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    var cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', function (event) {
  if (!STAMPED) return;
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.endsWith('pwa_catalog.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

// Ren'Py's engine sends ["loadCache"] / ["clearCache"] to the controller; keep
// both wired so an engine update that calls them keeps working.
self.addEventListener('message', function (event) {
  var data = event.data || [];
  if (data[0] === 'clearCache') {
    event.waitUntil(caches.delete(CACHE_NAME));
  } else if (data[0] === 'loadCache' && STAMPED) {
    event.waitUntil(precache());
  }
});
