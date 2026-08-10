import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { SubscriptionResolver } from './subscription.resolver';

@Module({
  providers: [UsersService, UsersResolver, SubscriptionResolver],
  exports: [UsersService],
})
export class UsersModule {}
