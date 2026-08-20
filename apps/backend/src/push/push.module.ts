import { Module } from '@nestjs/common';
import { WebPushService } from './web-push.service';
import { NativePushService } from './native-push.service';
import { PushResolver } from './push.resolver';
import { UsersModule } from '../users/users.module';

// Same "depends on nothing but UsersModule" shape as NotificationsModule —
// NotificationsModule imports this one (for delivery), not the other way
// around, so there's no cycle risk. NativePushService (native app shell
// increment) joins WebPushService here as a second, independent delivery
// mechanism — see its own file comment for why it isn't folded into
// WebPushService instead.
@Module({
  imports: [UsersModule],
  providers: [WebPushService, NativePushService, PushResolver],
  exports: [WebPushService, NativePushService],
})
export class PushModule {}
