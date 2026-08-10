import { ApolloClient, InMemoryCache, createHttpLink, from, split } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient as createWsClient } from 'graphql-ws';
import { persistCache, LocalStorageWrapper } from 'apollo3-cache-persist';

// Two auth strategies, mirroring the backend's AuthGuard exactly (see
// apps/backend/src/auth/auth.guard.ts): in AUTH_MODE=dev we send the
// x-dev-user-email header the guard expects; otherwise we attach the real
// Clerk session token. `getClerkToken` is injected from a client component
// that has access to Clerk's useAuth() hook, since this module itself is a
// plain (non-React) singleton.
const httpLink = createHttpLink({ uri: process.env.NEXT_PUBLIC_API_URL });

// Real-time chat streaming increment: the same two-strategy header
// resolution the HTTP authLink below already did, pulled into its own
// function so the new WebSocket link can build the exact same headers
// without duplicating the logic a second time — mirrors the backend's own
// resolveAuthContext refactor (see apps/backend/src/auth/
// resolve-auth-context.ts), just on the client side of the same boundary.
async function resolveAuthHeaders(): Promise<Record<string, string>> {
  if (process.env.NEXT_PUBLIC_AUTH_MODE === 'dev') {
    return { 'x-dev-user-email': process.env.NEXT_PUBLIC_DEV_USER_EMAIL ?? 'akash@example.com' };
  }
  const token = getClerkToken ? await getClerkToken() : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

let getClerkToken: (() => Promise<string | null>) | null = null;
export function registerClerkTokenGetter(fn: () => Promise<string | null>) {
  getClerkToken = fn;
}

// Account deletion increment: same "inject a Clerk hook result into this
// plain non-React module" pattern as registerClerkTokenGetter above — a
// client component that only mounts when !isDevAuth (see Providers.tsx's
// ClerkSignOutBridge) registers Clerk's real signOut() here so the Settings
// page can call a plain function without needing to invoke a Clerk hook
// itself (Settings renders regardless of auth mode, and calling a Clerk hook
// outside <ClerkProvider> — which AUTH_MODE=dev never mounts — would throw).
let clerkSignOut: (() => Promise<void>) | null = null;
export function registerClerkSignOut(fn: () => Promise<void>) {
  clerkSignOut = fn;
}
// No-ops under AUTH_MODE=dev, where there's no real session to end — the
// caller (Settings page) still clears the local Apollo cache and redirects
// either way.
export async function runClerkSignOutIfAvailable(): Promise<void> {
  if (clerkSignOut) {
    await clerkSignOut();
  }
}

// Editable email increment: same bridge pattern again — Clerk's real
// `openUserProfile()` opens its own hosted account-management modal
// (email, password, connected accounts, all handled by Clerk itself, with
// real verification this app has no way to do on its own), registered from
// a component that only mounts when !isDevAuth. Returns whether a real
// Clerk session was available to open it against — the Settings page uses
// this to decide whether to show a real "Change email" button at all,
// versus explanatory-only text under AUTH_MODE=dev.
let clerkOpenUserProfile: (() => void) | null = null;
export function registerClerkOpenUserProfile(fn: () => void) {
  clerkOpenUserProfile = fn;
}
export function isClerkUserProfileAvailable(): boolean {
  return clerkOpenUserProfile !== null;
}
export function openClerkUserProfile(): void {
  clerkOpenUserProfile?.();
}

const authLink = setContext(async (_, { headers }) => ({
  headers: { ...headers, ...(await resolveAuthHeaders()) },
}));

// Real-time chat streaming increment: a genuine WebSocket link, only ever
// used for `subscription` operations (see the `split()` below) — every
// query/mutation, including the plain sendChatMessage this whole feature
// is additive on top of, still goes through the exact same httpLink as
// before. `wsUrl` is derived from the same NEXT_PUBLIC_API_URL already
// used for HTTP (http→ws / https→wss, same host/port/path) rather than a
// second env var to keep in sync — the backend mounts its graphql-ws
// server on that exact same `/graphql` path (see app.module.ts), not a
// separate one. `lazy: true` (graphql-ws's default) means this socket is
// only actually opened the first time something subscribes — a person who
// never opens Chat never pays for an idle WebSocket connection at all.
const wsUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/^http/, 'ws');
const wsLink =
  typeof window !== 'undefined'
    ? new GraphQLWsLink(
        createWsClient({
          url: wsUrl,
          // Same two-strategy headers as the HTTP authLink above, just
          // handed to the socket at connect time instead of per-request —
          // read by the backend's own onConnect (app.module.ts), which
          // expects these exact same key names.
          connectionParams: async () => resolveAuthHeaders(),
        }),
      )
    : null;

// Routes by operation kind, once, at the very top-level link (see
// `apolloClient` below): a subscription goes over the WebSocket link,
// everything else (every existing query/mutation, unchanged) keeps going
// through authLink + httpLink exactly as before this increment. `wsLink`
// being null during server-side rendering (no real browser, no WebSocket)
// is fine — nothing subscribes during SSR in this app, so that branch is
// simply never reached there.
function isSubscriptionOperation({ query }: { query: import('graphql').DocumentNode }): boolean {
  const definition = getMainDefinition(query);
  return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
}

// PWA + offline support increment: the same InMemoryCache every query and
// mutation already reads/writes through, just persisted to localStorage so
// whatever's already been fetched (today's plan, tasks, journal entries —
// the exact three views the PRD names as needing to work offline) survives
// a full page reload with no network at all, not just a client-side route
// change within one still-open tab. `cache` is a separate export (not just
// buried inside `apolloClient`) purely so `initCachePersistence` below can
// be called with it before this module's `apolloClient` is ever used.
export const cache = new InMemoryCache();

// Deliberately localStorage (via LocalStorageWrapper), not IndexedDB — the
// simplest version that satisfies "the data already fetched survives a
// reload," same "simple version first" judgment call as this project's
// other increments. A known, documented ceiling: localStorage caps out
// around 5-10MB per origin in most browsers, which is comfortably enough
// for one person's Apollo cache but would need switching to
// `IndexedDBWrapper` if that ever became a real constraint.
let persistencePromise: Promise<void> | null = null;
export function initCachePersistence(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!persistencePromise) {
    persistencePromise = persistCache({
      cache,
      storage: new LocalStorageWrapper(window.localStorage),
    }).catch(() => {
      // Best-effort — a browser with localStorage disabled/full still gets
      // a fully working app, just without offline data persistence across
      // reloads (in-memory-only for that session, same as before this
      // increment existed).
    });
  }
  return persistencePromise;
}

export const apolloClient = new ApolloClient({
  // authLink only ever attaches to the HTTP half — wsLink authenticates
  // itself independently via connectionParams at connect time (above), so
  // running a subscription through authLink too would be a no-op at best
  // (there's no HTTP request for it to attach a header to). Falls back to
  // plain httpLink-only if wsLink couldn't be created (server-side
  // rendering) — a subscription attempted there would simply fail loudly
  // rather than silently hang, which is the right failure mode for
  // something that should never actually be attempted outside a browser.
  link: split(isSubscriptionOperation, wsLink ?? httpLink, from([authLink, httpLink])),
  cache,
});
