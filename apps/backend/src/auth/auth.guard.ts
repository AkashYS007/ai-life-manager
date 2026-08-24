import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { resolveAuthContext } from './resolve-auth-context';

// Single guard, two verification strategies, selected by AUTH_MODE — never by
// which header happens to be present, so a request can't choose its own
// trust level.
//
// AUTH_MODE=clerk (required whenever NODE_ENV=production, enforced in
// config/env.validation.ts): verifies a real Clerk session JWT via Clerk's
// JWKS. This is the only path that ever runs in production.
//
// AUTH_MODE=dev: accepts a plain `x-dev-user-email` header. This exists so
// the API can be exercised locally and in CI/sandbox environments without a
// live Clerk project, exactly the way a real engineering team would run
// integration tests against auth-gated endpoints. It is not reachable in
// production — env.validation.ts refuses to boot with AUTH_MODE=dev and
// NODE_ENV=production at the same time.
@Injectable()
  export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

constructor(private readonly config: ConfigService) {}

async canActivate(context: ExecutionContext): Promise<boolean> {
  // Global-auth-by-default hardening (backend review follow-up,
  // 2026-08-24): this guard is now registered app-wide via APP_GUARD in
  // app.module.ts, so every *new* resolver is Clerk-gated automatically
  // even if someone forgets to add `@UseGuards(AuthGuard)` to it — the
  // existing per-resolver decorators become redundant-but-harmless
  // defense-in-depth rather than the only thing standing between a new
  // resolver and being unintentionally public.
  //
  // Being genuinely global means this guard now also runs in front of
  // the app's small REST surface — the health check, the Stripe webhook,
  // and the Google/Microsoft OAuth-callback and calendar-webhook
  // controllers — none of which carry (or should carry) a Clerk session:
  // each of those already has its own real verification (a signed
  // webhook secret, an OAuth `state` param, or nothing at all for
  // /health, which Railway's own infrastructure polls unauthenticated).
  // `context.getType()` is NestJS's own stable way to tell "this is a
  // GraphQL operation" (query/mutation/subscription, over either the
  // plain HTTP or graphql-ws transport — both report as 'graphql') apart
  // from "this is a plain REST controller" ('http') — so a REST request
  // falls through untouched here, preserving every one of those
  // controllers' exact current, intentionally-public behavior.
  //
  // The base `ExecutionContext.getType()` (from @nestjs/common) is typed
  // generically over `ContextType = 'http' | 'ws' | 'rpc'`, which doesn't
  // include 'graphql' at all — comparing against the literal 'graphql'
  // with no type argument is a TS2367 compile error (the two types have
  // no overlap), not just a style nit. `@nestjs/graphql` exports its own
  // `GqlContextType = 'graphql' | ContextType` specifically for this
  // check, and `getType` is generic (`getType<TContext extends string =
  // ContextType>()`) precisely so callers can supply it — confirmed by
  // reading both packages' own .d.ts declarations directly rather than
  // assuming, given this session's own earlier lesson about not shipping
  // a plausible-but-unverified assumption into production.
  if (context.getType<GqlContextType>() !== 'graphql') {
    return true;
  }

  const gqlContext = GqlExecutionContext.create(context);
  const request = gqlContext.getContext().req;

  // Real-time chat streaming increment: a GraphQL subscription arrives
  // over the graphql-ws WebSocket connection, not a plain HTTP request —
  // app.module.ts's own `onConnect` already ran this exact same
  // resolveAuthContext check once, at connection time, against the
  // socket's `connectionParams`, and stashed the result here (see that
  // file's `context` factory, which normalizes both transports into this
  // same `request.authContext` shape). Re-deriving it a second time from
  // `request.headers` would fail outright — a WS connection has no real
  // HTTP headers to read — so this guard simply trusts work already done,
  // the same "don't re-verify what's already verified" principle a
  // resolver applies to `@CurrentAuth()` itself.
  if (request.authContext) {
    return true;
  }

  try {
    const authContext = await resolveAuthContext(
      request.headers,
      this.config.get<string>('AUTH_MODE'),
      this.config,
      );
    request.authContext = authContext;
    return true;
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw error;
    }
    this.logger.warn(`Clerk token verification failed: ${(error as Error).message}`);
    throw new UnauthorizedException('Invalid or expired session token');
  }
}
}
