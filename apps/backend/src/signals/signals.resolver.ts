import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { MoodEntry } from './models/mood-entry.model';
import { EnergyEntry } from './models/energy-entry.model';
import { SleepEntry } from './models/sleep-entry.model';
import { LogMoodPayload, LogEnergyPayload, LogSleepPayload } from './models/signal.payload';
import { LogMoodInput } from './dto/log-mood.input';
import { LogEnergyInput } from './dto/log-energy.input';
import { LogSleepInput } from './dto/log-sleep.input';
import { SignalsService } from './signals.service';

// Same ownership discipline as every other resolver in this app: resolve
// the internal users.id first, never scope by the raw auth identity.
@Resolver()
@UseGuards(AuthGuard)
export class SignalsResolver {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => MoodEntry, { nullable: true })
  async todayMood(@CurrentAuth() auth: AuthContext): Promise<MoodEntry | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.signalsService.getTodayMood(user.id, user.timezone);
  }

  @Query(() => EnergyEntry, { nullable: true })
  async todayEnergy(@CurrentAuth() auth: AuthContext): Promise<EnergyEntry | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.signalsService.getTodayEnergy(user.id, user.timezone);
  }

  @Query(() => SleepEntry, { nullable: true })
  async lastNightSleep(@CurrentAuth() auth: AuthContext): Promise<SleepEntry | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.signalsService.getLastNightSleep(user.id, user.timezone);
  }

  @Mutation(() => LogMoodPayload)
  async logMood(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: LogMoodInput,
  ): Promise<LogMoodPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const moodEntry = await this.signalsService.logMood(user.id, input);
      return { moodEntry, errors: [] };
    } catch {
      return { errors: [{ code: 'LOG_MOOD_FAILED', message: "We couldn't save that check-in. Try again." }] };
    }
  }

  @Mutation(() => LogEnergyPayload)
  async logEnergy(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: LogEnergyInput,
  ): Promise<LogEnergyPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const energyEntry = await this.signalsService.logEnergy(user.id, input);
      return { energyEntry, errors: [] };
    } catch {
      return { errors: [{ code: 'LOG_ENERGY_FAILED', message: "We couldn't save that check-in. Try again." }] };
    }
  }

  @Mutation(() => LogSleepPayload)
  async logSleep(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: LogSleepInput,
  ): Promise<LogSleepPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const sleepEntry = await this.signalsService.logSleep(user.id, user.timezone, input);
      return { sleepEntry, errors: [] };
    } catch {
      return { errors: [{ code: 'LOG_SLEEP_FAILED', message: "We couldn't save that sleep entry. Try again." }] };
    }
  }
}
