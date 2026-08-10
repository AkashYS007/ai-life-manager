import { GoogleCalendarClient } from './google-calendar-client';

// Real-time calendar updates (webhooks) increment. Pure unit tests, same
// "no Prisma, no Nest TestingModule, mock the network boundary only"
// approach oauth-state.spec.ts already established for this session's other
// genuinely-runnable-without-Postgres tests — GoogleCalendarClient takes no
// constructor dependencies at all, so `global.fetch` is the only thing that
// needs mocking. Kept in its own file (rather than added to a pre-existing
// google-calendar-client.spec.ts, which doesn't exist yet) since this
// increment is the first to add real unit coverage for this class.
describe('GoogleCalendarClient — webhook methods', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('watchEvents', () => {
    it('POSTs the expected channel registration body and returns the resourceId/expiration Google sends back', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ resourceId: 'r-123', expiration: '1700000000000' }),
      });
      global.fetch = fetchMock as any;

      const client = new GoogleCalendarClient();
      const result = await client.watchEvents({
        accessToken: 'token-abc',
        channelId: 'chan-1',
        address: 'https://example.com/webhooks/google/calendar',
        token: 'verify-xyz',
      });

      expect(result).toEqual({ resourceId: 'r-123', expiration: '1700000000000' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/watch');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer token-abc');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        id: 'chan-1',
        type: 'web_hook',
        address: 'https://example.com/webhooks/google/calendar',
        token: 'verify-xyz',
      });
    });

    it('throws with the response status and body when Google rejects the watch request', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid channel id',
      }) as any;

      const client = new GoogleCalendarClient();
      await expect(
        client.watchEvents({ accessToken: 't', channelId: 'c', address: 'https://example.com/x', token: 'tok' }),
      ).rejects.toThrow('Google Calendar events.watch failed: 400 Invalid channel id');
    });
  });

  describe('stopChannel', () => {
    it('POSTs the channel/resource id to the channels.stop endpoint', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
      global.fetch = fetchMock as any;

      const client = new GoogleCalendarClient();
      await client.stopChannel({ accessToken: 'token-abc', channelId: 'chan-1', resourceId: 'r-123' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/channels/stop');
      expect(JSON.parse(init.body)).toEqual({ id: 'chan-1', resourceId: 'r-123' });
    });

    it('treats a 404 (channel already gone) as success, not an error', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }) as any;

      const client = new GoogleCalendarClient();
      await expect(
        client.stopChannel({ accessToken: 't', channelId: 'c', resourceId: 'r' }),
      ).resolves.toBeUndefined();
    });

    it('throws on a real failure (e.g. 401)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as any;

      const client = new GoogleCalendarClient();
      await expect(
        client.stopChannel({ accessToken: 't', channelId: 'c', resourceId: 'r' }),
      ).rejects.toThrow('Google Calendar channels.stop failed: 401 unauthorized');
    });
  });
});
