import { Logger, UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { Routine, RoutineType } from './models/routine.model';
import {
  DeleteRoutinePayload,
  SetRoutinePayload,
  SetTodayRoutineCompletionPayload,
} from './models/routine.payload';
import { SetRoutineInput } from './dto/set-routine.input';
import { SetTodayRoutineCompletionInput } from './dto/set-today-routine-completion.input';
import { RoutinesService } from './routines.service';

@Resolver(() => Routine)
@UseGuards(AuthGuard)
export class RoutinesResolver {
  private readonly logger = new Logger(RoutinesResolver.name);

  constructor(
    private readonly routinesService: RoutinesService,
    private readonly usersService: UsersService,
  ) {}

  // Both routines at once — the Today page renders a morning and an evening
  // checklist widget side by side, so one round trip covers both rather than
  // requiring two separate `routine(type)` queries.
  @Query(() => [Routine])
  async todayRoutines(@CurrentAuth() auth: AuthContext): Promise<Routine[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.routinesService.listTodayForUser(user.id, user.timezone);
  }

  @Query(() => Routine, { nullable: true })
  async routine(
    @CurrentAuth() auth: AuthContext,
    @Args('type', { type: () => RoutineType }) type: RoutineType,
  ): Promise<Routine | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.routinesService.getTodayFor(user.id, user.timezone, type);
  }

  @Mutation(() => SetRoutinePayload)
  async setRoutine(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: SetRoutineInput,
  ): Promise<SetRoutinePayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const routine = await this.routinesService.setRoutine(user.id, user.timezone, input);
      return { routine, errors: [] };
    } catch (error) {
      // This used to be a bare `catch {}` — the real error was completely
      // swallowed, with nothing logged anywhere, so a genuine failure here
      // was undiagnosable from the outside (same class of "silent failure"
      // problem the AI planner's dropped-suggestion logging above already
      // fixed for a different code path).
      this.logger.error(`setRoutine failed: ${(error as Error).message}`, (error as Error).stack);
      return { errors: [{ code: 'SET_FAILED', message: "We couldn't save that routine. Try again." }] };
    }
  }

  @Mutation(() => SetTodayRoutineCompletionPayload)
  async setTodayRoutineCompletion(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: SetTodayRoutineCompletionInput,
  ): Promise<SetTodayRoutineCompletionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const routine = await this.routinesService.setTodayCompletion(user.id, user.timezone, input);
      return { routine, errors: [] };
    } catch (error) {
      this.logger.error(`setTodayRoutineCompletion failed: ${(error as Error).message}`, (error as Error).stack);
      return {
        errors: [{ code: 'SET_COMPLETION_FAILED', message: "We couldn't save today's progress. Try again." }],
      };
    }
  }

  @Mutation(() => DeleteRoutinePayload)
  async deleteRoutine(
    @CurrentAuth() auth: AuthContext,
    @Args('type', { type: () => RoutineType }) type: RoutineType,
  ): Promise<DeleteRoutinePayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const deleted = await this.routinesService.deleteRoutine(user.id, type);
      return { deleted, errors: [] };
    } catch (error) {
      this.logger.error(`deleteRoutine failed: ${(error as Error).message}`, (error as Error).stack);
      return { deleted: false, errors: [{ code: 'DELETE_FAILED', message: "We couldn't remove that routine. Try again." }] };
    }
  }
}
