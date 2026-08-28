import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { initSentry, reportError } from './common/sentry';

async function bootstrap() {
  // `rawBody: true` — real Stripe billing integration. Stripe's webhook
  // signature check (StripeService.constructWebhookEvent) needs the exact
  // raw request bytes, not the JSON Nest's global body parser would
  // otherwise produce — even one re-serialized whitespace difference
  // breaks the HMAC. This one flag makes Nest additionally stash the raw
  // Buffer on `req.rawBody` for every request (only the webhook controller
  // ever reads it) while leaving normal JSON body parsing for every other
  // route completely unchanged.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // Optional error monitoring (2026-08-27) — a no-op when SENTRY_DSN isn't
  // set, same as every other optional integration in this app. GraphQL
  // resolver errors are reported via the `formatError` hook on the
  // GraphQLModule below (Nest's global exception filters don't reliably
  // intercept those); this call also covers uncaught errors from process
  // start itself, before any request-scoped handling exists yet.
  initSentry(config.get<string>('SENTRY_DSN'));

  process.on('unhandledRejection', (reason) => {
    reportError(reason);
    Logger.error('Unhandled promise rejection', reason instanceof Error ? reason.stack : String(reason), 'Bootstrap');
  });

  // CORS fix (2026-08-24, backend audit Update 49 finding #2): this used to
  // be `{ origin: true, credentials: true }`, which reflects *any* request's
  // Origin header back as the allowed origin — combined with
  // `credentials: true`, that let literally any website make an
  // authenticated cross-origin request against this API and have the
  // browser honor it. FRONTEND_URL already existed in config (used
  // correctly elsewhere for OAuth redirects) but was never wired into CORS
  // at all. Comma-separated so both the apex and `www` domains (or a
  // staging + prod pair) can be allowed at once without a code change —
  // matches the "update FRONTEND_URL to the new domains" item already
  // queued in the roadmap. Requests with no Origin header (server-to-server
  // calls, curl, most non-browser HTTP clients) have nothing to check
  // against an allowlist and are let through unchanged from before this fix.
  const allowedOrigins = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  Logger.log(`AI Life Manager backend listening on :${port}`, 'Bootstrap');
  Logger.log(`GraphQL playground: http://localhost:${port}/graphql`, 'Bootstrap');
}

bootstrap();
