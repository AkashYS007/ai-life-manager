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
    // against each other. Only checked when both are sent in the same call
    // (Settings' own form always sends both together — see the increment
    // note) — a lone field being updated is compared against nothing here,
    // trusting whatever the other one is already set to server-side.
    if (
      input.reminderHabitMinOverdueMinutes != null &&
      input.reminderHabitMaxOverdueMinutes != null &&
      input.reminderHabitMinOverdueMinutes >= input.reminderHabitMaxOverdueMinutes
    ) {
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
