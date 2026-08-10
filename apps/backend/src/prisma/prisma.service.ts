import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Thin wrapper so the rest of the app depends on Nest's DI container rather
// than importing a raw PrismaClient singleton — makes it trivial to swap in a
// mock client in unit tests without touching any consuming service.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
