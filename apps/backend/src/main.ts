import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

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

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  Logger.log(`AI Life Manager backend listening on :${port}`, 'Bootstrap');
  Logger.log(`GraphQL playground: http://localhost:${port}/graphql`, 'Bootstrap');
}

bootstrap();
