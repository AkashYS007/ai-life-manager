import { Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiUsageResolver } from './ai-usage.resolver';
import { UsersModule } from '../users/users.module';

// AI cost telemetry increment (2026-08-25). Exported (not just declared) so
// every module that calls a real AnthropicClient method — JournalModule,
// PlannerModule, ChatModule, RecommendationsModule, ReflectionModule — can
// import this and inject AiUsageService the same way PlannerModule already
// exports AnthropicClient for the same reason.
@Module({
  imports: [UsersModule],
  providers: [AiUsageService, AiUsageResolver],
  exports: [AiUsageService],
})
export class AiUsageModule {}
