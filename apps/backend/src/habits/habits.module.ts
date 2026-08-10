import { Module } from '@nestjs/common';
import { HabitsService } from './habits.service';
import { HabitsResolver } from './habits.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [HabitsService, HabitsResolver],
  exports: [HabitsService],
})
export class HabitsModule {}
