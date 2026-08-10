import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { zonedDayBounds } from '../common/date/zoned-day';
import { MoodEntry } from './models/mood-entry.model';
import { EnergyEntry } from './models/energy-entry.model';
import { SleepEntry } from './models/sleep-entry.model';
import { LogMoodInput } from './dto/log-mood.input';
import { LogEnergyInput } from './dto/log-energy.input';
import { LogSleepInput } from './dto/log-sleep.input';

// Renders a JS Date as a date-only value for the `@db.Date` sleep_date
// column, anchored to the user's own calendar day (via zoned-day.ts), not
// the server's. `new Date('YYYY-MM-DD')` parses as UTC midnight, which is
// exactly what Postgres's DATE type (no timezone component at all) expects
// — the same "get date-only math right with a well-tested tool" reasoning
// as zoned-day.ts itself.
function toDateOnly(instant: Date, timezone: string): Date {
  const isoDate = DateTime.fromJSDate(instant, { zone: timezone }).toISODate();
  return new Date(isoDate!);
}

@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    // Same decoupling reason `task.completed`/`calendar.changed` already
    // use — PlannerModule already imports SignalsModule, so importing
    // PlannerModule back here would be circular.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Each check-in is its own row (mood/energy can be logged more than once
  // a day — PRD §7.2 describes a "lightweight" check-in, not a once-daily
  // gate), so these are plain creates, not upserts.
  async logMood(userId: string, input: LogMoodInput): Promise<MoodEntry> {
    const record = await this.prisma.moodEntry.create({
      data: { userId, moodScore: input.moodScore, note: input.note },
    });
    // New auto-replanning triggers increment — one shared `checkin.logged`
    // event covers both logMood and logEnergy below, since a fresh mood or
    // energy reading is the same kind of signal either way ("something
    // about how the day's actually going just changed") for the purposes
    // of deciding whether to re-plan; there's no need for the planner side
    // to tell the two apart. Sleep isn't included — see logSleep below for
    // why.
    this.eventEmitter.emit('checkin.logged', { userId });
    return record as unknown as MoodEntry;
  }

  async logEnergy(userId: string, input: LogEnergyInput): Promise<EnergyEntry> {
    const record = await this.prisma.energyEntry.create({
      data: { userId, energyScore: input.energyScore, source: 'MANUAL' },
    });
    this.eventEmitter.emit('checkin.logged', { userId });
    return record as unknown as EnergyEntry;
  }

  // Sleep is different: exactly one entry per (user, sleepDate) — logging
  // again for the same morning corrects that entry rather than creating a
  // duplicate, matching the schema's @@unique([userId, sleepDate]).
  //
  // Deliberately doesn't emit `checkin.logged` (New auto-replanning
  // triggers increment) — the option this increment was scoped from named
  // "a mood/energy check-in" specifically, and sleep is usually logged for
  // this morning about *last* night, a much weaker "the rest of today just
  // changed" signal than a fresh mood or energy reading is. Kept out on
  // purpose, not an oversight — easy to add later if it turns out to matter.
  async logSleep(userId: string, timezone: string, input: LogSleepInput): Promise<SleepEntry> {
    const sleepDate = input.sleepDate
      ? toDateOnly(input.sleepDate, timezone)
      : toDateOnly(new Date(), timezone);

    const record = await this.prisma.sleepEntry.upsert({
      where: { userId_sleepDate: { userId, sleepDate } },
      create: {
        userId,
        sleepDate,
        bedtime: input.bedtime,
        wakeTime: input.wakeTime,
        durationMinutes: input.durationMinutes,
        qualityScore: input.qualityScore,
        source: 'MANUAL',
      },
      update: {
        bedtime: input.bedtime,
        wakeTime: input.wakeTime,
        durationMinutes: input.durationMinutes,
        qualityScore: input.qualityScore,
      },
    });
    return record as unknown as SleepEntry;
  }

  // Powers TodayPlan.todayMood — the most recent check-in logged within the
  // user's local calendar day, or null if they haven't checked in yet
  // today (an honest empty state, not a fabricated default).
  async getTodayMood(userId: string, timezone: string): Promise<MoodEntry | null> {
    const { start, end } = zonedDayBounds(new Date(), timezone);
    const record = await this.prisma.moodEntry.findFirst({
      where: { userId, loggedAt: { gte: start, lt: end } },
      orderBy: { loggedAt: 'desc' },
    });
    return record as unknown as MoodEntry | null;
  }

  async getTodayEnergy(userId: string, timezone: string): Promise<EnergyEntry | null> {
    const { start, end } = zonedDayBounds(new Date(), timezone);
    const record = await this.prisma.energyEntry.findFirst({
      where: { userId, loggedAt: { gte: start, lt: end } },
      orderBy: { loggedAt: 'desc' },
    });
    return record as unknown as EnergyEntry | null;
  }

  async getLastNightSleep(userId: string, timezone: string): Promise<SleepEntry | null> {
    const sleepDate = toDateOnly(new Date(), timezone);
    const record = await this.prisma.sleepEntry.findUnique({
      where: { userId_sleepDate: { userId, sleepDate } },
    });
    return record as unknown as SleepEntry | null;
  }

  // Life analytics increment — the three range queries AnalyticsService
  // builds its trend series from. `fromInstant` is a real timestamptz
  // bound (mood/energy's `loggedAt` is a real timestamp, not date-only),
  // unlike getSleepEntriesInRange's `fromDate`, which must be the
  // UTC-midnight-anchored form toDateOnly already produces elsewhere in
  // this file — sleep_entries' `sleepDate` is a `@db.Date` column, so
  // comparing it against an arbitrary local-midnight instant (rather than
  // real UTC midnight) would silently miscompare near a timezone's own
  // offset from UTC. Ascending order in all three, oldest first, since
  // that's the order a trend chart reads them in.
  async getMoodEntriesInRange(userId: string, fromInstant: Date): Promise<MoodEntry[]> {
    const records = await this.prisma.moodEntry.findMany({
      where: { userId, loggedAt: { gte: fromInstant } },
      orderBy: { loggedAt: 'asc' },
    });
    return records as unknown as MoodEntry[];
  }

  async getEnergyEntriesInRange(userId: string, fromInstant: Date): Promise<EnergyEntry[]> {
    const records = await this.prisma.energyEntry.findMany({
      where: { userId, loggedAt: { gte: fromInstant } },
      orderBy: { loggedAt: 'asc' },
    });
    return records as unknown as EnergyEntry[];
  }

  async getSleepEntriesInRange(userId: string, fromDate: Date): Promise<SleepEntry[]> {
    const records = await this.prisma.sleepEntry.findMany({
      where: { userId, sleepDate: { gte: fromDate } },
      orderBy: { sleepDate: 'asc' },
    });
    return records as unknown as SleepEntry[];
  }
}
