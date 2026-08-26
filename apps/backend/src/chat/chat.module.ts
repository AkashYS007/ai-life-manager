import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { ChatService } from './chat.service';
import { ChatResolver } from './chat.resolver';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SignalsModule } from '../signals/signals.module';
import { PlannerModule } from '../planner/planner.module';
import { MemoryModule } from '../memory/memory.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

// Imports PlannerModule to reuse its exported AnthropicClient singleton
// (the shared, stateless, low-level Anthropic API wrapper) rather than
// declaring a second independent provider — one true instance/token for
// the whole app, which is also what lets e2e tests override it in one
// place and have that apply everywhere it's injected. MemoryModule is
// imported directly (not transitively through PlannerModule, which doesn't
// re-export it) since ChatService needs MemoryService too.
//
// PUB_SUB (Real-time chat streaming increment): a plain in-memory
// `graphql-subscriptions` PubSub, not Redis or any other external
// broker — same "simplest correct in-process equivalent, no new
// infrastructure" choice this codebase already made for the scheduler
// (`@Cron` standing in for Temporal) and for notifications (best-effort
// direct delivery standing in for a real dispatcher). The real, named
// limitation that comes with that choice: this only works correctly
// running as a single backend instance — a chunk published on one process
// is invisible to a subscription connected to another, so running more
// than one instance behind a load balancer would silently drop mid-stream
// chunks for whichever half of a conversation lands on the "wrong" one.
// Fine at this project's current scale, exactly as real and exactly as
// out-of-scope-for-now as the equivalent caveat already written down for
// the scheduler.
@Module({
  imports: [UsersModule, TasksModule, CalendarModule, SignalsModule, PlannerModule, MemoryModule, AiUsageModule],
  providers: [ChatService, ChatResolver, { provide: 'PUB_SUB', useValue: new PubSub() }],
  exports: [ChatService],
})
export class ChatModule {}
