import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { CompleteOnboardingInput } from './dto/complete-onboarding.input';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
  ) {}

  // The diagnostic quiz's single write: every answered field is saved
  // straight onto User (workHoursStart/End and quietHoursStart/End follow
  // the exact same undefined-means-unchanged convention as
  // NotificationsService.updatePreferences and UsersService.updateProfile —
  // a person who skips a question just leaves that column untouched rather
  // than getting it wiped to null), plus onboardingCompletedAt is stamped
  // unconditionally, since reaching this mutation at all — even having
  // skipped every question — is what "completed onboarding" means (the
  // OnboardingGate frontend component only cares whether this is set, not
  // what answers came with it).
  async complete(userId: string, input: CompleteOnboardingInput) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        // GraphQL enum value written into a Prisma enum column — same
        // ChatMessageRole/RoutineType-class cast precedent as
        // UsersService.updateProfile's identical chronotype write.
        chronotype: input.chronotype as any,
        workHoursStart: input.workHoursStart,
        workHoursEnd: input.workHoursEnd,
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
        onboardingCompletedAt: new Date(),
        // Reaching this mutation at all always means the wizard's next step
        // is Connect calendar, so this is stamped unconditionally, the same
        // way onboardingCompletedAt itself is right above. Overwrites any
        // previous value on a redo — correct, since redoing the quiz always
        // restarts the wizard from the same "next: calendar" point
        // regardless of how far a previous pass got.
        onboardingWizardStep: 'CALENDAR',
      },
      include: { subscription: true },
    });

    // The "priorities" half of the PRD's onboarding requirement: recorded as
    // a real AI Memory preference fact (the same FACT_TYPE = 'preference'
    // surface the /memory page reads and writes), so it shows up there too
    // and is injected into every AI prompt immediately, not just stored
    // inertly. Re-enter onboarding increment: upserted by a stable key now
    // (MemoryService.upsertOnboardingOverloadFact), not created fresh every
    // time — redoing the quiz and re-answering this question updates the
    // one fact already there instead of piling up a duplicate (see that
    // method's own comment for the real bug this closes). Best-effort —
    // onboarding must still complete (the user update above already
    // happened) even if this secondary write fails.
    if (input.overloadSource) {
      try {
        await this.memoryService.upsertOnboardingOverloadFact(userId, input.overloadSource);
      } catch (error) {
        this.logger.warn(`onboarding priority memory fact failed: ${(error as Error).message}`);
      }
    }

    // Diagnostic quiz free-text answers increment: same best-effort,
    // upsert-by-stable-key treatment as overloadSource just above, its own
    // independent fact (MemoryService.upsertOnboardingFreeTextFact) — a
    // failure here still doesn't roll back or block the User update that
    // already happened.
    if (input.freeTextNotes) {
      try {
        await this.memoryService.upsertOnboardingFreeTextFact(userId, input.freeTextNotes);
      } catch (error) {
        this.logger.warn(`onboarding free-text memory fact failed: ${(error as Error).message}`);
      }
    }

    return user;
  }

  // Resumable onboarding wizard increment. `complete` above always sets
  // this to CALENDAR the moment the quiz submits (that's always the very
  // next step) — this is the only other transition the wizard has to
  // record: the calendar step's own "Continue" button, moving on to First
  // plan. No validation needed on `step` beyond what TypeScript's real enum
  // type already guarantees at the resolver layer — unlike the OAuth
  // `returnTo` hint (a client-supplied plain string that had to be
  // whitelisted), this argument is a real GraphQL enum, so anything else
  // is rejected by GraphQL itself before this method ever runs. `step` is
  // typed as plain `string` here (not the enum type), same convention
  // UsersService.changeSubscriptionTier already established for its own
  // enum-argument mutation — the resolver's real enum type is the actual
  // validation; this layer just needs something Prisma's own generated
  // enum column type accepts.
  async recordWizardStep(userId: string, step: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingWizardStep: step as any },
      include: { subscription: true },
    });
  }
}
