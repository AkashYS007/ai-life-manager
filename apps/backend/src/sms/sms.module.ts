import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

// No resolver — same reasoning as EmailModule: SMS delivery is only ever
// triggered server-side from NotificationsService, never directly by a
// client, so this module has nothing to expose over GraphQL and needs no
// direct AppModule registration.
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
