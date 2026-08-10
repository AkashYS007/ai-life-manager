import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { Habit, HabitFrequency, MonthlyRecurrenceMode } from './models/habit.model';
import {
  CreateHabitPayload,
  UpdateHabitPayload,
  DeactivateHabitPayload,
  CompleteHabitLogPayload,
} from './models/habit.payload';
import { CreateHabitInput } from './dto/create-habit.input';
import { UpdateHabitInput } from './dto/update-habit.input';
import { HabitsService } from './habits.service';

// Same ownership discipline as every other resolver: resolve the internal
// users.id first, never scope by the raw auth identity.
@Resolver()
@UseGuards(AuthGuard)
export class HabitsResolver {
  constructor(
    private readonly habitsService: HabitsService,
    private readonly usersService: UsersService,
  ) {}

  // Full custom habit recurrence increment: mirrors the pre-existing
  // WEEKLY-with-no-days pre-check just below each call site — a MONTHLY
  // habit is just as easy to submit half-filled-out (mode chosen but not
  // the day, say), and deserves the same field-specific INVALID_RECURRENCE
  // error rather than falling through to the generic catch-all's plain
  // "couldn't create/save that" message. Shared here (rather than
  // duplicated like the WEEKLY check is between createHabit/updateHabit)
  // since it's meaningfully more branches than that one-liner.
  private monthlyRecurrenceError(input: {
    monthlyMode?: MonthlyRecurrenceMode;
    dayOfMonth?: number;
    monthlyWeekday?: number;
    monthlyOrdinal?: number;
    daysOfMonth?: number[];
    monthlyWeekdaySet?: number[];
  }): { field: string; code: string; message: string } | null {
    if (!input.monthlyMode) {
      return { field: 'monthlyMode', code: 'INVALID_RECURRENCE', message: 'Choose a day of the month or a specific weekday.' };
    }
    if (input.monthlyMode === MonthlyRecurrenceMode.DAY_OF_MONTH && input.dayOfMonth == null) {
      return { field: 'dayOfMonth', code: 'INVALID_RECURRENCE', message: 'Pick a day of the month.' };
    }
    if (input.monthlyMode === MonthlyRecurrenceMode.NTH_WEEKDAY && (input.monthlyWeekday == null || input.monthlyOrdinal == null)) {
      return { field: 'monthlyWeekday', code: 'INVALID_RECURRENCE', message: 'Pick a weekday and which occurrence of the month.' };
    }
    // BYSETPOS / multiple weekdays per month increment: same
    // field-specific pre-check pattern as the two branches above.
    if (input.monthlyMode === MonthlyRecurrenceMode.DAYS_OF_MONTH && (!input.daysOfMonth || input.daysOfMonth.length < 2)) {
      return { field: 'daysOfMonth', code: 'INVALID_RECURRENCE', message: 'Pick at least 2 different days of the month.' };
    }
    if (
      input.monthlyMode === MonthlyRecurrenceMode.NTH_WEEKDAY_SET &&
      (!input.monthlyWeekdaySet || input.monthlyWeekdaySet.length === 0 || input.monthlyOrdinal == null)
    ) {
      return {
        field: 'monthlyWeekdaySet',
        code: 'INVALID_RECURRENCE',
        message: 'Pick at least one weekday and which occurrence to use.',
      };
    }
    return null;
  }

  @Query(() => [Habit])
  async habits(
    @CurrentAuth() auth: AuthContext,
    @Args('activeOnly', { nullable: true }) activeOnly?: boolean,
  ): Promise<Habit[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.habitsService.listForUser(user.id, user.timezone, activeOnly ?? false);
  }

  @Mutation(() => CreateHabitPayload)
  async createHabit(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateHabitInput,
  ): Promise<CreateHabitPayload> {
    if (input.frequency === HabitFrequency.WEEKLY && (!input.daysOfWeek || input.daysOfWeek.length === 0)) {
      return {
        errors: [
          { field: 'daysOfWeek', code: 'INVALID_RECURRENCE', message: 'Pick at least one day of the week.' },
        ],
      };
    }
    if (input.frequency === HabitFrequency.MONTHLY) {
      const error = this.monthlyRecurrenceError(input);
      if (error) return { errors: [error] };
    }
    // Fuller habit recurrence increment — same "field-specific
    // INVALID_RECURRENCE, checked before calling the service" pattern as
    // the WEEKLY/MONTHLY pre-checks above, rather than letting this fall
    // through to the generic catch-all's plain "couldn't create that
    // habit" message.
    if (input.count != null && input.until != null) {
      return {
        errors: [
          { field: 'count', code: 'INVALID_RECURRENCE', message: 'A habit can end after a fixed number of times, or on a date — not both.' },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.create(user.id, user.timezone, input);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't create that habit. Try again." }] };
    }
  }

  @Mutation(() => UpdateHabitPayload)
  async updateHabit(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateHabitInput,
  ): Promise<UpdateHabitPayload> {
    if (input.frequency === HabitFrequency.WEEKLY && input.daysOfWeek?.length === 0) {
      return {
        errors: [
          { field: 'daysOfWeek', code: 'INVALID_RECURRENCE', message: 'Pick at least one day of the week.' },
        ],
      };
    }
    if (input.frequency === HabitFrequency.MONTHLY) {
      const error = this.monthlyRecurrenceError(input);
      if (error) return { errors: [error] };
    }
    // Fuller habit recurrence increment — see createHabit's identical
    // check just above for why this is checked here rather than left to
    // HabitsService.update's own generic catch. Only fires when *both* are
    // explicitly sent on this same call — sending just one (to replace
    // whatever end condition already existed) is the normal, valid case
    // (see HabitsService.update's own comment on that three-way handling).
    if (input.count != null && input.until != null) {
      return {
        errors: [
          { field: 'count', code: 'INVALID_RECURRENCE', message: 'A habit can end after a fixed number of times, or on a date — not both.' },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.update(user.id, user.timezone, id, input);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }

  @Mutation(() => DeactivateHabitPayload)
  async deactivateHabit(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeactivateHabitPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.deactivate(user.id, user.timezone, id);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'DEACTIVATE_FAILED', message: "We couldn't deactivate that habit. Try again." }] };
    }
  }

  // Habit-edit UI increment. Reuses DeactivateHabitPayload — same
  // `{ habit, errors }` shape, no reason for a near-identical second type.
  @Mutation(() => DeactivateHabitPayload)
  async reactivateHabit(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeactivateHabitPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.reactivate(user.id, user.timezone, id);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'REACTIVATE_FAILED', message: "We couldn't reactivate that habit. Try again." }] };
    }
  }

  @Mutation(() => CompleteHabitLogPayload)
  async completeHabitLog(
    @CurrentAuth() auth: AuthContext,
    @Args('habitId', { type: () => ID }) habitId: string,
    @Args('date') date: Date,
  ): Promise<CompleteHabitLogPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.completeLog(user.id, user.timezone, habitId, date);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'COMPLETE_LOG_FAILED', message: "We couldn't save that. Try again." }] };
    }
  }

  // Not in the API Design Document's original table (which only lists
  // completeHabitLog), but a checkbox the user can toggle needs a symmetric
  // "undo" the same way logMood/logEnergy/logSleep are all correctable —
  // additive, non-breaking schema/API evolution, same pattern used
  // throughout this codebase (API Design Document §13).
  @Mutation(() => CompleteHabitLogPayload)
  async uncompleteHabitLog(
    @CurrentAuth() auth: AuthContext,
    @Args('habitId', { type: () => ID }) habitId: string,
    @Args('date') date: Date,
  ): Promise<CompleteHabitLogPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const habit = await this.habitsService.uncompleteLog(user.id, user.timezone, habitId, date);
      return { habit, errors: [] };
    } catch {
      return { errors: [{ code: 'UNCOMPLETE_LOG_FAILED', message: "We couldn't save that. Try again." }] };
    }
  }
}
