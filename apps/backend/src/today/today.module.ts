import { Module } from '@nestjs/common';
import { TodayResolver } from './today.resolver';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SignalsModule } from '../signals/signals.module';
import { PlannerModule } from '../planner/planner.module';
import { HabitsModule } from '../habits/habits.module';

@Module({
  imports: [UsersModule, TasksModule, CalendarModule, SignalsModule, PlannerModule, HabitsModule],
  providers: [TodayResolver],
})
export class TodayModule {}
