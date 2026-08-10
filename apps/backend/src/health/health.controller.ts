import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Plain REST, not GraphQL — this is what a load balancer / container
// orchestrator polls, and it should not depend on the GraphQL stack being
// healthy to answer (Architecture Document §10 deployment topology).
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
  }
}
