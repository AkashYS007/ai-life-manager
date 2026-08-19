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
//
// v2 (2026-08-17): page navigations (HTML document requests) now use
// network-first instead of stale-while-revalidate. Root cause of a real
// bug: this cache is keyed only by URL, with no awareness of cookies or
// auth state, so a page like /today — cached once from a genuine signed-in
// visit — was being served straight from the cache for every later
// request to that exact URL, authenticated or not, without ever reaching
// the server (or its Clerk middleware). See middleware.ts's comment for
// the full investigation. Non-navigation requests (JS/CSS/icons/manifest —
// static, not per-user) keep the original stale-while-revalidate strategy,
// since instant-from-cache is fine for those. Cache name bumped so the
// activate handler's existing cleanup (below) evicts any stale v1 entries
// still holding a bypassed page from before this fix.
// v3 (2026-08-19): cache name bumped again. Root cause of a real bug: the
// new app logo replaced icon-192.png/icon-512.png/apple-touch-icon.png's
// *content* at the same URLs (stale-while-revalidate below is keyed only
// by URL), so any client that had already cached the old icons kept
// serving them straight from cache — a background revalidation fetch only
// happens if that URL is actually requested again, which browsers don't
// reliably do for favicons/manifest icons on their own. Bumping
// CACHE_NAME forces the activate handler's existing cleanup (below) to
// evict every old entry, so the new icons are guaranteed to be fetched
// fresh from the network on next load, regardless of what was cached
// before. (A device's *home-screen* icon, if the PWA was already
// installed via "Add to Home Screen," is a separate OS-level snapshot
// this cache bump can't touch — that only refreshes when Chrome's
// periodic WebAPK update check runs, or the user removes and re-adds it.)
const CACHE_NAME = 'ailm-shell-v3';

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

  // Page navigations (the actual document load, e.g. GET /today): always
  // go to the network first. This is the request Clerk's middleware runs
  // against, and auth state can change between visits (sign in, sign out,
  // session expiry) — serving a cached copy without asking the network
  // would silently skip that check every time, which is exactly the real
  // bug this fixes. Only fall back to whatever's cached if the network is
  // genuinely unreachable (offline), which is the actual case this
  // fallback exists for.
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, toCache));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(request))),
    );
    return;
  }

  // Everything else (JS/CSS/icons/manifest) — static, not per-user, so
  // stale-while-revalidate is fine: serve the cached copy immediately if
  // one exists (fast, and works offline), while always trying the network
  // in the background to keep the cache fresh for next time.
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
//
// Voice notifications increment (2026-08-19): also broadcasts the same
// payload to every open client via postMessage, alongside showing the OS
// notification (never instead of it — a foreground tab should still get
// the visual banner, same as before). This is the only hook available for
// getting a push event's data into page-context JS at all: the `push`
// event fires on the service worker, a completely separate execution
// context from any open tab's own JS (where the Web Speech API actually
// lives — see VoiceNotifications.tsx), so without this postMessage relay
// an open tab would have no way to know a push just arrived, let alone
// read it aloud. Fire-and-forget on purpose: if no client is currently
// open, matchAll() just resolves to an empty list and this is a no-op —
// the showNotification() call above is what still reaches a closed app.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // Alarm-like delivery increment: a genuine alarm (loud sound that
        // overrides silent/DND, rings until dismissed) needs OS-level alarm
        // permissions — AlarmManager + a full-screen intent on Android, the
        // kind only a native app can request. A web push notification has
        // no access to that channel at all, no matter what's set here; this
        // is the closest a PWA can get. `vibrate` asks the device to buzz
        // in this on/off pattern (already not `silent: true`, so the
        // device's normal notification sound was already playing — this
        // adds the physical buzz most people actually notice break/water
        // reminders by). `requireInteraction: true` asks supporting
        // platforms (mainly desktop Chrome) to keep the notification on
        // screen until the person dismisses it instead of auto-hiding after
        // a few seconds — Android's own notification shade already behaves
        // this way regardless, so this mostly helps desktop users.
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
        data: { deeplink: payload.deeplink || '/today' },
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'ailm-push', payload }));
      }),
    ]),
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
