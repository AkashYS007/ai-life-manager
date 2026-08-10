import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryResolver } from './memory.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [MemoryService, MemoryResolver],
  exports: [MemoryService],
})
export class MemoryModule {}
