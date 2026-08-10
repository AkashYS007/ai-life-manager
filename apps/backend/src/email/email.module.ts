import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

// No resolver — email delivery is only ever triggered server-side from
// NotificationsService, never directly by a client, so this module has
// nothing to expose over GraphQL and needs no direct AppModule registration.
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
