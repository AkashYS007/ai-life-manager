import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

// AUTH_MODE=dev (local/sandbox): no Clerk session exists, so this is a
// plain passthrough — matching the backend's dev-auth bypass
// (apps/backend/src/auth/auth.guard.ts).
//
// AUTH_MODE=clerk (production/real auth): wraps every non-static request in
// Clerk's clerkMiddleware(), which populates the session used by the
// `auth()` helper in server components and by <SignedIn>/<SignedOut> guards.
// Public routes (marketing/sign-in/sign-up) are explicitly excluded from the
// redirect-to-sign-in behavior; everything else requires a signed-in user.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health(.*)',
  '/privacy(.*)',
  '/terms(.*)',
]);

const devPassthrough = (_req: NextRequest) => NextResponse.next();

// RESOLVED (2026-08-17): this middleware itself is correct and was never
// the problem. What looked like a per-request auth-bypass bug (an
// unauthenticated visit to a protected route like /today sometimes loading
// the page instead of redirecting to sign-in) is actually caused entirely
// client-side, by this app's own service worker (public/sw.js). Its
// stale-while-revalidate fetch handler caches every same-origin GET
// response that returns 200 — including full HTML page loads — keyed only
// by URL, with no awareness of cookies or auth state. Once a route like
// /today (the default landing page, visited constantly) has ever been
// cached from a real signed-in visit, the service worker serves that
// cached copy directly for every future request to that exact URL,
// regardless of whether the request is authenticated — the request never
// reaches this server or this middleware at all. Confirmed directly: (1) a
// brand-new incognito window (empty cache) correctly redirects to sign-in
// every time; (2) adding a throwaway query string to the URL — a guaranteed
// cache miss — also correctly redirects; (3) live middleware logging
// showed isPublicRoute/auth.protect() behaving correctly for every request
// that actually reached this file. Real impact is low, not zero: the
// cached HTML itself carries no personal data (this page renders
// client-side via GraphQL, and the backend's own AuthGuard independently
// verifies every real data request via Clerk's JWKS regardless of this
// middleware), but on a shared device a stale cached page shell could
// briefly render before the network catches up, and the sign-in redirect
// can't be relied on for a returning visitor with a stale cache. If this
// needs a real fix, it belongs in sw.js's fetch handler (e.g. skip caching
// navigation/HTML requests, or don't serve a cached page without
// revalidating first) — not here.
const clerkProtected = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    // v6 API: `.protect()` lives directly on the `auth` export/param now,
    // not on the object returned by calling `auth()` — see the v6 upgrade
    // guide's "auth().protect() is now auth.protect()" section. Upgraded
    // from v5.7.6 (the last v5 patch Clerk ever shipped) specifically to
    // pick up dev-instance session-sync fixes; this middleware.ts and its
    // v5-era `auth().protect()` call is the only server-side `auth()` usage
    // in this app (everything else under src/ is client-side SignIn/SignUp/
    // ClerkProvider/useAuth/useClerk, none of which are affected by this
    // async-auth() breaking change).
    await auth.protect();
  }
});

export default process.env.NEXT_PUBLIC_AUTH_MODE === 'clerk'
  ? clerkProtected
  : devPassthrough;

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
