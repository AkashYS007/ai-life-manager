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
]);

const devPassthrough = (_req: NextRequest) => NextResponse.next();

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
