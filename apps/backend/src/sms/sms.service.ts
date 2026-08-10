import { Injectable, Logger } from '@nestjs/common';

interface SmsPayload {
  to: string;
  body: string;
}

// SMS delivery increment. Plain `fetch` against Twilio's REST API
// (https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json) rather
// than the `twilio` npm SDK — one endpoint, Basic Auth, one form-encoded
// body; same "small purpose-built solution over a library for a narrow
// need" call EmailService already made for Resend (see that file's own
// comment), and this is an even narrower need than email — SMS has no
// subject, no HTML, no attachments, just a phone number and a body.
// Best-effort/no-op when any of the three required env vars is unset,
// mirroring EmailService's own "not configured" degradation exactly.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly fromNumber: string | undefined;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_FROM_NUMBER;
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  // Best-effort, single recipient — a failed send must never break whatever
  // real action triggered this notification (same principle EmailService
  // and WebPushService already follow). Never throws. `body` is expected to
  // already be the full message text (NotificationsService combines a
  // notification's title/body into one plain string before calling this —
  // unlike email, SMS has no separate subject line to carry the title in).
  async send(payload: SmsPayload): Promise<void> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) return;

    try {
      const form = new URLSearchParams({
        To: payload.to,
        From: this.fromNumber,
        Body: payload.body,
      });

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            // Basic Auth per Twilio's own API convention — AccountSid as the
            // username, AuthToken as the password, exactly as their docs
            // specify (no OAuth, no bearer token for this API).
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(`Twilio send failed (${response.status}): ${text}`);
      }
    } catch (error) {
      this.logger.warn(`Twilio send threw: ${(error as Error).message}`);
    }
  }
}
