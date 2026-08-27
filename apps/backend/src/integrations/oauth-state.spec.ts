import { createHmac } from 'crypto';
import { signOAuthState, verifyOAuthState, peekReturnTo } from './oauth-state';

describe('oauth-state', () => {
  const secret = 'a-dev-only-state-secret';

  it('round-trips a userId through sign and verify', () => {
    const state = signOAuthState('user-123', secret);
    expect(verifyOAuthState(state, secret).userId).toBe('user-123');
  });

  it('round-trips a userId and returnTo through sign and verify', () => {
    const state = signOAuthState('user-123', secret, 'onboarding');
    const result = verifyOAuthState(state, secret);
    expect(result.userId).toBe('user-123');
    expect(result.returnTo).toBe('onboarding');
  });

  it('returnTo is undefined when not passed to signOAuthState', () => {
    const state = signOAuthState('user-123', secret);
    expect(verifyOAuthState(state, secret).returnTo).toBeUndefined();
  });

  it('rejects a state signed with a different secret', () => {
    const state = signOAuthState('user-123', 'a-different-secret');
    expect(() => verifyOAuthState(state, secret)).toThrow();
  });

  it('rejects a tampered payload even if the signature format still looks valid', () => {
    const state = signOAuthState('user-123', secret);
    const [payload, signature] = state.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 'someone-else', issuedAt: Date.now() })).toString(
      'base64url',
    );
    expect(() => verifyOAuthState(`${forgedPayload}.${signature}`, secret)).toThrow();
    void payload;
  });

  it('rejects an expired state', () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ userId: 'user-123', issuedAt: elevenMinutesAgo })).toString(
      'base64url',
    );
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(() => verifyOAuthState(`${payload}.${signature}`, secret)).toThrow('expired');
  });

  // Fix onboarding calendar-connect redirect increment: peekReturnTo is the
  // non-verifying half used only to pick a redirect destination on an
  // unsuccessful callback (see google-oauth.controller.ts/
  // microsoft-oauth.controller.ts) — these tests cover its own, separate
  // contract: never throws, and doesn't require (or check) a valid
  // signature, unlike everything above.
  describe('peekReturnTo', () => {
    it('reads returnTo out of a validly-signed state without needing the secret', () => {
      const state = signOAuthState('user-123', secret, 'onboarding');
      expect(peekReturnTo(state)).toBe('onboarding');
    });

    it('returns undefined for a state with no returnTo', () => {
      const state = signOAuthState('user-123', secret);
      expect(peekReturnTo(state)).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(peekReturnTo(undefined)).toBeUndefined();
    });

    it('returns undefined for a malformed state instead of throwing', () => {
      expect(peekReturnTo('not-a-real-state')).toBeUndefined();
      expect(peekReturnTo('')).toBeUndefined();
      expect(peekReturnTo('...')).toBeUndefined();
    });

    it('still reads returnTo even from a state with a forged/invalid signature', () => {
      // Deliberate: peekReturnTo never checks the signature, since its only
      // job is picking one of two known redirect targets — see its own
      // comment in oauth-state.ts for why that's an acceptable trade-off.
      const payload = Buffer.from(
        JSON.stringify({ userId: 'someone-else', issuedAt: Date.now(), returnTo: 'onboarding' }),
      ).toString('base64url');
      expect(peekReturnTo(`${payload}.not-a-real-signature`)).toBe('onboarding');
    });
  });
});
