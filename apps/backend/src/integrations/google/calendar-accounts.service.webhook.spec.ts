import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarAccountsService } from './calendar-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarClient } from './google-calendar-client';
import { encryptToken } from '../crypto/token-cipher';

// Real-time calendar updates (webhooks) increment. Same "mocked Prisma (and
// every other dependency), no real database, no real network" unit-test
// shape as users.service.spec.ts already establishes for this codebase —
// just with more dependencies to mock, since CalendarAccountsService has
// more collaborators than UsersService does.
describe('CalendarAccountsService — webhook registration/verification', () => {
  const ENCRYPTION_KEY = 'test-encryption-key';
  const accessTokenEncrypted = encryptToken('fake-access-token', ENCRYPTION_KEY);
  const refreshTokenEncrypted = encryptToken('fake-refresh-token', ENCRYPTION_KEY);

  const baseAccount = {
    id: 'acct-1',
    userId: 'user-1',
    provider: 'GOOGLE',
    accessTokenEncrypted,
    refreshTokenEncrypted,
    syncToken: null,
    webhookChannelId: null,
    webhookResourceId: null,
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
  const googleOAuthMock = { refreshAccessToken: jest.fn() };
  const googleCalendarClientMock = {
    watchEvents: jest.fn(),
    stopChannel: jest.fn(),
    listEvents: jest.fn(),
  };

  let service: CalendarAccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues.BACKEND_PUBLIC_URL = undefined;
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarAccountsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        { provide: CalendarService, useValue: calendarServiceMock },
        { provide: GoogleOAuthService, useValue: googleOAuthMock },
        { provide: GoogleCalendarClient, useValue: googleCalendarClientMock },
      ],
    }).compile();
    service = moduleRef.get(CalendarAccountsService);
  });

  describe('registerWebhook', () => {
    it('does nothing at all when BACKEND_PUBLIC_URL is not configured', async () => {
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);

      await service.registerWebhook('acct-1');

      expect(googleCalendarClientMock.watchEvents).not.toHaveBeenCalled();
      expect(prismaMock.calendarAccount.update).not.toHaveBeenCalled();
    });

    it('registers a channel at the expected address and stores the returned resourceId/expiration', async () => {
      configValues.BACKEND_PUBLIC_URL = 'https://api.example.com/';
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);
      googleCalendarClientMock.watchEvents.mockResolvedValue({ resourceId: 'r-123', expiration: '1700000000000' });

      await service.registerWebhook('acct-1');

      expect(googleCalendarClientMock.watchEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'fake-access-token',
          // Trailing slash on BACKEND_PUBLIC_URL is stripped before appending
          // the webhook path, so this never ends up with a double slash.
          address: 'https://api.example.com/webhooks/google/calendar',
        }),
      );
      expect(prismaMock.calendarAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acct-1' },
          data: expect.objectContaining({
            webhookResourceId: 'r-123',
            webhookExpiresAt: new Date(1700000000000),
          }),
        }),
      );
    });

    it('refreshes the access token once and retries when the first watchEvents call fails', async () => {
      configValues.BACKEND_PUBLIC_URL = 'https://api.example.com';
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(baseAccount);
      googleCalendarClientMock.watchEvents
        .mockRejectedValueOnce(new Error('401 expired token'))
        .mockResolvedValueOnce({ resourceId: 'r-123', expiration: '1700000000000' });
      googleOAuthMock.refreshAccessToken.mockResolvedValue({ accessToken: 'fresh-access-token' });

      await service.registerWebhook('acct-1');

      expect(googleOAuthMock.refreshAccessToken).toHaveBeenCalledWith('fake-refresh-token');
      expect(googleCalendarClientMock.watchEvents).toHaveBeenCalledTimes(2);
      expect(googleCalendarClientMock.watchEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ accessToken: 'fresh-access-token' }),
      );
    });
  });

  describe('syncByChannel', () => {
    it('does not attempt a sync when no account matches the given channelId', async () => {
      prismaMock.calendarAccount.findFirst.mockResolvedValue(null);

      await service.syncByChannel('chan-unknown', 'r-1', 'tok-1');

      expect(googleCalendarClientMock.listEvents).not.toHaveBeenCalled();
    });

    it('does not attempt a sync when the resourceId does not match what is stored', async () => {
      prismaMock.calendarAccount.findFirst.mockResolvedValue({
        ...baseAccount,
        webhookChannelId: 'chan-1',
        webhookResourceId: 'r-1',
        webhookVerificationToken: 'tok-1',
      });

      await service.syncByChannel('chan-1', 'r-WRONG', 'tok-1');

      expect(googleCalendarClientMock.listEvents).not.toHaveBeenCalled();
    });

    it('does not attempt a sync when the verification token does not match what is stored', async () => {
      prismaMock.calendarAccount.findFirst.mockResolvedValue({
        ...baseAccount,
        webhookChannelId: 'chan-1',
        webhookResourceId: 'r-1',
        webhookVerificationToken: 'tok-1',
      });

      await service.syncByChannel('chan-1', 'r-1', 'tok-WRONG');

      expect(googleCalendarClientMock.listEvents).not.toHaveBeenCalled();
    });

    it('runs a real sync once channelId, resourceId, and token all match', async () => {
      const matchingAccount = {
        ...baseAccount,
        webhookChannelId: 'chan-1',
        webhookResourceId: 'r-1',
        webhookVerificationToken: 'tok-1',
      };
      prismaMock.calendarAccount.findFirst.mockResolvedValue(matchingAccount);
      prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue(matchingAccount);
      googleCalendarClientMock.listEvents.mockResolvedValue({ events: [], fullResyncRequired: false });

      await service.syncByChannel('chan-1', 'r-1', 'tok-1');

      expect(googleCalendarClientMock.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'fake-access-token' }),
      );
    });
  });
});
