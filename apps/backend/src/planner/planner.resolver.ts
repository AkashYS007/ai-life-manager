import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { GqlThrottlerGuard } from '../common/guards/gql-throttler.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { AiPlanRun, PlanRunDecision, PlanScope } from './models/ai-plan-run.model';
import { RequestReplanPayload, RespondToPlanRunPayload } from './models/plan-run.payload';
import { PlanChangeEditInput } from './dto/plan-change-edit.input';
import { PlanChangeAddInput } from './dto/plan-change-add.input';
import { PlannerService } from './planner.service';

@Resolver()
@UseGuards(AuthGuard)
export class PlannerResolver {
  constructor(
    private readonly plannerService: PlannerService,
    private readonly usersService: UsersService,
  ) {}

  // Weekly/monthly AI plan generation increment: `scope` is optional and
  // defaults to DAY, so this query behaves exactly as it did before this
  // increment for any caller that doesn't pass it — the Today screen's
  // nested todayPlan.latestPlanRun field resolver (today.resolver.ts) calls
  // PlannerService.getLatest the same way, unaffected.
  @Query(() => AiPlanRun, { nullable: true })
  async latestPlanRun(
    @CurrentAuth() auth: AuthContext,
    @Args('scope', { type: () => PlanScope, nullable: true }) scope?: PlanScope,
  ): Promise<AiPlanRun | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.plannerService.getLatest(user.id, scope ?? PlanScope.DAY);
  }

  // Task duration estimation increment: a best-effort suggestion for the
  // duration field on task create/edit — returns null rather than an error
  // if AI isn't configured or the response can't be trusted, so the
  // frontend can just leave the field for manual entry with no special
  // error-handling branch needed.
  //
  // `title`/`description` are plain scalar args, not a class-validator DTO
  // (unlike CreateTaskInput.title's own @Length(1, 200)), so the global
  // ValidationPipe never sees them — the length caps below are the only
  // bound on what reaches the Anthropic prompt. Kept generous relative to
  // CreateTaskInput's own 200-char title cap (this query can legitimately
  // be called with a title that hasn't been saved/validated as a real task
  // yet) but not unbounded — matches this query's own "fail soft, return
  // null" design (backend review follow-up, 2026-08-24 — AI/planner audit
  // finding: unvalidated, unbounded args feeding directly into an LLM call).
  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Query(() => Int, { nullable: true })
  async estimateTaskDuration(
    @CurrentAuth() auth: AuthContext,
    @Args('title') title: string,
    @Args('description', { nullable: true }) description?: string,
  ): Promise<number | null> {
    if (title.length > 300 || (description?.length ?? 0) > 3000) {
      return null;
    }
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.plannerService.estimateDuration(user.id, title, description);
  }

  // Rate limiting increment (backend review follow-up, 2026-08-24 — AI/
  // planner audit finding: no cost controls on any AI-calling endpoint).
  // The service layer's own comment already documents that a manual
  // button-press replan is deliberately never throttled at the domain
  // level (a person should always be able to ask for a fresh plan) — this
  // is the outer bound instead: 10/min is far above any real usage
  // pattern (nobody presses "regenerate my plan" more than a couple of
  // times a minute) while still closing the unbounded-loop/scripted-abuse
  // gap the audit raised.
  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => RequestReplanPayload)
  async requestReplan(
    @CurrentAuth() auth: AuthContext,
    @Args('scope', { type: () => PlanScope, nullable: true }) scope?: PlanScope,
  ): Promise<RequestReplanPayload> {
    if (!this.plannerService.isConfigured()) {
      return {
        errors: [
          {
            code: 'AI_NOT_CONFIGURED',
            message: 'AI plan generation needs an Anthropic API key configured on the server first (see README).',
          },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const planRun = await this.plannerService.requestReplan(user.id, user.timezone, scope ?? PlanScope.DAY);
      return { planRun, errors: [] };
    } catch (error) {
      if ((error as Error).message === 'NOTHING_TO_PLAN') {
        return {
          errors: [
            { code: 'NOTHING_TO_PLAN', message: "You don't have any open tasks to schedule right now." },
          ],
        };
      }
      return {
        errors: [{ code: 'REPLAN_FAILED', message: "We couldn't generate a plan. Try again." }],
      };
    }
  }

  @Mutation(() => RespondToPlanRunPayload)
  async respondToPlanRun(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('decision', { type: () => PlanRunDecision }) decision: PlanRunDecision,
    // Editing a proposed AI plan increment: only meaningful when
    // decision === EDIT — ACCEPT/REJECT both ignore it entirely (the
    // service layer's ACCEPT/REJECT branches never look at this
    // parameter), so passing it alongside either of those is harmless, not
    // an error.
    @Args('edits', { type: () => [PlanChangeEditInput], nullable: true }) edits?: PlanChangeEditInput[],
    // Free-form plan editing increment: same "only meaningful when
    // decision === EDIT" rule as `edits` above — see PlanChangeAddInput's
    // own comment for why this needs its own input shape rather than
    // reusing PlanChangeEditInput (there's no existing PlanChange.id to
    // reference for a task the AI never proposed).
    @Args('adds', { type: () => [PlanChangeAddInput], nullable: true }) adds?: PlanChangeAddInput[],
  ): Promise<RespondToPlanRunPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const planRun = await this.plannerService.respondToPlanRun(user.id, id, decision, edits ?? [], adds ?? []);
      return { planRun, errors: [] };
    } catch (error) {
      if ((error as Error).message === 'ALREADY_RESPONDED') {
        return {
          errors: [{ code: 'ALREADY_RESPONDED', message: 'This plan was already responded to.' }],
        };
      }
      return {
        errors: [{ code: 'RESPOND_FAILED', message: "We couldn't save your response. Try again." }],
      };
    }
  }
}
