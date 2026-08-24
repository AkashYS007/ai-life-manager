import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { User } from './models/user.model';
import { UpdateProfilePayload } from './models/update-profile.payload';
import { DeleteAccountPayload } from './models/delete-account.payload';
import { ChangeSubscriptionTierPayload } from './models/change-subscription-tier.payload';
import { UpdateProfileInput } from './dto/update-profile.input';
import { SubscriptionTier } from './models/subscription.model';
import { UsersService } from './users.service';

// Mirrors SchedulerService's own DEFAULT_HABIT_REMINDER_MIN/MAX_OVERDUE_MINUTES
// — the values a still-null reminderHabitMin/MaxOverdueMinutes column
// resolves to at delivery time. Kept in sync here (rather than imported)
// since importing SchedulerModule into UsersModule for two constants would
// be a real module-dependency edge for no benefit; if either default here
// or in scheduler.service.ts changes, keep both in sync.
const DEFAULT_HABIT_REMINDER_MIN_OVERDUE_MINUTES = 15;
const DEFAULT_HABIT_REMINDER_MAX_OVERDUE_MINUTES = 120;

@Resolver(() => User)
@UseGuards(AuthGuard)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  // `me` is the entry point for almost every screen (API Design Document §5.1).
  @Query(() => User)
  async me(@CurrentAuth() auth: AuthContext): Promise<User> {
    const record = await this.usersService.getOrCreateFromAuth(auth);
    return record as unknown as User;
  }

  @Mutation(() => UpdateProfilePayload)
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: UpdateProfileInput,
  ): Promise<UpdateProfilePayload> {
    // Configurable reminder windows/thresholds increment — same
    // cross-field-ordering check createCalendarEvent/updateCalendarEvent
    // already do for startTime/endTime, since class-validator's per-field
    // decorators on UpdateProfileInput can't compare two sibling fields
    // against each other.
    //
    // Fixed 2026-08-24 (backend audit Update 49 finding #5, high severity —
    // the likely real root cause of the Update 43 "habit reminders
    // sometimes just stop firing" mystery): this used to only check when
    // *both* fields were sent in the same call, trusting whatever the other
    // one was already set to server-side otherwise. A lone field update
    // that happened to cross the already-stored other value (e.g. setting
    // min=150 when the stored/default max is 120) sailed through untouched
    // — and once min >= max, scheduler.service.ts's overdue-window check
    // can never be true again, so every habit reminder for that user goes
    // silently, permanently dark. Now: whenever either field is touched,
    // fetch the current record and validate the *effective* min/max pair
    // (the touched value, or the untouched one's current stored value —
    // falling back to the same hard-coded defaults
    // SchedulerService.getReminderSettingsForUser uses for a still-null
    // column, so this can never pass a pair the scheduler would then
    // reject).
    if (input.reminderHabitMinOverdueMinutes != null || input.reminderHabitMaxOverdueMinutes != null) {
      const current = await this.usersService.getOrCreateFromAuth(auth);
      const effectiveMin =
        input.reminderHabitMinOverdueMinutes ??
        (current as any).reminderHabitMinOverdueMinutes ??
        DEFAULT_HABIT_REMINDER_MIN_OVERDUE_MINUTES;
      const effectiveMax =
        input.reminderHabitMaxOverdueMinutes ??
        (current as any).reminderHabitMaxOverdueMinutes ??
        DEFAULT_HABIT_REMINDER_MAX_OVERDUE_MINUTES;
      if (effectiveMin >= effectiveMax) {
        return {
          errors: [
            {
              field: 'reminderHabitMaxOverdueMinutes',
              code: 'INVALID_RANGE',
              message: 'The maximum overdue window must be greater than the minimum.',
            },
          ],
        };
      }
    }

    try {
      const record = await this.usersService.updateProfile(auth, input);
      return { user: record as unknown as User, errors: [] };
    } catch {
      return {
        errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }],
      };
    }
  }

  // Real billing/subscription management increment. See UsersService.
  // changeSubscriptionTier's own comment for the full "this is a real state
  // change, not a real charge" reasoning — no confirmation input here for
  // the same reason a goal's status change (Mark complete/Abandon) takes
  // none either: this isn't destructive the way account deletion is, so it
  // doesn't need that mutation's type-to-confirm gate.
  @Mutation(() => ChangeSubscriptionTierPayload)
  async changeSubscriptionTier(
    @CurrentAuth() auth: AuthContext,
    @Args('tier', { type: () => SubscriptionTier }) tier: SubscriptionTier,
  ): Promise<ChangeSubscriptionTierPayload> {
    try {
      const record = await this.usersService.changeSubscriptionTier(auth, tier);
      return { user: record as unknown as User, errors: [] };
    } catch (error) {
      if ((error as Error).message === 'PAID_TIERS_DISABLED') {
        return {
          errors: [{ code: 'PAID_TIERS_DISABLED', message: 'Plus and Pro are temporarily unavailable.' }],
        };
      }
      return {
        errors: [{ code: 'CHANGE_TIER_FAILED', message: "We couldn't switch your plan. Try again." }],
      };
    }
  }

  // Account deletion increment. No input beyond the caller's own auth —
  // confirmation is a UI concern (a type-to-confirm affordance on the
  // Settings page), the same "the API takes no confirmation input, the
  // frontend gates the click" convention as every other single-tap delete
  // mutation in this codebase (deleteRoutine, deleteJournalEntry, ...).
  @Mutation(() => DeleteAccountPayload)
  async deleteAccount(@CurrentAuth() auth: AuthContext): Promise<DeleteAccountPayload> {
    try {
      const result = await this.usersService.deleteAccount(auth);
      return { deleted: result.deleted, errors: [] };
    } catch {
      return {
        deleted: false,
        errors: [{ code: 'DELETE_FAILED', message: "We couldn't delete your account. Try again." }],
      };
    }
  }
}
