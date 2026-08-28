import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('SchedulerLock');

// How long an acquired lock is considered valid before it self-heals, even
// if the holder never released it (a crash, a killed deploy mid-sweep).
// Comfortably longer than any of this app's three periodic sweeps should
// ever take in normal operation — see each cron method's own call site for
// its specific job id.
const LEASE_MINUTES = 20;

// Real cross-instance lock for a scheduled job, backing SchedulerService's
// and NotificationsService's periodic sweeps — see schema.prisma's
// SchedulerLock model comment for the full "why a DB row instead of
// pg_advisory_lock" reasoning. Returns `undefined` (running `fn` not at
// all) when another instance already holds the lock; otherwise runs `fn`
// and always releases the lock afterward, success or failure.
export async function withSchedulerLock<T>(
  prisma: PrismaService,
  jobId: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const acquired = await tryAcquireLock(prisma, jobId);
  if (!acquired) {
    logger.warn(`${jobId} sweep skipped — another instance already holds this job's lock.`);
    return undefined;
  }
  try {
    return await fn();
  } finally {
    await releaseLock(prisma, jobId);
  }
}

async function tryAcquireLock(prisma: PrismaService, jobId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000);
  // Atomic claim: succeeds (returns the row) when no lock row exists yet
  // for this job, OR the existing one has already expired (the self-heal
  // path for a crashed prior holder). Fails silently (returns zero rows,
  // not an error) when a live lock is already held by someone else — the
  // `WHERE` clause on the DO UPDATE branch is what makes this a real
  // compare-and-swap rather than an unconditional overwrite.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "scheduler_locks" ("id", "locked_at", "expires_at")
    VALUES (${jobId}, ${now}, ${expiresAt})
    ON CONFLICT ("id") DO UPDATE
      SET "locked_at" = EXCLUDED."locked_at", "expires_at" = EXCLUDED."expires_at"
      WHERE "scheduler_locks"."expires_at" < ${now}
    RETURNING "id"
  `;
  return rows.length > 0;
}

async function releaseLock(prisma: PrismaService, jobId: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM "scheduler_locks" WHERE "id" = ${jobId}`;
  } catch (error) {
    // Best-effort — an unreleased lock still self-heals via its own
    // expiresAt, so a failure here must never surface past the job itself.
    logger.warn(`Failed to release lock for ${jobId}: ${(error as Error).message}`);
  }
}
