import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signOAuthState, verifyOAuthState, OAuthStatePayload } from '../oauth-state';

interface MicrosoftTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

// Mirrors google-oauth.service.ts's shape and reasoning closely (plain
// fetch against Microsoft's own OAuth endpoints, no SDK) — the two
// providers' OAuth 2.0 authorization-code flows are similar enough that
// keeping the two files structurally parallel makes the codebase easier to
// hold in your head, even though the actual endpoints/scopes differ.
@Injectable()
export class MicrosoftOAuthService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!(
      this.config.get('MICROSOFT_CLIENT_ID') &&
      this.config.get('MICROSOFT_CLIENT_SECRET') &&
      this.config.get('MICROSOFT_REDIRECT_URI') &&
      this.config.get('TOKEN_ENCRYPTION_KEY') &&
      this.config.get('OAUTH_STATE_SECRET')
    );
  }

  buildAuthUrl(userId: string, returnTo?: string): string {
    const state = signOAuthState(userId, this.config.get<string>('OAUTH_STATE_SECRET')!, returnTo);
    const params = new URLSearchParams({
      client_id: this.config.get<string>('MICROSOFT_CLIENT_ID')!,
      redirect_uri: this.config.get<string>('MICROSOFT_REDIRECT_URI')!,
      response_type: 'code',
      response_mode: 'query',
      // Calendars.ReadWrite — widened from the original Calendars.Read once
      // push-deletes-back needed real write access, same reasoning and same
      // sequencing as Google's calendar.readonly → calendar.events widening
      // (see google-oauth.service.ts): any account connected before this
      // change only has read access and needs a real reconnect to pick up
      // write access, which is why `prompt: 'consent'` below is not
      // optional — it's what forces a fresh consent screen (and therefore a
      // fresh scope grant) even for someone who already connected once.
      // offline_access is for a refresh token (without it, the connection
      // would silently die after roughly an hour with no way to renew it);
      // User.Read looks up the account's email for display. "common" as the
      // tenant below accepts both personal Microsoft accounts and
      // work/school (Office 365) accounts, since a personal-use app
      // shouldn't assume which one someone has.
      scope: 'offline_access Calendars.ReadWrite User.Read',
      prompt: 'consent', // guarantees a refresh_token even on a reconnect, same as Google's prompt=consent
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  verifyState(state: string): OAuthStatePayload {
    return verifyOAuthState(state, this.config.get<string>('OAUTH_STATE_SECRET')!);
  }

  async exchangeCodeForTokens(code: string): Promise<MicrosoftTokens> {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('MICROSOFT_CLIENT_ID')!,
        client_secret: this.config.get<string>('MICROSOFT_CLIENT_SECRET')!,
        redirect_uri: this.config.get<string>('MICROSOFT_REDIRECT_URI')!,
        grant_type: 'authorization_code',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      }),
    });
    if (!res.ok) {
      throw new Error(`Microsoft token exchange failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as any;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<MicrosoftTokens> {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.get<string>('MICROSOFT_CLIENT_ID')!,
        client_secret: this.config.get<string>('MICROSOFT_CLIENT_SECRET')!,
        grant_type: 'refresh_token',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      }),
    });
    if (!res.ok) {
      throw new Error(`Microsoft token refresh failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as any;
    // Microsoft rotates the refresh token on every use (unlike Google,
    // which only issues a new one occasionally) — the caller must persist
    // this new one or the next refresh will fail with an already-used token.
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
    };
  }

  async fetchAccountEmail(accessToken: string): Promise<string | undefined> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as any;
    // Personal Microsoft accounts populate `mail`; work/school (Office 365)
    // accounts sometimes leave `mail` null and only populate
    // `userPrincipalName` — falling back covers both.
    return body.mail ?? body.userPrincipalName;
  }
}
