import { Module } from '@nestjs/common';
import { WebPushService } from './web-push.service';
import { PushResolver } from './push.resolver';
import { UsersModule } from '../users/users.module';

// Same "depends on nothing but UsersModule" shape as NotificationsModule —
// NotificationsModule imports this one (for delivery), not the other way
// around, so there's no cycle risk.
@Module({
  imports: [UsersModule],
  providers: [WebPushService, PushResolver],
  exports: [WebPushService],
})
export class PushModule {}
