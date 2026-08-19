import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FocusSession } from './models/focus-session.model';
import { StartFocusSessionInput } from './dto/start-focus-session.input';

// Distinct error types (not just a generic Error) for the two predictable,
// non-exceptional states below — same reasoning as GoogleReconnectRequiredError:
// these are expected code paths a real user will hit in normal use, not bugs,
// so the resolver maps them to specific error codes with a fixed, friendly
// message rather than the generic catch-all every other *_FAILED code uses.
export class FocusSessionAlreadyActiveError extends Error {
  constructor() {
    super('You already have an active focus session. Finish or cancel it before starting another.');
    this.name = 'FocusSessionAlreadyActiveError';
  }
}

export class FocusSessionNotActiveError extends Error {
  constructor() {
    super('This focus session has already ended.');
    this.name = 'FocusSessionNotActiveError';
  }
}

function toGraphSession(record: any): FocusSession {
  return {
    id: record.id,
    taskId: record.taskId ?? undefined,
    taskTitle: record.task?.title,
    plannedDurationMinutes: record.plannedDurationMinutes,
    kind: record.kind,
    startedAt: record.startedAt,
    endedAt: record.endedAt ?? undefined,
    status: record.status,
  };
}

@Injectable()
export class FocusService {
  private readonly logger = new Logger(FocusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    // Real push-based focus session completion alerts increment — see
    // checkFocusSessionCompletions below for the full reasoning.
    private readonly notificationsService: NotificationsService,
    // Same event-based decoupling every other auto-replan trigger source
    // uses (see planner.service.ts) — PlannerModule doesn't import
    // FocusModule today, so there's no actual circularity risk here, but
    // the same shape is used anyway for consistency across every trigger
    // source in this app.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async requireOwnedSession(userId: string, id: string) {
    const session = await this.prisma.focusSession.findFirst({ where: { id, userId } });
    if (!session) {
      throw new NotFoundException('Focus session not found');
    }
    return session;
  }

  // Simple "one at a time" model, per the schema comment: refuses to start a
  // second session while one is already IN_PROGRESS rather than silently
  // abandoning it, so a session can never be quietly orphaned (still
  // IN_PROGRESS forever with nobody tracking it) just because the person
  // started a new one from another tab or after a page reload lost track of
  // the active one — getActive() below is what a client should check first
  // to resume, rather than blindly calling start().
  async start(userId: string, input: StartFocusSessionInput): Promise<FocusSession> {
    const existingActive = await this.prisma.focusSession.findFirst({
      where: { userId, status: 'IN_PROGRESS' },
    });
    if (existingActive) {
      throw new FocusSessionAlreadyActiveError();
    }

    const kind = input.kind ?? 'WORK';
    // A break is never tied to a task — same reasoning a break isn't real
    // focused work in getCompletedMinutesForTask/listCompletedInRange below.
    // Ignored rather than rejected: the Pomodoro auto-cycler never sends a
    // taskId on a break, so this only guards against a hand-crafted request.
    const taskId = kind === 'BREAK' ? undefined : input.taskId;

    if (taskId) {
      const task = await this.prisma.task.findFirst({ where: { id: taskId, userId } });
      if (!task) {
        throw new NotFoundException('Task not found');
      }
    }

    const record = await this.prisma.focusSession.create({
      data: {
        userId,
        taskId,
        plannedDurationMinutes: input.plannedDurationMinutes,
        kind,
        status: 'IN_PROGRESS',
      },
      include: { task: true },
    });
    return toGraphSession(record);
  }

  // Trusts the client's "I finished" signal rather than re-checking elapsed
  // time server-side — this is a personal focus timer, not a
  // fraud-sensitive billing meter, so there's no real harm in a person
  // marking a session complete a little early or late. Refuses to act on a
  // session that isn't IN_PROGRESS (already completed/cancelled) rather
  // than silently re-writing history, same "only valid transitions" guard
  // TasksService.reopen uses.
  private async end(userId: string, id: string, status: 'COMPLETED' | 'CANCELLED'): Promise<FocusSession> {
    const existing = await this.requireOwnedSession(userId, id);
    if (existing.status !== 'IN_PROGRESS') {
      throw new FocusSessionNotActiveError();
    }
    const record = await this.prisma.focusSession.update({
      where: { id },
      data: { status, endedAt: new Date() },
      include: { task: true },
    });
    return toGraphSession(record);
  }

  // timezone is only needed for the chronotype refresh below (bucketing
  // startedAt into a local morning/afternoon/evening daypart) — cancel()
  // doesn't take one, since an abandoned session isn't real evidence of
  // when this person actually does focused work.
  async complete(userId: string, timezone: string, id: string): Promise<FocusSession> {
    const session = await this.end(userId, id, 'COMPLETED');

    // Chronotype AI Memory signal (see memory.service.ts's
    // refreshChronotypePattern) — best-effort, same "a learning/enhancement
    // computation must never break the core action the user is waiting on"
    // principle as every other automatic-learning trigger in this app.
    try {
      await this.memoryService.refreshChronotypePattern(userId, timezone);
    } catch (error) {
      this.logger.warn(`Chronotype pattern refresh failed: ${(error as Error).message}`);
    }

    // Further auto-replanning triggers increment — a genuinely *completed*
    // session only; cancel() below never emits this, same "only the real
    // finished signal counts" reasoning the routine-completion trigger
    // already applies to a partial checklist. Automatic Pomodoro work/break
    // cycling increment: a completed BREAK never emits this either — a
    // break finishing isn't a new "real work got done, the plan might need
    // to react" signal the way a completed work block is, and Pomodoro mode
    // would otherwise double this trigger's real frequency (one extra fire
    // per break) for no real reason.
    if (session.kind === 'WORK') {
      this.eventEmitter.emit('focusSession.completed', { userId });
    }

    return session;
  }

  async cancel(userId: string, id: string): Promise<FocusSession> {
    return this.end(userId, id, 'CANCELLED');
  }

  // Lets a client reload the page mid-session and pick the countdown back
  // up from startedAt + plannedDurationMinutes rather than losing it —
  // start()'s one-at-a-time guarantee means this is always at most one row.
  async getActive(userId: string): Promise<FocusSession | null> {
    const record = await this.prisma.focusSession.findFirst({
      where: { userId, status: 'IN_PROGRESS' },
      include: { task: true },
    });
    return record ? toGraphSession(record) : null;
  }

  // Bounded, most-recent-first list — same "naturally bounded, no need for
  // Relay pagination yet" reasoning as CalendarService.listInRange and the
  // AI chat conversations list; nobody accumulates thousands of focus
  // sessions the way they might accumulate calendar events over years.
  async listRecent(userId: string, take = 10): Promise<FocusSession[]> {
    const records = await this.prisma.focusSession.findMany({
      where: { userId },
      include: { task: true },
      orderBy: { startedAt: 'desc' },
      take,
    });
    return records.map(toGraphSession);
  }

  // Focus sessions feed task duration back increment: the real answer to
  // "how long did this actually take" a focus session already knows, that
  // TaskRow's completion prompt used to just ask the person to type blind.
  // Sums *every* COMPLETED session ever tied to this task (not just the
  // most recent one) — if a task was worked on across two sittings, both
  // real, finished chunks of focused time belong in the total; a session
  // still IN_PROGRESS or CANCELLED never represents real finished time,
  // same "only the genuine finished signal counts" rule this file already
  // applies to the auto-replanning trigger and to Insights' own
  // focus-session consistency series. Returns null (not 0) when there's
  // nothing to suggest, so the caller can tell "no real data" apart from
  // "genuinely took zero minutes" and leave the completion prompt's input
  // blank exactly as it always has, rather than pre-filling a misleading 0.
  // Raw millisecond totals are summed once and divided at the very end
  // (not rounded per-session first) to avoid compounding rounding error
  // across multiple sessions. `kind: 'WORK'` is belt-and-suspenders here —
  // a BREAK session never has a taskId in the first place (see start()
  // above) — but it's kept explicit so this method's intent (real focused
  // work only) doesn't quietly depend on that other invariant holding.
  async getCompletedMinutesForTask(userId: string, taskId: string): Promise<number | null> {
    const sessions = await this.prisma.focusSession.findMany({
      where: { userId, taskId, status: 'COMPLETED', kind: 'WORK' },
      select: { startedAt: true, endedAt: true },
    });
    if (sessions.length === 0) return null;

    let totalMs = 0;
    for (const s of sessions) {
      if (!s.endedAt) continue; // shouldn't happen for a COMPLETED row, but never trust it blindly
      totalMs += s.endedAt.getTime() - s.startedAt.getTime();
    }
    if (totalMs <= 0) return null;
    return Math.round(totalMs / 60000);
  }

  // Insights: focus-session consistency increment — same lightweight,
  // unhydrated query as TasksService.listCompletedInRange (no `include:
  // { task: true }`, since AnalyticsService never needs the linked task,
  // only the timestamps). COMPLETED only — a cancelled session never
  // reflects real focused time, same "only the genuine finished signal
  // counts" reasoning the auto-replanning trigger on this same method
  // already applies. `kind: 'WORK'` (Pomodoro cycling increment) excludes
  // break blocks for the same reason — a break is real rest, not focused
  // work, and letting it inflate this consistency series or the correlation
  // engine's daily focus-minutes total would misrepresent both. Bucketed by
  // `startedAt` in AnalyticsService, not `endedAt` — the day a session
  // *started* is the day it's counted against, even on the rare session
  // that happens to cross local midnight.
  async listCompletedInRange(userId: string, fromDate: Date, toDate: Date): Promise<Array<{ startedAt: Date; endedAt: Date }>> {
    return this.prisma.focusSession.findMany({
      where: { userId, status: 'COMPLETED', kind: 'WORK', startedAt: { gte: fromDate, lte: toDate } },
      select: { startedAt: true, endedAt: true },
    }) as unknown as Promise<Array<{ startedAt: Date; endedAt: Date }>>;
  }

  // Real push-based focus session completion alerts increment: the client's
  // own on-screen/browser-Notification signal (FocusPageContent's
  // notifyTransition, in apps/web/src/app/focus/page.tsx) only fires while
  // that tab stays open and in the foreground for the entire planned
  // duration — a locked phone screen or a backgrounded tab freezes the
  // countdown's setInterval entirely, so nothing ever fires, and a closed
  // tab means nothing ever will. This closes that gap the same way the
  // morning/evening routine and reflection reminders do (see
  // SchedulerService.checkRemindersForUser): a scheduled sweep that doesn't
  // depend on any tab being open, delivered through the same real web-push
  // pipeline (NotificationsService.create -> WebPushService) already
  // proven working for plan/recommendation notifications.
  //
  // Deliberately kept to exactly this scope — a real push when a session's
  // planned time is up — not the larger "move the whole Pomodoro
  // work/break chain server-side" change. `pomodoroMode` and
  // `cyclesCompleted` stay client-only state exactly as before (see the
  // Automatic Pomodoro work/break cycling increment's comments in
  // page.tsx); this only ever tells the person their timer is up, it never
  // starts the next block itself, so there's no new persisted
  // "is this person mid-Pomodoro-chain" state to get out of sync.
  //
  // Runs every minute, not on SchedulerService's shared 15-minute cadence —
  // a focus session can be as short as a 5-minute break, and a nudge that
  // arrives up to 15 minutes late defeats the entire point of "tell me the
  // moment this block ends." Kept self-contained here rather than moved
  // into SchedulerService, the same "a service can own its own @Cron"
  // precedent NotificationsService.deliverDueNotifications already set,
  // since this only ever touches focus session state this service already
  // owns.
  //
  // Every IN_PROGRESS session is fetched with no per-user pre-filter,
  // unlike checkReminders' per-user sweep — at any given moment across the
  // whole app there are only ever as many IN_PROGRESS focus sessions as
  // there are people actively mid-timer right now, a tiny fraction of the
  // user base, not "every user, every tick" the way the 15-minute reminder
  // sweep genuinely is.
  //
  // Dedup is a direct existence check against the notifications table for
  // `focus_session_complete:${session.id}` — not create()'s own internal
  // batching (same-type-and-unread-within-12-hours), which exists to
  // refresh a still-relevant *recurring* notification, not to gate a
  // one-time event. A given focus session only ever crosses its planned
  // end once, so "has any notification for this exact session id ever been
  // sent, read or not" is the correct, permanent check — relying on
  // create()'s own unread-window batching instead would re-trigger a brand
  // new real push on every later tick until the person actually opened the
  // app and read it, not just silently refresh one in-app row the way it
  // correctly does for the recurring habit/routine reminders above.
  @Cron('*/1 * * * *')
  async checkFocusSessionCompletions(): Promise<void> {
    const sessions = await this.prisma.focusSession.findMany({
      where: { status: 'IN_PROGRESS' },
      include: { task: true },
    });

    const now = Date.now();
    for (const session of sessions) {
      const plannedEndMs = session.startedAt.getTime() + session.plannedDurationMinutes * 60 * 1000;
      if (now < plannedEndMs) continue;

      try {
        const type = `focus_session_complete:${session.id}`;
        const alreadyNotified = await this.prisma.notification.findFirst({
          where: { userId: session.userId, type },
          select: { id: true },
        });
        if (alreadyNotified) continue;

        const user = await this.prisma.user.findUnique({
          where: { id: session.userId },
          select: { timezone: true },
        });
        if (!user) continue;

        const isBreak = session.kind === 'BREAK';
        await this.notificationsService.create(session.userId, user.timezone, type, {
          title: isBreak ? 'Break complete' : 'Focus session complete',
          body: isBreak
            ? "Your break just ended — ready to get back to it?"
            : session.task?.title
              ? `Nice work! Your focus session on "${session.task.title}" is done.`
              : 'Nice work! Your focus session is done.',
          deeplink: '/focus',
        });
      } catch (error) {
        // One session's failure (bad row, transient DB blip) must never
        // block the rest of this tick's sweep — same "isolate the failure,
        // keep going" principle as every other best-effort loop in this app.
        this.logger.warn(
          `Focus session completion push failed for session ${session.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
