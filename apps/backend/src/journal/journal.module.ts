import { Module } from '@nestjs/common';
import { JournalService } from './journal.service';
import { JournalResolver } from './journal.resolver';
import { UsersModule } from '../users/users.module';
import { PlannerModule } from '../planner/planner.module';
import { MemoryModule } from '../memory/memory.module';

// Journal sentiment analysis increment. PlannerModule (for AnthropicClient)
// and MemoryModule (for MemoryService) are imported the same way
// ReflectionModule already imports PlannerModule for its own AI summary
// call — see that module's own comment for why importing PlannerModule
// rather than declaring a second AnthropicClient provider here is the right
// call (e2e tests override the one real provider instance app-wide).
@Module({
  imports: [UsersModule, PlannerModule, MemoryModule],
  providers: [JournalService, JournalResolver],
  exports: [JournalService],
})
export class JournalModule {}
