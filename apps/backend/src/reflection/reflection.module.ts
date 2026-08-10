import { Module } from '@nestjs/common';
import { ReflectionService } from './reflection.service';
import { ReflectionResolver } from './reflection.resolver';
import { UsersModule } from '../users/users.module';
import { PlannerModule } from '../planner/planner.module';

// Imports PlannerModule (rather than declaring its own AnthropicClient
// provider) specifically to share the exact same singleton instance/token —
// see PlannerModule's own comment on why it exports AnthropicClient: e2e
// tests override it with a fake, and that override needs to unambiguously
// replace the one true provider everywhere it's injected, this module
// included, not just wherever Nest happens to resolve first.
@Module({
  imports: [UsersModule, PlannerModule],
  providers: [ReflectionService, ReflectionResolver],
  exports: [ReflectionService],
})
export class ReflectionModule {}
