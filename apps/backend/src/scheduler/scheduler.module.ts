import { Module } from '@nestjs/common';
import { RoutinesModule } from '../routines/routines.module';
import { ReflectionModule } from '../reflection/reflection.module';
import { HabitsModule } from '../habits/habits.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SchedulerService } from './scheduler.service';

// A pure consumer, same "leaf" shape as PlannerModule/RecommendationsModule
// — imports six existing modules for their services (IntegrationsModule
// added by the Real-time calendar updates (webhooks) increment, for the new
// renewCalendarWebhooks cron job; RecommendationsModule added by the
// Automatic daily AI recommendations increment, so checkRemindersForUser can
// call RecommendationsService.generate/getToday directly), exports nothing
// and is never imported by anything else, so there's no cycle risk no
// matter how many more reminder types get added here later.
// `ScheduleModule.forRoot()` itself (the thing that actually activates
// `@Cron` decorators app-wide) is registered once in AppModule, not here —
// this module only owns its own concrete cron jobs.
@Module({
  imports: [
    RoutinesModule,
    ReflectionModule,
    HabitsModule,
    NotificationsModule,
    IntegrationsModule,
    RecommendationsModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
