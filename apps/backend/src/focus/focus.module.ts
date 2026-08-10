import { Module } from '@nestjs/common';
import { FocusService } from './focus.service';
import { FocusResolver } from './focus.resolver';
import { UsersModule } from '../users/users.module';
import { MemoryModule } from '../memory/memory.module';

// MemoryModule import is new as of the Chronotype AI Memory signal
// increment — FocusService.complete() refreshes the chronotype fact
// best-effort right when a completed session gives fresh data to compute
// it from. No cycle risk: MemoryModule only imports UsersModule.
@Module({
  imports: [UsersModule, MemoryModule],
  providers: [FocusService, FocusResolver],
  exports: [FocusService],
})
export class FocusModule {}
