import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesResolver } from './routines.resolver';
import { UsersModule } from '../users/users.module';
import { CalendarModule } from '../calendar/calendar.module';
import { PlannerModule } from '../planner/planner.module';

// Imports PlannerModule (not a standalone AnthropicClient provider) for the
// same reason ReflectionModule does — see that module's comment. Imports
// CalendarModule for CalendarService, used only to look up today's first
// meeting when a routine is AI-sequenced (RoutinesService.hydrateForToday).
@Module({
  imports: [UsersModule, CalendarModule, PlannerModule],
  providers: [RoutinesService, RoutinesResolver],
  exports: [RoutinesService],
})
export class RoutinesModule {}
