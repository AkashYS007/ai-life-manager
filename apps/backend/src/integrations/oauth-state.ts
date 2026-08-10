import { createHmac, timingSafeEqual } from 'crypto';

// Signed, expiring `state` param for the OAuth redirect round-trip. Google's
// callback hits a plain, unauthenticated REST endpoint (no session header
// comes back with it), so we cannot trust a client-supplied user id there —
// the same ownership-scoping discipline as everywhere else in this app,
// just applied to a redirect instead of a GraphQL resolver. Stateless
// (HMAC over userId + issued-at) rather than a DB-backed pending-connection
// table, since the round trip is a single interactive flow measured in
// seconds, not something that needs to survive a server restart.
const MAX_AGE_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  userId: string;
  // Fix onboarding calendar-connect redirect increment: an optional hint
  // for which page started this flow, so the callback controller can send
  // the browser back to where it actually came from instead of always
  // `/calendar`. Deliberately a plain string, not a URL — the controller
  // only ever recognizes the literal value `'onboarding'` and falls back to
  // `/calendar` for anything else (see google-oauth.controller.ts's own
  // comment), so there's no open-redirect surface here even though this
  // value round-trips through a client-supplied GraphQL argument upstream.
  returnTo?: string;
}

export function signOAuthState(userId: string, secret: string, returnTo?: string): string {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({ userId, issuedAt, returnTo })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string, secret: string): OAuthStatePayload {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) {
    throw new Error('Malformed OAuth state');
  }

  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error('OAuth state signature mismatch — possible tampering');
  }

  const { userId, issuedAt, returnTo } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (Date.now() - issuedAt > MAX_AGE_MS) {
    throw new Error('OAuth state expired — restart the connection flow');
  }

  return { userId, returnTo };
}

// Fix onboarding calendar-connect redirect increment: a deliberately
// non-throwing peek at `returnTo` alone, used only to choose which page an
// *unsuccessful* callback (missing code, provider-reported error, expired/
// malformed state) redirects back to. Provider callbacks echo the original
// `state` back even when the person denied consent, so there's real value
// in reading it — but the whole point of this path is to handle exactly
// the states `verifyOAuthState` would throw on, so it can't reuse that
// function. Never trusted for anything security-sensitive (no `userId` is
// even returned here) — worst case a forged/expired state picks the wrong
// of two known, harmless redirect targets, not a real vulnerability.
export function peekReturnTo(state: string | undefined): string | undefined {
  if (!state) return undefined;
  try {
    const [payload] = state.split('.');
    if (!payload) return undefined;
    const { returnTo } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof returnTo === 'string' ? returnTo : undefined;
  } catch {
    return undefined;
  }
}
