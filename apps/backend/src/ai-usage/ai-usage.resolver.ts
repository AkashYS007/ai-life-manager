import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { AiUsageService } from './ai-usage.service';
import { AiUsageSummary } from './models/ai-usage-summary.model';

// Same ownership discipline as every other resolver in this app: resolve
// the internal users.id first, never scope by the raw auth identity — see
// SignalsResolver's own comment for why.
@Resolver()
@UseGuards(AuthGuard)
export class AiUsageResolver {
  constructor(
    private readonly aiUsageService: AiUsageService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => AiUsageSummary)
  async myAiUsage(
    @CurrentAuth() auth: AuthContext,
    @Args('days', { type: () => Int, nullable: true }) days?: number,
  ): Promise<AiUsageSummary> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.aiUsageService.getSummary(user.id, days ?? undefined);
  }
}
