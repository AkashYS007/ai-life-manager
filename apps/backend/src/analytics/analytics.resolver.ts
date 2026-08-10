import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { AnalyticsSummary } from './models/analytics-summary.model';
import { AnalyticsService } from './analytics.service';

// Same ownership discipline as every other resolver in this app: resolve
// the internal users.id first, never scope by the raw auth identity.
@Resolver()
@UseGuards(AuthGuard)
export class AnalyticsResolver {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly usersService: UsersService,
  ) {}

  // `days` is optional and clamped server-side (7-90, defaulting to 30 —
  // see AnalyticsService) rather than trusted as-given, same "never trust a
  // client-supplied number without a sane bound" discipline pagination args
  // elsewhere in this app already follow (see e.g. TasksService.listConnection's
  // `Math.min(args.first ?? 20, 100)`).
  @Query(() => AnalyticsSummary)
  async analyticsSummary(
    @CurrentAuth() auth: AuthContext,
    @Args('days', { type: () => Int, nullable: true }) days?: number,
  ): Promise<AnalyticsSummary> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.analyticsService.getSummary(user.id, user.timezone, days);
  }
}
