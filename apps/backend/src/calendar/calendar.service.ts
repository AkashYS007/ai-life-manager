import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleCalendarWriteService } from '../integrations/google/google-calendar-write.service';
import { MicrosoftCalendarWriteService } from '../integrations/microsoft/microsoft-calendar-write.service';
import { CalendarEvent } from './models/calendar-event.model';
import { CreateCalendarEventInput } from './dto/create-calendar-event.input';
import { UpdateCalendarEventInput } from './dto/update-calendar-event.input';

// Workout-booking conflict avoidance increment: 15-minute steps match this
// app's own established time granularity elsewhere (SchedulerService's
// cron tick and its own 30-minute reminder catch-window), not a new,
// unrelated number invented for this one feature. A full week is a
// generous, effectively-never-hit ceiling for a real calendar — this only
// matters for the pathological case of someone whose calendar is booked
// solid the entire time, and even then this degrades gracefully (see
// findNextOpenSlot's own comment) rather than failing outright.
const SLOT_STEP_MINUTES = 15;
const SLOT_SEARCH_MAX_DAYS = 7;

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleCalendarWrite: GoogleCalendarWriteService,
    private readonly microsoftCalendarWrite: MicrosoftCalendarWriteService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Powers TodayPlan.events and the Calendar day view — a single day's
  // events are naturally bounded, so a plain range query (not Relay
  // pagination) is the right tool, same reasoning as
  // TasksService.listOpenForUser.
  async listInRange(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    const records = await this.prisma.calendarEvent.findMany({
      where: {
        userId,
        // An event overlaps the range if it starts before the range ends
        // and ends after the range starts — not just "starts inside it" —
        // so a meeting that spans midnight still shows up on both days.
        startTime: { lt: end },
        endTime: { gt: start },
      },
      orderBy: [{ startTime: 'asc' }],
    });
    return records as unknown as CalendarEvent[];
  }

  // Workout-booking conflict avoidance increment. Given a desired start
  // time and a duration, returns the first available start time (checked
  // in fixed SLOT_STEP_MINUTES steps, at or after `desiredStart`) that
  // doesn't overlap *any* existing calendar event for this user — real
  // events only, obviously, but deliberately every one of them regardless
  // of `isImmovable`. That's a real, worth-naming difference from
  // PlannerService's own conflict logic, which only ever treats
  // `isImmovable` events as blocking (ordinary/movable events are fair game
  // to schedule tasks around freely there) — this method's whole point is
  // "don't visually double-book that time slot" for a single new block
  // being placed right now, a different question from "can a task be
  // rescheduled through this," so it uses the more literal, everyday
  // meaning of "conflict": anything already there.
  //
  // Deliberately quiet and best-effort: if nothing opens up within
  // SLOT_SEARCH_MAX_DAYS (an extreme, unlikely-in-practice case), this
  // gives up and returns `desiredStart` completely unchanged rather than
  // throwing — booking a workout should never hard-fail just because this
  // nicety couldn't find a gap. Also deliberately uniform regardless of
  // whether `desiredStart` came from a fixed default ("right now") or a
  // person's own explicit custom time (see the Customize act-on defaults
  // increment) — there's no separate "don't move a time I picked on
  // purpose" mode; whoever calls this always sees the real, final booked
  // time by looking at the calendar afterward (the same "navigate so they
  // can see it" pattern this whole feature already uses), not a
  // silently-different one.
  async findNextOpenSlot(userId: string, desiredStart: Date, durationMinutes: number): Promise<Date> {
    const searchEnd = new Date(desiredStart.getTime() + SLOT_SEARCH_MAX_DAYS * 24 * 60 * 60 * 1000);
    const events = await this.listInRange(userId, desiredStart, searchEnd);

    let candidateStart = desiredStart;
    while (candidateStart.getTime() < searchEnd.getTime()) {
      const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60 * 1000);
      const hasConflict = events.some(
        (e) =>
          candidateStart.getTime() < new Date(e.endTime).getTime() &&
          candidateEnd.getTime() > new Date(e.startTime).getTime(),
      );
      if (!hasConflict) return candidateStart;
      candidateStart = new Date(candidateStart.getTime() + SLOT_STEP_MINUTES * 60 * 1000);
    }
    return desiredStart;
  }

  async listConnection(
    userId: string,
    args: { first?: number; after?: string },
  ): Promise<{ edges: { cursor: string; node: CalendarEvent }[]; pageInfo: any }> {
    const take = Math.min(args.first ?? 20, 100);
    const records = await this.prisma.calendarEvent.findMany({
      where: { userId },
      orderBy: [{ startTime: 'desc' }],
      take: take + 1,
      ...(args.after ? { cursor: { id: args.after }, skip: 1 } : {}),
    });

    const hasNextPage = records.length > take;
    const page = records.slice(0, take);
    const edges = page.map((r: any) => ({ cursor: r.id, node: r as CalendarEvent }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!args.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
    };
  }

  private async requireOwnedEvent(userId: string, id: string) {
    const event = await this.prisma.calendarEvent.findFirst({ where: { id, userId } });
    if (!event) {
      throw new NotFoundException('Calendar event not found');
    }
    return event;
  }

  // `internalOptions.isAiFocusBlock` is deliberately not part of
  // CreateCalendarEventInput/the public createCalendarEvent mutation — a
  // person creating their own event by hand isn't an AI-placed block, and
  // letting the client set this flag directly would make it meaningless.
  // The only caller that passes it today is RecommendationsService.actOn's
  // WORKOUT branch (see the Booking a workout as a real calendar block
  // increment) — the same "real column, only ever meant to be set from a
  // specific trusted server-side path, not the generic input" reasoning
  // FocusSession.kind's own BREAK/WORK split already established.
  async create(
    userId: string,
    input: CreateCalendarEventInput,
    internalOptions?: { isAiFocusBlock?: boolean },
  ): Promise<CalendarEvent> {
    const record = await this.prisma.calendarEvent.create({
      data: {
        userId,
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        isImmovable: input.isImmovable ?? false,
        isAiFocusBlock: internalOptions?.isAiFocusBlock ?? false,
        source: 'NATIVE',
      },
    });
    // Automatic AI re-planning increment — see TasksService.complete's own
    // comment on this exact pattern (event, not a direct PlannerService
    // call, to avoid the module cycle PlannerModule importing CalendarModule
    // already creates the other direction). Deliberately only on this
    // native create/update/delete path, not on the sync-writer methods
    // below (`upsertFromExternalSource`/`deleteByExternalId`) — a single
    // Google/Microsoft/Apple sync can pull in dozens of events in one call,
    // and firing an auto-replan per synced event would be a burst of AI
    // calls for what a person experiences as one action ("I hit Sync").
    // The cooldown in PlannerService.maybeAutoReplan would absorb most of
    // that burst into at most one extra plan anyway, but skipping it at the
    // source is simpler and avoids relying on the cooldown to paper over it.
    this.eventEmitter.emit('calendar.changed', { userId });
    return record as unknown as CalendarEvent;
  }

  // Push-edits-back increment: same ordering discipline as delete() below —
  // push the remote edit first, and only write the local row once the
  // provider confirms it, so a failure (most commonly *ReconnectRequiredError)
  // leaves the local copy exactly as it was rather than silently drifting
  // out of sync with what's still shown on Google/Microsoft's own calendar.
  // `isImmovable` is deliberately never pushed remotely — it's a purely
  // local scheduling hint this app invented, with no equivalent field on
  // either provider's API.
  async update(userId: string, id: string, input: UpdateCalendarEventInput): Promise<CalendarEvent> {
    const event = await this.requireOwnedEvent(userId, id);

    if (event.source === 'GOOGLE' && event.calendarAccountId && event.externalEventId) {
      await this.googleCalendarWrite.updateRemoteEvent(event.calendarAccountId, event.externalEventId, {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
      });
    } else if (event.source === 'MICROSOFT' && event.calendarAccountId && event.externalEventId) {
      await this.microsoftCalendarWrite.updateRemoteEvent(event.calendarAccountId, event.externalEventId, {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
      });
    }

    const record = await this.prisma.calendarEvent.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        isImmovable: input.isImmovable,
      },
    });
    this.eventEmitter.emit('calendar.changed', { userId });
    return record as unknown as CalendarEvent;
  }

  // Two-way sync (push-deletes-back increment, now covering both Google and
  // Microsoft): for a NATIVE event this is unchanged — just a local delete.
  // For a synced event, the remote delete is pushed first and only removed
  // locally once the provider confirms it — deliberately in that order, not
  // the reverse, so a failure (most commonly a *ReconnectRequiredError,
  // surfaced by the resolver as a distinct error code) leaves the local
  // copy intact rather than resurrecting itself on the next pull sync,
  // which is exactly the confusing "my delete silently undid itself"
  // behavior this increment exists to fix. APPLE isn't handled here — Apple
  // (CalDAV) sync isn't built yet at all (see README), so there's no write
  // service to push to; if that ever syncs a native APPLE event before its
  // own write support lands, this falls through to a local-only delete,
  // same as it would have before this increment existed.
  async delete(userId: string, id: string): Promise<string> {
    const event = await this.requireOwnedEvent(userId, id);

    if (event.source === 'GOOGLE' && event.calendarAccountId && event.externalEventId) {
      await this.googleCalendarWrite.deleteRemoteEvent(event.calendarAccountId, event.externalEventId);
    } else if (event.source === 'MICROSOFT' && event.calendarAccountId && event.externalEventId) {
      await this.microsoftCalendarWrite.deleteRemoteEvent(event.calendarAccountId, event.externalEventId);
    }

    await this.prisma.calendarEvent.delete({ where: { id } });
    this.eventEmitter.emit('calendar.changed', { userId });
    return id;
  }

  // --- Sync writers (used by Google/Microsoft/Apple sync, never by the
  // GraphQL resolver directly) ------------------------------------------

  // Keyed on the (calendarAccountId, externalEventId) unique constraint —
  // a synced event's identity is the provider's own event id, not ours, so
  // re-syncing the same event updates it in place instead of duplicating it.
  async upsertFromExternalSource(params: {
    userId: string;
    calendarAccountId: string;
    externalEventId: string;
    title: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    source: 'GOOGLE' | 'MICROSOFT' | 'APPLE';
  }): Promise<void> {
    await this.prisma.calendarEvent.upsert({
      where: {
        calendarAccountId_externalEventId: {
          calendarAccountId: params.calendarAccountId,
          externalEventId: params.externalEventId,
        },
      },
      create: {
        userId: params.userId,
        calendarAccountId: params.calendarAccountId,
        externalEventId: params.externalEventId,
        title: params.title,
        description: params.description,
        startTime: params.startTime,
        endTime: params.endTime,
        source: params.source,
        lastSyncedAt: new Date(),
      },
      update: {
        title: params.title,
        description: params.description,
        startTime: params.startTime,
        endTime: params.endTime,
        lastSyncedAt: new Date(),
      },
    });
  }

  async deleteByExternalId(calendarAccountId: string, externalEventId: string): Promise<void> {
    await this.prisma.calendarEvent.deleteMany({
      where: { calendarAccountId, externalEventId },
    });
  }
}
