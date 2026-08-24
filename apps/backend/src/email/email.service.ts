import { Injectable, Logger } from '@nestjs/common';
import { withRetry, DeliveryHttpError, isRetryableHttpError } from '../common/retry';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

// Real notification delivery increment. Plain `fetch` against Resend's REST
// API (https://api.resend.com/emails) rather than the `resend` npm SDK —
// one endpoint, one header, one JSON body; a whole dependency buys nothing
// here that four lines of fetch don't already give, the same "small
// purpose-built solution over a library for a narrow need" call already
// made for the Apple CalDAV/ICS parser and the Insights SVG charts.
// Best-effort/no-op when RESEND_API_KEY is unset, mirroring
// AnthropicClient's own "not configured" degradation pattern exactly.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | undefined;
  private readonly fromAddress: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.fromAddress = process.env.EMAIL_FROM_ADDRESS ?? 'AI Life Manager <notifications@example.com>';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // Best-effort, single recipient — a failed send must never break whatever
  // real action triggered this notification (same principle WebPushService
  // and every other best-effort side effect in this codebase already
  // follows). Never throws.
  async send(payload: EmailPayload): Promise<void> {
    if (!this.apiKey) return;

    try {
      // Delivery retry increment (backend review follow-up, 2026-08-24 —
      // see common/retry.ts's own comment). 3 attempts total, ~500ms/
      // ~1000ms backoff. `isRetryableHttpError` only retries a 5xx (or a
      // thrown network error, e.g. a DNS/connect failure, which arrives as
      // some other Error and is retried by withRetry's default
      // always-retry behavior) — a 4xx means the request itself was wrong
      // (bad recipient, bad auth) and three tries would just fail the same
      // way three times.
      await withRetry(
        async () => {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: this.fromAddress,
              to: [payload.to],
              subject: payload.subject,
              text: payload.body,
            }),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new DeliveryHttpError(`Resend send failed (${response.status}): ${text}`, response.status);
          }
        },
        { attempts: 3, baseDelayMs: 500, shouldRetry: isRetryableHttpError },
      );
    } catch (error) {
      this.logger.warn(`Resend send failed: ${(error as Error).message}`);
    }
  }
}
