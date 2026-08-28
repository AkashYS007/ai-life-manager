import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { reportError } from '../sentry';

// Anything that reaches here is, by definition, not an expected UserError
// (those are returned as normal payload values by resolvers — see
// UserError above) — so every error caught here is logged with full detail
// server-side and returned to the client as a generic, safe message. This is
// the boundary described in API Design Document §9's "system / unexpected"
// error row.
@Catch()
export class GraphqlExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GraphQL');

  catch(exception: unknown, _host: ArgumentsHost): GraphQLError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 401 || status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST';
      this.logger.warn(`${code}: ${exception.message}`);
      return new GraphQLError(exception.message, { extensions: { code } });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : exception);
    // Deployment-maturity pass (2026-08-27): report to Sentry (a no-op
    // when SENTRY_DSN isn't set) — this is genuinely the "unexpected" bucket
    // this filter's own comment describes, the exact class of error the
    // scorecard's "no monitoring/alerts" finding was about.
    reportError(exception);
    return new GraphQLError('Something went wrong on our end. Please try again.', {
      extensions: { code: 'INTERNAL_ERROR' },
    });
  }
}
