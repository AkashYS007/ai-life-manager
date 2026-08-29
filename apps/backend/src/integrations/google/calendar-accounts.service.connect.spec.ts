import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarAccountsService } from './calendar-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarClient } from './google-calendar-client';
import { encryptToken } from '../crypto/token-cipher';

// Production Hardening Sprint 1 (2026-08-29) regression coverage for the
// Update 50 phantom-connected-account fix (backend audit Update 49 finding
// #8, medium severity — see calendar-accounts.service.ts's own comment on
// `connect()`): before that fix, a transient failure on the very first
// post-OAuth sync left the CalendarAccount row committed as ACTIVE with
// valid tokens, so the account showed up as "connected" server-side even
// though the person was redirected to an error page. Nothing in this repo
// exercised that specific fix before now — same "mocked Prisma/dependencies,
// no real network" unit-test shape calendar-accounts.service.webhook.spec.ts
// already establishes.
describe('CalendarAccountsService — connect() first-sync failure handling', () => {
  const ENCRYPTION_KEY = 'test-encryption-key';

  const prismaMock = {
    calendarAccount: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const configValues: Record<string, string | undefined> = {
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    BACKEND_PUBLIC_URL: undefined,
  };
  const configMock = { get: jest.fn((key: string) => configValues[key]) };
  const calendarServiceMock = { deleteByExternalId: jest.fn(), upsertFromExternalSource: jest.fn() };
  const googleOAuthMock = {
    exchangeCodeForTokens: jest.fn(),
    fetchAccountEmail: jest.fn(),
    refreshAccessToken: jest.fn(),
  };
  const googleCalendarClientMock = { listEvents: jest.fn(), watchEvents: jest.fn(), stopChannel: jest.fn() };

  let service: CalendarAccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();
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

    googleOAuthMock.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
      expiresInSeconds: 3600,
    });
    googleOAuthMock.fetchAccountEmail.mockResolvedValue('person@example.com');
    prismaMock.calendarAccount.upsert.mockResolvedValue({ id: 'acct-1' });
  });

  it('marks the account ERROR and re-throws when the first-ever sync call fails, instead of leaving it ACTIVE', async () => {
    // The account row `sync()` re-reads internally — must round-trip through
    // real token encryption since `sync()` calls decryptToken on it.
    prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct-1',
      accessTokenEncrypted: encryptToken('fresh-access-token', ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken('fresh-refresh-token', ENCRYPTION_KEY),
      syncToken: null,
    });
    // A persistent transient failure: both the initial call and the
    // refresh-and-retry call fail, so `sync()`'s own token-refresh recovery
    // path can't save it either — the realistic shape of "Google is down,"
    // not just a single flaky call.
    googleCalendarClientMock.listEvents.mockRejectedValue(new Error('503 Service Unavailable'));
    googleOAuthMock.refreshAccessToken.mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(service.connect('user-1', 'auth-code-123')).rejects.toThrow('503 Service Unavailable');

    expect(prismaMock.calendarAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(prismaMock.calendarAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { status: 'ERROR' },
    });
    // registerWebhook must never run once the first sync has already failed
    // — connect() re-throws before reaching it.
    expect(googleCalendarClientMock.watchEvents).not.toHaveBeenCalled();
  });

  it('leaves the account ACTIVE and does not touch status again when the first sync succeeds', async () => {
    prismaMock.calendarAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct-1',
      accessTokenEncrypted: encryptToken('fresh-access-token', ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken('fresh-refresh-token', ENCRYPTION_KEY),
      syncToken: null,
    });
    googleCalendarClientMock.listEvents.mockResolvedValue({ events: [], fullResyncRequired: false });

    await service.connect('user-1', 'auth-code-123');

    expect(prismaMock.calendarAccount.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ERROR' } }),
    );
  });
});
