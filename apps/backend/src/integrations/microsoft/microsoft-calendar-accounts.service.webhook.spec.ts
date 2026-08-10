import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MicrosoftCalendarAccountsService } from './microsoft-calendar-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { MicrosoftOAuthService } from './microsoft-oauth.service';
import { MicrosoftCalendarClient } from './microsoft-calendar-client';
import { encryptToken } from '../crypto/token-cipher';

// Real-time calendar updates (webhooks) increment. Same mocked-Prisma
// unit-test shape as calendar-accounts.service.webhook.spec.ts (the Google
// side of this exact increment) — see that file's own comment.
describe('MicrosoftCalendarAccountsService — webhook registration/verification', () => {
  const ENCRYPTION_KEY = 'test-encryption-key';
  const accessTokenEncrypted = encryptToken('fake-access-token', ENCRYPTION_KEY);
  const refreshTokenEncrypted = encryptToken('fake-refresh-token', ENCRYPTION_KEY);

  const baseAccount = {
    id: 'acct-1',
    userId: 'user-1',
    provider: 'MICROSOFT',
    accessTokenEncrypted,
    refreshTokenEncrypted,
    syncToken: null,
    webhookChannelId: null,
    webhookVerificationToken: null,
    webhookExpiresAt: null,
  };

  const prismaMock = {
    calendarAccount: {
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const configValues: Record<string, string | undefined> = {
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    BACKEND_PUBLIC_URL: undefined,
  };
  const configMock = { get: jest.fn((key: string) => configValues[key]) };
  const calendarServiceMock = { deleteByExternalId: jest.fn(), upsertFromExternalSource: jest.fn() };
  const microsoftOAuthMock = { refreshAccessToken: jest.fn() };
  const microsoftCalendarClientMock = {
    createSubscription: jest.fn(),
    renewSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
    listEvents: jest.fn(),
  };

  let service: MicrosoftCalendarAccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues.BACKEND_PUBLIC_URL = undefined;
    const moduleRef = await Test.createTestingModule({
      providers: [
        MicrosoftCalendarAccountsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        { provide: CalendarService, useValue: calendarServiceMock },
        { provide: MicrosoftOAuthService, useValue: microsoftOAuthMock },
        { provide: MicrosoftCalendarClient, useValue: microsoftCalendarClientMock },
      ],
    }).compile();
    service = moduleRef.get(MicrosoftCalendarAccountsService);
  });

  describe('registerWebhook', () => {
    it('does nothing at all when BACKEND_PUBLIC_URL is not configured', async () => {
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);

      await service.registerWebhook('acct-1');

      expect(microsoftCalendarClientMock.createSubscription).not.toHaveBeenCalled();
      expect(prismaMock.calendarAccount.update).not.toHaveBeenCalled();
    });

    it('creates a subscription at the expected notification URL, requesting the documented max lifetime, and stores what Graph returns', async () => {
      configValues.BACKEND_PUBLIC_URL = 'https://api.example.com/';
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);
      microsoftCalendarClientMock.createSubscription.mockResolvedValue({
        subscriptionId: 'sub-1',
        expirationDateTime: '2026-08-11T00:00:00.000Z',
      });

      await service.registerWebhook('acct-1');

      expect(microsoftCalendarClientMock.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'fake-access-token',
          notificationUrl: 'https://api.example.com/webhooks/microsoft/calendar',
        }),
      );
      expect(prismaMock.calendarAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acct-1' },
          data: expect.objectContaining({
            webhookChannelId: 'sub-1',
            webhookExpiresAt: new Date('2026-08-11T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('refreshes the access token once and retries when the first createSubscription call fails', async () => {
      configValues.BACKEND_PUBLIC_URL = 'https://api.example.com';
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);
      microsoftCalendarClientMock.createSubscription
        .mockRejectedValueOnce(new Error('401 expired token'))
        .mockResolvedValueOnce({ subscriptionId: 'sub-1', expirationDateTime: '2026-08-11T00:00:00.000Z' });
      microsoftOAuthMock.refreshAccessToken.mockResolvedValue({ accessToken: 'fresh-access-token', refreshToken: 'fresh-refresh-token' });

      await service.registerWebhook('acct-1');

      expect(microsoftOAuthMock.refreshAccessToken).toHaveBeenCalledWith('fake-refresh-token');
      expect(microsoftCalendarClientMock.createSubscription).toHaveBeenCalledTimes(2);
      expect(microsoftCalendarClientMock.createSubscription).toHaveBeenLastCalledWith(
        expect.objectContaining({ accessToken: 'fresh-access-token' }),
      );
    });
  });

  describe('syncBySubscription', () => {
    it('does not attempt a sync when no account matches the given subscriptionId', async () => {
      prismaMock.calendarAccount.findFirst.mockResolvedValue(null);

      await service.syncBySubscription('sub-unknown', 'secret-1');

      expect(microsoftCalendarClientMock.listEvents).not.toHaveBeenCalled();
    });

    it('does not attempt a sync when clientState does not match what is stored', async () => {
      prismaMock.calendarAccount.findFirst.mockResolvedValue({
        ...baseAccount,
        webhookChannelId: 'sub-1',
        webhookVerificationToken: 'secret-1',
      });

      await service.syncBySubscription('sub-1', 'secret-WRONG');

      expect(microsoftCalendarClientMock.listEvents).not.toHaveBeenCalled();
    });

    it('runs a real sync once subscriptionId and clientState both match', async () => {
      const matchingAccount = { ...baseAccount, webhookChannelId: 'sub-1', webhookVerificationToken: 'secret-1' };
      prismaMock.calendarAccount.findFirst.mockResolvedValue(matchingAccount);
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(matchingAccount);
      microsoftCalendarClientMock.listEvents.mockResolvedValue({ events: [], fullResyncRequired: false });

      await service.syncBySubscription('sub-1', 'secret-1');

      expect(microsoftCalendarClientMock.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'fake-access-token' }),
      );
    });
  });
});
