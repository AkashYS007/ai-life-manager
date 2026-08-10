import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

// Global because every resolver in every feature module needs access to
// AuthGuard, and re-importing it module-by-module would be pure ceremony —
// consistent with how ConfigModule and PrismaModule are wired.
@Global()
@Module({
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
