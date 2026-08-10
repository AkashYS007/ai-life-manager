import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

// Unit test with a fake Prisma client — proves the JIT-provisioning logic
// (create-on-first-sight, reuse-on-repeat) without a real database, per
// Architecture Document §4.8 testing strategy (Vitest/Jest unit layer).
describe('UsersService', () => {
  let service: UsersService;
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prismaMock }],
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
});
