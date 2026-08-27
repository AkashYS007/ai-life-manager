import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SignalsModule } from '../signals/signals.module';
import { MemoryModule } from '../memory/memory.module';
import { HabitsModule } from '../habits/habits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AnthropicClient } from './anthropic-client';
import { PlannerService } from './planner.service';
import { PlannerResolver } from './planner.resolver';
import { PlanGenerationService } from './plan-generation.service';
import { PlanResponseService } from './plan-response.service';
import { PlannerAutoReplanListener } from './plan-auto-replan.listener';

@Module({
  imports: [
    UsersModule,
    TasksModule,
    CalendarModule,
    SignalsModule,
    MemoryModule,
    HabitsModule,
    NotificationsModule,
    AiUsageModule,
  ],
  // planner.service.ts modularization increment (2026-08-26): the three new
  // focused services are internal-only collaborators of PlannerService (and,
  // for PlanGenerationService, of PlannerAutoReplanListener too) — nothing
  // outside this module injects them directly, so only PlannerService and
  // AnthropicClient are exported below, unchanged from before this split.
  providers: [
    AnthropicClient,
    PlannerService,
    PlannerResolver,
    PlanGenerationService,
    PlanResponseService,
    PlannerAutoReplanListener,
  ],
  // AnthropicClient is exported (not just PlannerService) so ChatModule can
  // import this module and share the exact same singleton instance/token,
  // rather than each module registering its own independent copy — that
  // matters for e2e tests, where overriding AnthropicClient with a fake
  // needs to unambiguously replace the one true provider everywhere it's
  // injected, not just wherever Nest happens to resolve first.
  exports: [PlannerService, AnthropicClient],
})
export class PlannerModule {}
