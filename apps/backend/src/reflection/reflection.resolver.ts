import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { DailyReflection } from './models/daily-reflection.model';
import { SubmitDailyReflectionPayload } from './models/daily-reflection.payload';
import { SubmitDailyReflectionInput } from './dto/submit-daily-reflection.input';
import { ReflectionService } from './reflection.service';

@Resolver(() => DailyReflection)
@UseGuards(AuthGuard)
export class ReflectionResolver {
  constructor(
    private readonly reflectionService: ReflectionService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => DailyReflection, { nullable: true })
  async todayReflection(@CurrentAuth() auth: AuthContext): Promise<DailyReflection | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.reflectionService.getToday(user.id, user.timezone);
  }

  @Query(() => [DailyReflection])
  async recentReflections(
    @CurrentAuth() auth: AuthContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ): Promise<DailyReflection[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.reflectionService.listRecent(user.id, first ?? 14);
  }

  @Mutation(() => SubmitDailyReflectionPayload)
  async submitDailyReflection(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: SubmitDailyReflectionInput,
  ): Promise<SubmitDailyReflectionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const reflection = await this.reflectionService.submit(user.id, user.timezone, input);
      return { reflection, errors: [] };
    } catch {
      return { errors: [{ code: 'SUBMIT_FAILED', message: "We couldn't save that reflection. Try again." }] };
    }
  }
}
