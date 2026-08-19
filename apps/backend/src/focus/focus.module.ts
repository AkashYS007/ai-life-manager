import { Module } from '@nestjs/common';
import { FocusService } from './focus.service';
import { FocusResolver } from './focus.resolver';
import { UsersModule } from '../users/users.module';
import { MemoryModule } from '../memory/memory.module';
import { NotificationsModule } from '../notifications/notifications.module';

// MemoryModule import is from the Chronotype AI Memory signal increment —
// FocusService.complete() refreshes the chronotype fact best-effort right
// when a completed session gives fresh data to compute it from. No cycle
// risk: MemoryModule only imports UsersModule.
//
// NotificationsModule import is from the Real push-based focus session
// completion alerts increment (see FocusService.checkFocusSessionCompletions).
// No cycle risk: NotificationsModule only imports UsersModule, PushModule,
// EmailModule, and SmsModule — none of which import FocusModule.
@Module({
  imports: [UsersModule, MemoryModule, NotificationsModule],
  providers: [FocusService, FocusResolver],
  exports: [FocusService],
})
export class FocusModule {}
