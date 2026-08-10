import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsResolver } from './analytics.resolver';
import { UsersModule } from '../users/users.module';
import { SignalsModule } from '../signals/signals.module';
import { HabitsModule } from '../habits/habits.module';
import { RoutinesModule } from '../routines/routines.module';
import { TasksModule } from '../tasks/tasks.module';
import { FocusModule } from '../focus/focus.module';
import { JournalModule } from '../journal/journal.module';

// A pure "leaf" consumer module — imports existing domain modules purely for
// their services (SignalsService, HabitsService, RoutinesService, and now
// TasksService/FocusService/JournalService for the Insights trends
// increment) and reads from them, but nothing else in the app has any
// reason to import AnalyticsModule back, so there's no module-cycle risk to
// reason about here the way PlannerModule/TasksModule/CalendarModule's
// mutual dependencies required careful checking.
@Module({
  imports: [UsersModule, SignalsModule, HabitsModule, RoutinesModule, TasksModule, FocusModule, JournalModule],
  providers: [AnalyticsService, AnalyticsResolver],
})
export class AnalyticsModule {}
