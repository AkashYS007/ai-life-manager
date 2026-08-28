import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UsersService } from '../../users/users.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { AuthContext } from '../../auth/auth-context';

// Per-user monthly AI spend cap enforcement (performance/scalability pass,
// 2026-08-28). Deliberately a separate guard from GqlThrottlerGuard, not a
// second concern bolted onto it: throttling limits *rate* (calls/minute,
// protects against a hot loop or runaway retry), this limits *spend over a
// month*, and the two should be free to evolve independently (e.g. a higher
// per-minute rate limit but a much stricter monthly cap). Applied alongside
// GqlThrottlerGuard on the same handful of AI-calling mutations/queries via
// `@UseGuards(GqlThrottlerGuard, AiBudgetGuard)`.
//
// Runs after AuthGuard (registered globally in app.module.ts) has already
// populated `request.authContext`, but that context only carries
// `{authProviderId, email}` — not this app's own `User.id`, which is what
// AiUsageEvent.userId actually stores (see AuthGuard's own comment on this
// split). So, same as every resolver body already does, this guard calls
// `usersService.getOrCreateFromAuth(auth)` itself to resolve the real user
// row before checking its spend.
@Injectable()
export class AiBudgetGuard implements CanActivate {
  constructor(
    private readonly usersService: UsersService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context);
    const request = gqlContext.getContext().req;
    const auth = request?.authContext as AuthContext | undefined;

    // AuthGuard already runs first (registered globally) and would have
    // thrown before this guard ever ran if auth were genuinely missing —
    // this is defense-in-depth, not the primary auth check.
    if (!auth) {
      return true;
    }

    const user = await this.usersService.getOrCreateFromAuth(auth);
    const overBudget = await this.aiUsage.isOverBudget(user.id);
    if (overBudget) {
      throw new ForbiddenException(
        "You've reached this month's AI usage limit. It resets on a rolling 30-day basis — please try again later.",
      );
    }
    return true;
  }
}
