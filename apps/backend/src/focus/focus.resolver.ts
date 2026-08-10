import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { FocusSession } from './models/focus-session.model';
import { StartFocusSessionPayload, EndFocusSessionPayload } from './models/focus-session.payload';
import { StartFocusSessionInput } from './dto/start-focus-session.input';
import { FocusService, FocusSessionAlreadyActiveError, FocusSessionNotActiveError } from './focus.service';

@Resolver(() => FocusSession)
@UseGuards(AuthGuard)
export class FocusResolver {
  constructor(
    private readonly focusService: FocusService,
    private readonly usersService: UsersService,
  ) {}

  // Lets the client resume an in-progress countdown after a page
  // reload/reopen rather than losing track of it — see FocusService.getActive.
  @Query(() => FocusSession, { nullable: true })
  async activeFocusSession(@CurrentAuth() auth: AuthContext): Promise<FocusSession | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.focusService.getActive(user.id);
  }

  @Query(() => [FocusSession])
  async recentFocusSessions(
    @CurrentAuth() auth: AuthContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ): Promise<FocusSession[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.focusService.listRecent(user.id, first ?? 10);
  }

  // Focus sessions feed task duration back increment: scoped by the
  // caller's own `userId` inside FocusService, the same way
  // recentFocusSessions/getActive already are — safe by construction even
  // if `taskId` happens to belong to someone else, since it can only ever
  // return this user's own completed sessions (empty here, never another
  // user's real minutes).
  @Query(() => Int, { nullable: true })
  async focusedMinutesForTask(
    @CurrentAuth() auth: AuthContext,
    @Args('taskId', { type: () => ID }) taskId: string,
  ): Promise<number | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.focusService.getCompletedMinutesForTask(user.id, taskId);
  }

  @Mutation(() => StartFocusSessionPayload)
  async startFocusSession(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: StartFocusSessionInput,
  ): Promise<StartFocusSessionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const session = await this.focusService.start(user.id, input);
      return { session, errors: [] };
    } catch (error) {
      if (error instanceof FocusSessionAlreadyActiveError) {
        return { errors: [{ code: 'ALREADY_ACTIVE', message: error.message }] };
      }
      return { errors: [{ code: 'START_FAILED', message: "We couldn't start a focus session. Try again." }] };
    }
  }

  @Mutation(() => EndFocusSessionPayload)
  async completeFocusSession(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<EndFocusSessionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const session = await this.focusService.complete(user.id, user.timezone, id);
      return { session, errors: [] };
    } catch (error) {
      if (error instanceof FocusSessionNotActiveError) {
        return { errors: [{ code: 'NOT_ACTIVE', message: error.message }] };
      }
      return { errors: [{ code: 'COMPLETE_FAILED', message: "We couldn't complete that focus session. Try again." }] };
    }
  }

  @Mutation(() => EndFocusSessionPayload)
  async cancelFocusSession(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<EndFocusSessionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const session = await this.focusService.cancel(user.id, id);
      return { session, errors: [] };
    } catch (error) {
      if (error instanceof FocusSessionNotActiveError) {
        return { errors: [{ code: 'NOT_ACTIVE', message: error.message }] };
      }
      return { errors: [{ code: 'CANCEL_FAILED', message: "We couldn't cancel that focus session. Try again." }] };
    }
  }
}
