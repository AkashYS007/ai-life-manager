import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsResolver } from './recommendations.resolver';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SignalsModule } from '../signals/signals.module';
import { HabitsModule } from '../habits/habits.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FocusModule } from '../focus/focus.module';

// Same shape as PlannerModule's own imports list (TasksModule, CalendarModule,
// SignalsModule, HabitsModule, MemoryModule) since this feature needs the
// same real-data context PlannerService's prompt does — plus PlannerModule
// itself, imported only for its exported AnthropicClient singleton (the
// shared-instance-for-e2e-overrideProvider reasoning every AI-feature module
// comment in this app repeats), and NotificationsModule for the Smart
// notifications increment's recommendations_ready trigger. FocusModule is
// new as of the AI recommendations acting on your behalf increment —
// RecommendationsService.actOn starts a real BREAK focus session for a
// BREAK-category recommendation, reusing FocusService.start rather than
// duplicating its one-active-session-at-a-time guard. No cycle: none of
// these modules have any reason to import RecommendationsModule back.
@Module({
  imports: [
    UsersModule,
    TasksModule,
    CalendarModule,
    SignalsModule,
    HabitsModule,
    MemoryModule,
    PlannerModule,
    NotificationsModule,
    FocusModule,
  ],
  providers: [RecommendationsService, RecommendationsResolver],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
