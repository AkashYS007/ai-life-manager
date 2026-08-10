import { MicrosoftCalendarClient } from './microsoft-calendar-client';

// Real-time calendar updates (webhooks) increment. Same pure, no-Prisma,
// mock-the-network-boundary-only approach as
// google-calendar-client.webhook.spec.ts right next to this file — see that
// file's own comment.
describe('MicrosoftCalendarClient — webhook methods', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('createSubscription', () => {
    it('POSTs the expected subscription body and returns the id/expiration Graph sends back', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sub-1', expirationDateTime: '2026-08-11T00:00:00.000Z' }),
      });
      global.fetch = fetchMock as any;

      const client = new MicrosoftCalendarClient();
      const result = await client.createSubscription({
        accessToken: 'token-abc',
        notificationUrl: 'https://example.com/webhooks/microsoft/calendar',
        clientState: 'secret-xyz',
        expirationDateTime: '2026-08-11T00:00:00.000Z',
      });

      expect(result).toEqual({ subscriptionId: 'sub-1', expirationDateTime: '2026-08-11T00:00:00.000Z' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        changeType: 'created,updated,deleted',
        notificationUrl: 'https://example.com/webhooks/microsoft/calendar',
        resource: '/me/events',
        expirationDateTime: '2026-08-11T00:00:00.000Z',
        clientState: 'secret-xyz',
      });
    });

    it('throws with the response status and body when Graph rejects the subscription (e.g. failed validation handshake)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Subscription validation request failed.',
      }) as any;

      const client = new MicrosoftCalendarClient();
      await expect(
        client.createSubscription({
          accessToken: 't',
          notificationUrl: 'https://example.com/x',
          clientState: 's',
          expirationDateTime: '2026-08-11T00:00:00.000Z',
        }),
      ).rejects.toThrow('Microsoft Graph subscriptions.create failed: 400 Subscription validation request failed.');
    });
  });

  describe('renewSubscription', () => {
    it('PATCHes the new expiration to the subscription-specific URL', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ expirationDateTime: '2026-08-14T00:00:00.000Z' }),
      });
      global.fetch = fetchMock as any;

      const client = new MicrosoftCalendarClient();
      const result = await client.renewSubscription({
        accessToken: 'token-abc',
        subscriptionId: 'sub-1',
        expirationDateTime: '2026-08-14T00:00:00.000Z',
      });

      expect(result).toEqual({ expirationDateTime: '2026-08-14T00:00:00.000Z' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions/sub-1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ expirationDateTime: '2026-08-14T00:00:00.000Z' });
    });
  });

  describe('deleteSubscription', () => {
    it('DELETEs the subscription-specific URL', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
      global.fetch = fetchMock as any;

      const client = new MicrosoftCalendarClient();
      await client.deleteSubscription({ accessToken: 'token-abc', subscriptionId: 'sub-1' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions/sub-1');
      expect(init.method).toBe('DELETE');
    });

    it('treats a 404 (subscription already gone) as success, not an error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }) as any;

      const client = new MicrosoftCalendarClient();
      await expect(
        client.deleteSubscription({ accessToken: 't', subscriptionId: 'sub-1' }),
      ).resolves.toBeUndefined();
    });
  });
});
