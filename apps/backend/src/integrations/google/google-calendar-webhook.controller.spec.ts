import { GoogleCalendarWebhookController } from './google-calendar-webhook.controller';

// Real-time calendar updates (webhooks) increment. Constructed directly as
// a plain class (no Nest TestingModule, no Prisma) — same "no Prisma, no
// Nest bootstrap, mock only what this class actually talks to" approach as
// users.service.spec.ts's own PrismaService mock, just with the whole
// CalendarAccountsService mocked instead of one layer down at Prisma, since
// this controller's own logic (the early-return branches below) never
// touches Prisma directly itself.
describe('GoogleCalendarWebhookController', () => {
  function build() {
    const calendarAccounts = { syncByChannel: jest.fn().mockResolvedValue(undefined) };
    const controller = new GoogleCalendarWebhookController(calendarAccounts as any);
    return { controller, calendarAccounts };
  }

  it('acknowledges without syncing when resourceState is "sync" (the initial handshake, not a real change)', async () => {
    const { controller, calendarAccounts } = build();
    const result = await controller.handleNotification('chan-1', 'r-1', 'sync', 'tok-1');
    expect(result).toEqual({ received: true });
    expect(calendarAccounts.syncByChannel).not.toHaveBeenCalled();
  });

  it('acknowledges without syncing when any required header is missing', async () => {
    const { controller, calendarAccounts } = build();
    await controller.handleNotification(undefined, 'r-1', 'exists', 'tok-1');
    await controller.handleNotification('chan-1', undefined, 'exists', 'tok-1');
    await controller.handleNotification('chan-1', 'r-1', 'exists', undefined);
    expect(calendarAccounts.syncByChannel).not.toHaveBeenCalled();
  });

  it('delegates to syncByChannel with the exact header values for a real change notification', async () => {
    const { controller, calendarAccounts } = build();
    const result = await controller.handleNotification('chan-1', 'r-1', 'exists', 'tok-1');
    expect(result).toEqual({ received: true });
    expect(calendarAccounts.syncByChannel).toHaveBeenCalledWith('chan-1', 'r-1', 'tok-1');
  });

  it('still acknowledges with 200 even if syncByChannel itself throws — a missed real-time push must never surface as an error to Google', async () => {
    const { controller, calendarAccounts } = build();
    calendarAccounts.syncByChannel.mockRejectedValue(new Error('boom'));
    const result = await controller.handleNotification('chan-1', 'r-1', 'exists', 'tok-1');
    expect(result).toEqual({ received: true });
  });
});
