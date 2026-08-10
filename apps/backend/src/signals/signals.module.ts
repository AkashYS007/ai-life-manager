import { Module } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalsResolver } from './signals.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [SignalsService, SignalsResolver],
  exports: [SignalsService],
})
export class SignalsModule {}
