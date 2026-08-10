import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MemoryModule } from '../memory/memory.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingResolver } from './onboarding.resolver';

// UsersModule + MemoryModule, same two-import shape as RoutinesModule and
// RecommendationsModule needing more than one collaborator. No cycle risk:
// MemoryModule itself only imports UsersModule (never the other way, and
// never this module), so both edges here point safely inward.
@Module({
  imports: [UsersModule, MemoryModule],
  providers: [OnboardingService, OnboardingResolver],
})
export class OnboardingModule {}
