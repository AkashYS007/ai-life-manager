import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signOAuthState, verifyOAuthState, OAuthStatePayload } from '../oauth-state';

interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

// Talks to Google's own OAuth 2.0 endpoints directly via fetch rather than
// the `googleapis` SDK — that package pulls in every Google API's types and
// clients for what is, here, three plain REST calls (authorize, token
// exchange, token refresh). Standard library `fetch` (Node 18+) is a
// well-tested enough tool for that not to need a dependency.
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!(
      this.config.get('GOOGLE_CLIENT_ID') &&
      this.config.get('GOOGLE_CLIENT_SECRET') &&
      this.config.get('GOOGLE_REDIRECT_URI') &&
      this.config.get('TOKEN_ENCRYPTION_KEY') &&
      this.config.get('OAUTH_STATE_SECRET')
    );
  }

  buildAuthUrl(userId: string, returnTo?: string): string {
    const state = signOAuthState(userId, this.config.get<string>('OAUTH_STATE_SECRET')!, returnTo);
    const params = new URLSearchParams({
      client_id: this.config.get<string>('GOOGLE_CLIENT_ID')!,
      redirect_uri: this.config.get<string>('GOOGLE_REDIRECT_URI')!,
      response_type: 'code',
      // Read-write, events only: the two-way sync increment needs to push
      // deletes (and, later, edits) back to Google, so calendar.readonly is
      // no longer enough. `calendar.events` is still the narrower of the two
      // write-capable scopes Google offers — it grants read/write on events
      // themselves but not on calendar settings/sharing/ACLs, which this app
      // never touches — same "narrowest scope that does the job" reasoning
      // as the original read-only choice. Accounts connected before this
      // change only ever consented to the old readonly scope; `prompt:
      // consent` below forces a fresh consent screen (and a fresh scope
      // grant) on reconnect, but existing connections don't get upgraded
      // automatically — see GoogleCalendarWriteService for how a
      // still-readonly-scoped account is detected and surfaced.
      //
      // `userinfo.email` is added purely so fetchAccountEmail's call to
      // Google's userinfo endpoint succeeds — without it that call 403s and
      // CalendarAccount.externalAccountEmail is silently left null, showing
      // "Unknown account" in the UI forever (caught testing this against a
      // real Google account). It grants no calendar access itself, just
      // read access to the connected account's own email address, purely
      // for display/identification (useful once a user can connect more
      // than one Google account down the line, too).
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent', // guarantees a refresh_token even on a reconnect
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  verifyState(state: string): OAuthStatePayload {
    return verifyOAuthState(state, this.config.get<string>('OAUTH_STATE_SECRET')!);
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('GOOGLE_CLIENT_ID')!,
        client_secret: this.config.get<string>('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: this.config.get<string>('GOOGLE_REDIRECT_URI')!,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as any;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: body.expires_in,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.get<string>('GOOGLE_CLIENT_ID')!,
        client_secret: this.config.get<string>('GOOGLE_CLIENT_SECRET')!,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as any;
    return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
  }

  async fetchAccountEmail(accessToken: string): Promise<string | undefined> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as any;
    return body.email;
  }
}
