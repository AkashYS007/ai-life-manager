import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { GqlThrottlerGuard } from '../common/guards/gql-throttler.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { FocusSessionAlreadyActiveError } from '../focus/focus.service';
import { AiRecommendationRun } from './models/recommendation.model';
import { RecommendationRunPayload, ActOnRecommendationPayload } from './models/recommendation.payload';
import { ActOnRecommendationInput } from './dto/act-on-recommendation.input';
import {
  RecommendationsService,
  RecommendationNotFoundError,
  RecommendationAlreadyHandledError,
} from './recommendations.service';

@Resolver(() => AiRecommendationRun)
@UseGuards(AuthGuard)
export class RecommendationsResolver {
  constructor(
    private readonly recommendationsService: RecommendationsService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => AiRecommendationRun, { nullable: true })
  async todayRecommendations(@CurrentAuth() auth: AuthContext): Promise<AiRecommendationRun | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.recommendationsService.getToday(user.id, user.timezone);
  }

  // Rate limiting increment (backend review follow-up, 2026-08-24 — AI/
  // planner audit finding: no cost controls on any AI-calling endpoint).
  // Same reasoning as PlannerResolver.requestReplan — a real, billed
  // Anthropic call with no other cap in the stack; 10/min is far above any
  // real "refresh my recommendations" usage pattern.
  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => RecommendationRunPayload)
  async generateRecommendations(@CurrentAuth() auth: AuthContext): Promise<RecommendationRunPayload> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    try {
      const recommendationRun = await this.recommendationsService.generate(user.id, user.timezone);
      return { recommendationRun, errors: [] };
    } catch (error) {
      if ((error as Error).message === 'AI_NOT_CONFIGURED') {
        return {
          errors: [
            {
              code: 'AI_NOT_CONFIGURED',
              message: 'AI recommendations need an Anthropic API key configured on the server first (see README).',
            },
          ],
        };
      }
      return {
        errors: [{ code: 'GENERATE_FAILED', message: "We couldn't get recommendations right now. Try again." }],
      };
    }
  }

  @Mutation(() => RecommendationRunPayload)
  async dismissRecommendation(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<RecommendationRunPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const recommendationRun = await this.recommendationsService.dismiss(user.id, user.timezone, id);
      return { recommendationRun, errors: [] };
    } catch {
      return {
        errors: [{ code: 'DISMISS_FAILED', message: "We couldn't dismiss that recommendation. Try again." }],
      };
    }
  }

  // AI recommendations acting on your behalf increment. `input` (Customize
  // act-on defaults at the point of acting increment) is optional — omitted
  // entirely, this is byte-for-byte the same mutation call it always was.
  @Mutation(() => ActOnRecommendationPayload)
  async actOnRecommendation(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input', { nullable: true }) input?: ActOnRecommendationInput,
  ): Promise<ActOnRecommendationPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const result = await this.recommendationsService.actOn(user.id, user.timezone, id, input);
      return { ...result, errors: [] };
    } catch (error) {
      if (error instanceof RecommendationNotFoundError) {
        return { errors: [{ code: 'NOT_FOUND', message: error.message }] };
      }
      if (error instanceof RecommendationAlreadyHandledError) {
        return { errors: [{ code: 'ALREADY_HANDLED', message: error.message }] };
      }
      if (error instanceof FocusSessionAlreadyActiveError) {
        return { errors: [{ code: 'ALREADY_ACTIVE', message: error.message }] };
      }
      return {
        errors: [{ code: 'ACT_FAILED', message: "We couldn't do that right now. Try again." }],
      };
    }
  }
}
