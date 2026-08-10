import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { BillingService } from './billing.service';
import { BillingResolver } from './billing.resolver';

@Module({
  imports: [UsersModule],
  controllers: [StripeWebhookController],
  providers: [StripeService, BillingService, BillingResolver],
})
export class BillingModule {}
