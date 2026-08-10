import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
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
