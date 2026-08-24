import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { resolveAuthContext } from './auth/resolve-auth-context';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TodayModule } from './today/today.module';
import { TasksModule } from './tasks/tasks.module';
import { CalendarModule } from './calendar/calendar.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SignalsModule } from './signals/signals.module';
import { MemoryModule } from './memory/memory.module';
import { PlannerModule } from './planner/planner.module';
import { HabitsModule } from './habits/habits.module';
import { ChatModule } from './chat/chat.module';
import { FocusModule } from './focus/focus.module';
import { JournalModule } from './journal/journal.module';
import { ReflectionModule } from './reflection/reflection.module';
import { RoutinesModule } from './routines/routines.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health/health.controller';
import { GraphqlExceptionFilter } from './common/filters/graphql-exception.filter';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    // Activates every `@Cron` decorator app-wide (see scheduler.module.ts's
    // SchedulerService) — the in-process stand-in for the Architecture
    // Document's Temporal-based durable-workflow design, see that file's
    // own comment for the full reasoning.
    ScheduleModule.forRoot(),
    // Registered as a global module by the package itself (same "forRoot
    // once, usable everywhere with no further imports" shape as
    // ConfigModule) — powers `EventEmitter2`/`@OnEvent`, the mechanism
    // Automatic AI re-planning uses to trigger PlannerService from
    // TasksService/CalendarService without either module importing
    // PlannerModule directly, which would be circular (PlannerModule
    // already imports both — see planner.module.ts).
    EventEmitterModule.forRoot(),
    // Rate limiting increment (backend review follow-up, 2026-08-24): a
    // single named 'default' throttler, applied *only* where explicitly
    // decorated with `@Throttle()` + `@UseGuards(GqlThrottlerGuard)` — the
    // handful of AI-calling mutations/queries the audit flagged as real,
    // billed, currently-unbounded external API calls (PlannerResolver's
    // requestReplan/estimateTaskDuration, ChatResolver's
    // sendChatMessage/sendChatMessageStreaming,
    // RecommendationsResolver's generateRecommendations). Deliberately not
    // registered as a global APP_GUARD: this app's ordinary read queries
    // and cheap writes were never the cost/abuse risk the audit raised,
    // and blanket-throttling everything (including the graphql-ws
    // subscription transport, which has no per-request req/res cycle to
    // throttle the same way) is a much larger, riskier surface to get
    // right than gating the small number of endpoints that actually call
    // out to Anthropic.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }]),
    // forRootAsync (not the plain forRoot every other increment's own
    // comments here used to describe) specifically so `onConnect` below can
    // inject the real ConfigService — needed to resolve AUTH_MODE/
    // CLERK_SECRET_KEY for a WebSocket connection the exact same way
    // AuthGuard already does for a plain HTTP request (see
    // resolveAuthContext, the one function both paths now share).
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      // @nestjs/graphql v12's forRootAsync reads `driver` off this top-level
      // options object directly (GraphQLModule.assertDriver, and the
      // `useClass: options.driver` provider registration right below it in
      // the installed package) — NOT off whatever useFactory returns below.
      // The copy inside useFactory's returned object is still required too
      // (it's real ApolloDriverConfig, consumed by the driver instance
      // itself once constructed) but is not, on its own, what satisfies
      // this assertion. Discovered when @nestjs/graphql's installed patch
      // version in this environment enforces this more strictly than an
      // earlier one apparently did — a latent bug in this file that
      // predates this increment, fixed here since it was blocking every
      // e2e test in the suite, not just the new habit-recurrence ones.
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        driver: ApolloDriver,
        // Code-first: the SDL in the API Design Document is generated from
        // these TypeScript decorators rather than hand-maintained separately,
        // so the schema and the resolver implementation can never drift apart.
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        sortSchema: true,
        // Real-time chat streaming increment: a genuine graphql-ws
        // WebSocket server, bound onto this same HTTP server/port — not a
        // second process, not a hosted pub/sub service, the same
        // "simplest correct in-process equivalent, no new infrastructure"
        // discipline SchedulerService's own comment already established for
        // @Cron standing in for Temporal. `onConnect` runs once, at socket
        // handshake time, and authenticates the connection using the exact
        // same two-strategy check (dev header / real Clerk token) a normal
        // HTTP request goes through in AuthGuard — just reading from the
        // client's `connectionParams` instead of real HTTP headers, since a
        // WebSocket connection has no headers of its own past the initial
        // upgrade request. Throwing here rejects the connection outright
        // before any subscription on it is ever allowed to start.
        subscriptions: {
          'graphql-ws': {
            onConnect: async (context: { connectionParams?: Record<string, unknown>; extra: unknown }) => {
              const { connectionParams, extra } = context;
              (extra as Record<string, unknown>).authContext = await resolveAuthContext(
                connectionParams ?? {},
                config.get<string>('AUTH_MODE'),
                config,
              );
            },
          },
        },
        // Normalizes both transports into the one shape every resolver,
        // AuthGuard, and CurrentAuth already read from (`context.req.
        // authContext`) — a plain HTTP request already has a real `req`; a
        // WebSocket subscription has no `req` at all, only whatever
        // `onConnect` stashed on `extra` above, so it's reshaped here into
        // a minimal fake `req` carrying just the one field anything
        // downstream actually needs. This is the one seam that lets
        // AuthGuard/CurrentAuth stay completely transport-agnostic — see
        // AuthGuard's own short-circuit comment for the other half of this.
        context: ({ req, extra }: { req?: unknown; extra?: { authContext?: unknown } }) =>
          req ? { req } : { req: { headers: {}, authContext: extra?.authContext } },
      }),
    }),
    UsersModule,
    TasksModule,
    CalendarModule,
    IntegrationsModule,
    SignalsModule,
    MemoryModule,
    PlannerModule,
    HabitsModule,
    ChatModule,
    FocusModule,
    JournalModule,
    ReflectionModule,
    RoutinesModule,
    RecommendationsModule,
    NotificationsModule,
    PushModule,
    OnboardingModule,
    SchedulerModule,
    AnalyticsModule,
    TodayModule,
    BillingModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GraphqlExceptionFilter,
    },
    // Global-auth-by-default hardening (backend review follow-up,
    // 2026-08-24): previously AuthGuard was opt-in, applied per-resolver
    // via `@UseGuards(AuthGuard)` (21/22 resolvers already had it — the
    // sole exception, SubscriptionResolver, is a safe `@ResolveField` that
    // only ever runs against an already-authorized parent object, per the
    // architecture audit). Registering it here too means a *new* resolver
    // is Clerk-gated automatically even if that decorator is forgotten —
    // see AuthGuard's own comment for why this is still safe for the
    // app's REST webhook/OAuth-callback surface.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
