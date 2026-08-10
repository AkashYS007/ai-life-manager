import { MicrosoftCalendarWebhookController } from './microsoft-calendar-webhook.controller';

// Real-time calendar updates (webhooks) increment. Same "constructed
// directly, no Nest TestingModule, no Prisma" approach as
// google-calendar-webhook.controller.spec.ts right next to this file — see
// that file's own comment. `res` is a minimal hand-built fake matching
// Express's own chainable `status().type().send()`/`status().json()` shape,
// just enough for this controller's own two response paths.
describe('MicrosoftCalendarWebhookController', () => {
  function fakeResponse() {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  function build() {
    const microsoftCalendarAccounts = { syncBySubscription: jest.fn().mockResolvedValue(undefined) };
    const controller = new MicrosoftCalendarWebhookController(microsoftCalendarAccounts as any);
    return { controller, microsoftCalendarAccounts };
  }

  it('echoes the validation token back as plain text, unconditionally, before looking at the body at all', async () => {
    const { controller, microsoftCalendarAccounts } = build();
    const res = fakeResponse();

    await controller.handleNotification('the-exact-token-graph-sent', undefined, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('the-exact-token-graph-sent');
    expect(microsoftCalendarAccounts.syncBySubscription).not.toHaveBeenCalled();
  });

  it('processes an empty notification body without error, responding 202', async () => {
    const { controller, microsoftCalendarAccounts } = build();
    const res = fakeResponse();

    await controller.handleNotification(undefined, undefined, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(microsoftCalendarAccounts.syncBySubscription).not.toHaveBeenCalled();
  });

  it('delegates to syncBySubscription for each notification in the batch, skipping any missing subscriptionId/clientState', async () => {
    const { controller, microsoftCalendarAccounts } = build();
    const res = fakeResponse();

    await controller.handleNotification(undefined, {
      value: [
        { subscriptionId: 'sub-1', clientState: 'secret-1' },
        { subscriptionId: 'sub-2' }, // missing clientState — skipped
        { subscriptionId: 'sub-3', clientState: 'secret-3' },
      ],
    }, res);

    expect(microsoftCalendarAccounts.syncBySubscription).toHaveBeenCalledTimes(2);
    expect(microsoftCalendarAccounts.syncBySubscription).toHaveBeenCalledWith('sub-1', 'secret-1');
    expect(microsoftCalendarAccounts.syncBySubscription).toHaveBeenCalledWith('sub-3', 'secret-3');
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('still responds 202 even if syncBySubscription itself throws for one notification — a missed real-time push must never surface as an error to Graph', async () => {
    const { controller, microsoftCalendarAccounts } = build();
    microsoftCalendarAccounts.syncBySubscription.mockRejectedValueOnce(new Error('boom'));
    const res = fakeResponse();

    await controller.handleNotification(undefined, { value: [{ subscriptionId: 'sub-1', clientState: 's' }] }, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
