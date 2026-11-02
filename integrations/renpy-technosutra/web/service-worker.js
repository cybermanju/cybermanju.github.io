// CyberManju OS — The Stem Array web service worker.
// Role: manages service-worker lifecycle and optional offline asset caching.
// Integrates: Ren’Py Web runtime install, activation, fetch, and client messages.
var cacheName = 'the-stem-array-technosutra-vn';

/* Offline storage is opt-in; the game runs normally without a persistent cache. */
self.addEventListener('install', function (e) {
    console.log('Service worker installed.');
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    return self.clients.claim();
});


/**
 * True if the service worker should add the request to a persistent cache.
 */
let addToCache = false;

/**
 * Keep normal Web requests as pass-through unless a client explicitly enables
 * the optional offline cache with a `loadCache` message.
 */
async function fetchAndCache(request) {
    if (!addToCache) {
        return fetch(request);
    }

    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);


    try {

        if (request.url.endsWith("?cached")) {
            request = new Request(request.url.replace("?cached", "?uncached"), request);
            let rv = await cache.match(request);

            if (rv == null) {
                rv = new Response("Not found in cache.", { status: 404, statusText: "Not found in cache." });
            }

            return rv;
        }

        if (cachedResponse) {
            if (cachedResponse.headers.get('Last-Modified')) {
                request.headers.set('If-Modified-Since', cachedResponse.headers.get('Last-Modified'));
            }
            if (cachedResponse.headers.get('ETag')) {
                request.headers.set('If-None-Match', cachedResponse.headers.get('ETag'));
            }
        }

        const response = await fetch(request);

        if (cachedResponse && response.status == 304) {
            return cachedResponse;
        }

        if (addToCache && response.status == 200) {
            await cache.put(request, response.clone());
        }

        return response;

    } catch (e) {

        if (cachedResponse) {
            console.log('Served from cache: ' + request.url);
            return cachedResponse;
        }

        console.log('Not found in cache: ' + request.url);

        throw e;
    }
}


/* Serve cached content only when optional offline storage is enabled. */
self.addEventListener('fetch', function (e) {
    e.respondWith(fetchAndCache(e.request));
});

self.addEventListener('message', function (e) {
    if (e.data[0] == "clearCache") {
        caches.delete(cacheName);
        console.log("Cache cleared in service worker.");

        addToCache = false;
    } else if (e.data[0] == "loadCache") {
        addToCache = true;
    }
});
