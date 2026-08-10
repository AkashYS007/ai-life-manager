// PWA + offline support increment. Hand-rolled rather than a bundler
// plugin (no next-pwa/workbox dependency added) — same "small hand-rolled
// solution over a library for a narrow, well-understood need" judgment
// call this project already made for its Apple CalDAV/ICS parser and its
// Insights SVG charts. A runtime cache (no build-time precache manifest of
// Next.js's hashed asset filenames — this app has no bundler plugin
// generating one) that fills in as pages are actually visited: the first
// online visit to a route caches it, so a later offline visit to that same
// route can still load.
//
// Deliberately does NOT intercept POST requests (GraphQL always POSTs to
// one /graphql endpoint) — offline *data* availability is handled by
// Apollo's own persisted cache (see lib/apollo-client.ts), not by trying to
// cache a POST response here, which the Cache API can't key sensibly by
// request body anyway. This service worker's only job is making the app
// *shell itself* (HTML/JS/CSS/icons) load with no network.
const CACHE_NAME = 'ailm-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle same-origin GET requests — anything else (the
  // GraphQL POST, third-party requests, non-GET) passes straight through
  // to the network exactly as if this service worker didn't exist.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Stale-while-revalidate: serve the cached copy immediately if one
  // exists (fast, and works offline), while always trying the network in
  // the background to keep the cache fresh for next time. A network
  // failure (offline) is simply swallowed — the cached response (if any)
  // already answered the request; if there was none, the browser's normal
  // offline error is what the person sees, same as any uncached page.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    ),
  );
});

// Real notification delivery increment. The payload is exactly the
// `{ title, body, deeplink }` shape WebPushService.sendToUser sends
// (backend/src/push/web-push.service.ts) — kept deliberately identical to
// the in-app Notification shape so one payload works for both surfaces.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { deeplink: payload.deeplink || '/today' },
    }),
  );
});

// Focuses an already-open tab on the right page if one exists, rather than
// always opening a new one — the same "don't pile up duplicate tabs"
// behavior people expect from every other notification-driven app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deeplink = (event.notification.data && event.notification.data.deeplink) || '/today';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(deeplink) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.length > 0 && 'focus' in clients[0]) {
        clients[0].navigate(deeplink);
        return clients[0].focus();
      }
      return self.clients.openWindow(deeplink);
    }),
  );
});
