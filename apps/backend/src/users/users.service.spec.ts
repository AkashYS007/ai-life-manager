import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

// Unit test with a fake Prisma client — proves the JIT-provisioning logic
// (create-on-first-sight, reuse-on-repeat) without a real database, per
// Architecture Document §4.8 testing strategy (Vitest/Jest unit layer).
//
// Fixed 2026-08-24 (backend audit Update 49 finding #10, low severity):
// UsersService gained a ConfigService dependency (for the PAID_TIERS_ENABLED
// check) that this testing module never registered — every test in this
// file failed at `moduleRef.compile()` before any assertion ran
// ("Nest can't resolve dependencies of the UsersService (PrismaService,
// ?)"). `configMock` below is a minimal stand-in; nothing in this file's
// existing tests exercises PAID_TIERS_ENABLED, so `get()` never needs a
// real implementation for them to pass.
describe('UsersService', () => {
  let service: UsersService;
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const configMock = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('returns the existing user without creating a new one', async () => {
    const existing = { id: 'u1', email: 'a@b.com', authProviderId: 'dev:a@b.com' };
    prismaMock.user.findUnique.mockResolvedValue(existing);

    const result = await service.getOrCreateFromAuth({ authProviderId: 'dev:a@b.com', email: 'a@b.com' });

    expect(result).toEqual(existing);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  // Editable email increment: the whole point of this resync is to catch a
  // real login email change made through Clerk's own account UI, which
  // this app finds out about purely by `auth.email` (re-derived fresh from
  // the verified session on every request) no longer matching the stored
  // row.
  it('resyncs a stale local email when the verified auth email has changed', async () => {
    const existing = { id: 'u1', email: 'old@b.com', authProviderId: 'clerk:abc' };
    const updated = { id: 'u1', email: 'new@b.com', authProviderId: 'clerk:abc' };
    prismaMock.user.findUnique.mockResolvedValue(existing);
    prismaMock.user.update.mockResolvedValue(updated);

    const result = await service.getOrCreateFromAuth({ authProviderId: 'clerk:abc', email: 'new@b.com' });

    expect(result).toEqual(updated);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { email: 'new@b.com' } }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  // Best-effort: a failed resync (in practice, only ever `email`'s
  // `@unique` constraint) must never break the one query almost every
  // resolver in this app depends on — the stale row is still a perfectly
  // usable result, just not yet resynced.
  it('falls back to the stale existing user if the resync update itself fails', async () => {
    const existing = { id: 'u1', email: 'old@b.com', authProviderId: 'clerk:abc' };
    prismaMock.user.findUnique.mockResolvedValue(existing);
    prismaMock.user.update.mockRejectedValue(new Error('unique constraint violation'));

    const result = await service.getOrCreateFromAuth({ authProviderId: 'clerk:abc', email: 'new@b.com' });

    expect(result).toEqual(existing);
  });

  it('creates a new user with a default Free subscription on first sight', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const created = { id: 'u2', email: 'new@b.com', authProviderId: 'dev:new@b.com' };
    prismaMock.user.create.mockResolvedValue(created);

    const result = await service.getOrCreateFromAuth({ authProviderId: 'dev:new@b.com', email: 'new@b.com' });

    expect(result).toEqual(created);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@b.com',
          subscription: { create: { tier: 'FREE', status: 'ACTIVE' } },
        }),
      }),
    );
  });

  // Regression test for backend audit Update 49 finding #3 (high severity):
  // two concurrent first-load requests for the same brand-new user can both
  // see `findUnique` return null and race to `create()` the same row — the
  // loser must fall back to the winner's row instead of throwing.
  it('falls back to the row a concurrent request already created, on a unique-constraint race', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const winner = { id: 'u3', email: 'race@b.com', authProviderId: 'dev:race@b.com' };
    // Plain object with a `.code`, not `new Prisma.PrismaClientKnownRequestError(...)`
    // — this repo's generated `@prisma/client` doesn't actually re-export
    // that class off the `Prisma` namespace (see users.service.ts's own
    // `isPrismaUniqueConstraintError` comment for how this was caught), so
    // constructing one here would either fail to compile or silently not
    // match what the real fix checks for. A real Prisma error's only
    // load-bearing property for this check is `.code`.
    prismaMock.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`authProviderId`)'), { code: 'P2002' }),
    );
    prismaMock.user.findUnique.mockResolvedValueOnce(winner);

    const result = await service.getOrCreateFromAuth({ authProviderId: 'dev:race@b.com', email: 'race@b.com' });

    expect(result).toEqual(winner);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  // A create failure that ISN'T a unique-constraint race (e.g. the DB is
  // genuinely down) must still propagate — this fix only swallows the one
  // specific, expected-under-normal-concurrency error code.
  it('still throws on a create failure that is not a P2002 unique-constraint error', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.create.mockRejectedValue(new Error('connection refused'));

    await expect(
      service.getOrCreateFromAuth({ authProviderId: 'dev:down@b.com', email: 'down@b.com' }),
    ).rejects.toThrow('connection refused');
  });
});
