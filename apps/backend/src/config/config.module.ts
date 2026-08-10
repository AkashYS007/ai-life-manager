import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { join } from 'path';
import { validateEnv } from './env.validation';

// Without an explicit `envFilePath`, @nestjs/config falls back to a plain
// `.env` in `process.cwd()` — which silently differs depending on *how*
// this process was launched: `cd apps/backend && npm run dev` gives a cwd of
// apps/backend, while running from the repo root (`npm run dev` via turbo,
// or most CI/deploy setups) gives a cwd of the repo root. Both are common
// ways to start this app, and each cwd has its own on-disk `.env` file
// (apps/backend/.env vs. the root .env) that can silently drift out of sync
// with the other — exactly what happened when real Clerk/Google keys were
// added to the root .env but the app kept booting with apps/backend/.env's
// stale placeholders instead, with no error, just AUTH_MODE=dev persisting
// unexpectedly. Resolving via `__dirname` (stable regardless of cwd, and
// identical whether running from src/ under ts-node or the compiled dist/
// tree, since both sit at the same depth under apps/backend) and pointing
// at the repo-root `.env` unconditionally makes that one file the actual
// single source of truth — matching what docker-compose.yml and every
// README/DEMO_WALKTHROUGH.md instruction in this project already assume.
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '../../../../.env'),
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
