import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

// Rate limiting on the AI-calling mutations/queries (backend review
// follow-up, 2026-08-24 — see AI/planner audit finding "no cost controls on
// any AI-calling endpoint"): @nestjs/throttler's own ThrottlerGuard reads
// the request/response off `context.switchToHttp()` by default, which is
// the right call for a plain REST controller but not reliably so for a
// resolver running through the Apollo GraphQL driver — this app already
// has its own normalized GraphQL context shape (`context.req`, built in
// app.module.ts's GraphQLModule factory, the same one AuthGuard/
// @CurrentAuth() read from) precisely to be transport-agnostic, so this
// guard reads from that instead of guessing whether switchToHttp() lines
// up correctly here.
//
// That normalized context only ever carries `req`, never `res` (see the
// context factory's own comment for why) — but ThrottlerGuard's
// handleRequest() unconditionally calls `res.header(...)` to set
// X-RateLimit-* response headers on every check, throttled or not. A bare
// `{}` would throw on the very first request through a decorated resolver.
// Since nothing in this app reads those headers back today (a GraphQL
// error response doesn't surface HTTP response headers to the client the
// way a REST 429 would), a no-op stand-in is the correct fix here, not a
// gap to close — it lets the guard do its real job (counting requests,
// blocking over-limit ones) without requiring a real Express `res` to
// exist in a context shape that deliberately doesn't carry one.
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') return true;
    return super.canActivate(context);
  }

  getRequestResponse(context: ExecutionContext): { req: Record<string, unknown>; res: { header: () => void } } {
    const gqlContext = GqlExecutionContext.create(context).getContext<{ req?: Record<string, unknown> }>();
    const req = gqlContext.req ?? {};
    return { req, res: { header: () => undefined } };
  }
}
