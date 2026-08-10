import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';
import { GoalsService } from './goals.service';
import { GoalsResolver } from './goals.resolver';
import { UsersModule } from '../users/users.module';
import { MemoryModule } from '../memory/memory.module';

// MemoryModule import is new as of the Task duration estimation increment —
// TasksService.complete() refreshes the task_duration_accuracy AI Memory
// signal (best-effort) right when a real actual-vs-estimated data point
// exists. Safe direction-wise: MemoryModule only imports UsersModule, so
// this doesn't create the cycle PlannerModule importing TasksModule would
// (the AI *estimate* itself lives in PlannerService instead, precisely to
// avoid that cycle — see planner.service.ts's estimateDuration).
@Module({
  imports: [UsersModule, MemoryModule],
  providers: [TasksService, TasksResolver, GoalsService, GoalsResolver],
  exports: [TasksService, GoalsService],
})
export class TasksModule {}
