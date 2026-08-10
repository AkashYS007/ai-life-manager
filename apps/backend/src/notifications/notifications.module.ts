import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';
import { UsersModule } from '../users/users.module';
import { PushModule } from '../push/push.module';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';

// Deliberately depends on nothing but UsersModule, PushModule, EmailModule,
// and SmsModule — every other module that creates a notification
// (PlannerModule, RecommendationsModule) imports *this* module, not the
// other way around, so there's no risk of this ever becoming a cycle no
// matter how many more triggers get added later. PushModule/EmailModule are
// real delivery mechanisms added by the Real notification delivery
// increment; SmsModule is the same shape, added by the SMS delivery
// increment. None of the three depend on NotificationsModule, so this stays
// acyclic.
@Module({
  imports: [UsersModule, PushModule, EmailModule, SmsModule],
  providers: [NotificationsService, NotificationsResolver],
  exports: [NotificationsService],
})
export class NotificationsModule {}
