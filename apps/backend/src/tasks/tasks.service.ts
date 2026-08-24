import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { Task } from './models/task.model';
import { CreateTaskInput } from './dto/create-task.input';
import { UpdateTaskInput } from './dto/update-task.input';

const TASK_INCLUDE = {
  goal: true,
  tags: { include: { tag: true } },
  subtasks: {
    include: {
      tags: { include: { tag: true } },
    },
  },
} as const;

// Flattens the task_tags join table into a plain Tag[] (Database Design
// Document §7 — this is exactly the kind of shaping the service layer does
// so the GraphQL model never has to know the join table exists) and maps
// one level of subtasks the same way.
function toGraphTask(record: any): Task {
  return {
    ...record,
    tags: (record.tags ?? []).map((t: any) => t.tag),
    subtasks: (record.subtasks ?? []).map((s: any) => toGraphTask(s)),
  };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async listForUser(userId: string, filter: { status?: string; goalId?: string } = {}): Promise<Task[]> {
    const records = await this.prisma.task.findMany({
      where: {
        userId,
        parentTaskId: null,
        ...(filter.status ? { status: filter.status as any } : {}),
        ...(filter.goalId ? { goalId: filter.goalId } : {}),
      },
      include: TASK_INCLUDE,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map(toGraphTask);
  }

  // Powers TodayPlan.tasks (Today Resolver) — the honest, un-AI-scheduled
  // "what's still open" view: anything not completed/cancelled, most
  // urgent first. The AI scheduling increment replaces this ordering with
  // real schedule placement, not this query.
  //
  // Bug fix (found via a real Playwright run, 2026-08-15): the secondary
  // sort used to be `createdAt: 'asc'` (oldest-within-priority-tier first),
  // paired with the hard `take` cutoff below. Those two interact badly —
  // once an account has more open tasks than `take`, a brand-new task at
  // the same priority as older ones sorts *behind* every one of them and
  // silently never appears on Today at all, even though it's really there
  // (confirmed live: this account, after many rounds of real testing,
  // reliably had 61 open PENDING/IN_PROGRESS tasks against `take`'s default
  // of 50). `listConnection` below — the Tasks screen's own Open tab —
  // already establishes this app's real convention for "what's still open,
  // newest visible first": `createdAt: 'desc'`, with genuine cursor
  // pagination so nothing's ever lost, just paged. Matching that same
  // ordering here doesn't fix the *lack* of pagination on this endpoint
  // (Today intentionally shows a bounded working set, not everything — see
  // this method's own `take` default), but it does fix the actual bug: a
  // task someone just added now reliably sorts to the front of its
  // priority tier instead of being buried behind however many older tasks
  // happen to exist, so it can never again silently vanish from the one
  // screen a person expects it to show up on immediately.
  async listOpenForUser(userId: string, take = 50): Promise<Task[]> {
    const records = await this.prisma.task.findMany({
      where: {
        userId,
        parentTaskId: null,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: TASK_INCLUDE,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take,
    });
    return records.map(toGraphTask);
  }

  async listConnection(
    userId: string,
    args: { status?: string; statuses?: string[]; goalId?: string; first?: number; after?: string },
  ): Promise<{ edges: { cursor: string; node: Task }[]; pageInfo: any }> {
    const take = Math.min(args.first ?? 20, 100);
    const records = await this.prisma.task.findMany({
      where: {
        userId,
        parentTaskId: null,
        // `statuses` (a list) takes precedence over the older singular
        // `status` when both are somehow passed — matches which one this
        // service actually expects a caller to use for a given query shape
        // (COMPLETED_TASKS_QUERY sends only `status`; the Tasks screen's
        // Open tab sends only `statuses`), so there's no real ambiguity in
        // practice, just a defined tie-break if there ever were.
        ...(args.statuses?.length
          ? { status: { in: args.statuses as any } }
          : args.status
            ? { status: args.status as any }
            : {}),
        ...(args.goalId ? { goalId: args.goalId } : {}),
      },
      include: TASK_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: take + 1,
      ...(args.after ? { cursor: { id: args.after }, skip: 1 } : {}),
    });

    const hasNextPage = records.length > take;
    const page = records.slice(0, take);
    const edges = page.map((r: any) => ({ cursor: r.id, node: toGraphTask(r) }));

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

  // Widened from private to public for the Tool-calling actions in Chat
  // increment — ChatService needs the exact same "does this task exist and
  // does this person actually own it" check (plus the raw record itself,
  // to read estimatedDurationMinutes when computing a reschedule's end
  // time) before ever touching a task a model asked it to act on, the same
  // "policy layer never trusts the model" discipline PlannerService's own
  // validateAndClamp already established. Every existing caller inside
  // this class is completely unaffected — a wider access modifier doesn't
  // change behavior for any of them.
  async requireOwnedTask(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, userId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  // Ownership checks on client-supplied goalId/tagIds (backend audit
  // Update 49 finding #4, high severity): create()/update() used to write
  // these ids straight onto the task with no check at all — unlike
  // parentTaskId, which already goes through requireOwnedTask just above.
  // TASK_INCLUDE always eagerly includes `goal` and `tags`, so a task
  // pointed at another user's goal/tag id would come back on every future
  // read carrying that other user's goal title (or tag name/color)
  // embedded in it. requireOwnedTags dedupes before counting so a caller
  // repeating the same id can't be miscounted as "not all owned".
  private async requireOwnedGoal(userId: string, id: string): Promise<void> {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) {
      throw new NotFoundException('Goal not found');
    }
  }

  private async requireOwnedTags(userId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const uniqueIds = [...new Set(tagIds)];
    const ownedCount = await this.prisma.tag.count({ where: { id: { in: uniqueIds }, userId } });
    if (ownedCount !== uniqueIds.length) {
      throw new NotFoundException('One or more tags not found');
    }
  }

  async create(userId: string, input: CreateTaskInput): Promise<Task> {
    if (input.parentTaskId) {
      await this.requireOwnedTask(userId, input.parentTaskId);
    }
    if (input.goalId) {
      await this.requireOwnedGoal(userId, input.goalId);
    }
    if (input.tagIds) {
      await this.requireOwnedTags(userId, input.tagIds);
    }
    const record = await this.prisma.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description,
        goalId: input.goalId,
        parentTaskId: input.parentTaskId,
        priority: input.priority ?? 3,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        dueDate: input.dueDate,
        ...(input.tagIds
          ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: TASK_INCLUDE,
    });
    return toGraphTask(record);
  }

  async update(userId: string, id: string, input: UpdateTaskInput): Promise<Task> {
    await this.requireOwnedTask(userId, id);
    if (input.goalId) {
      await this.requireOwnedGoal(userId, input.goalId);
    }
    if (input.tagIds) {
      await this.requireOwnedTags(userId, input.tagIds);
    }

    if (input.tagIds) {
      await this.prisma.taskTag.deleteMany({ where: { taskId: id } });
    }

    const record = await this.prisma.task.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        goalId: input.goalId,
        priority: input.priority,
        status: input.status as any,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        dueDate: input.dueDate,
        ...(input.tagIds
          ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      include: TASK_INCLUDE,
    });
    return toGraphTask(record);
  }

  async complete(userId: string, id: string, actualDurationMinutes?: number): Promise<Task> {
    await this.requireOwnedTask(userId, id);
    const record = await this.prisma.task.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        actualDurationMinutes,
      },
      include: TASK_INCLUDE,
    });

    // Task duration estimation increment: only worth recomputing when this
    // specific completion actually added a new real data point (a task
    // completed with no actual time given contributes nothing new). Same
    // best-effort try/catch as respondToPlanRun's call into
    // refreshInterventionResponsePattern — a memory-signal recompute must
    // never break the completion the person is waiting on.
    if (actualDurationMinutes != null) {
      try {
        await this.memoryService.refreshTaskDurationAccuracyPattern(userId);
      } catch (error) {
        this.logger.warn(`Task duration accuracy pattern refresh failed: ${(error as Error).message}`);
      }
    }

    // Automatic AI re-planning increment: emits a plain event rather than
    // calling PlannerService directly, since PlannerModule already imports
    // TasksModule (for the daily plan's own use of TasksService) — this
    // module importing PlannerModule back would be circular, the exact
    // reason Task duration estimation's AI call lives on PlannerService
    // instead of here too (see planner.service.ts's estimateDuration
    // comment). `emit` (not `emitAsync`) is deliberate: this fires the
    // listener detached from this request entirely, so a slow or failing
    // auto-replan can never delay or break the completion the person is
    // waiting on — stronger than the usual "await inside a try/catch"
    // best-effort pattern this file uses just above, because it doesn't
    // even share this request's timing.
    this.eventEmitter.emit('task.completed', { userId });

    return toGraphTask(record);
  }

  async cancel(userId: string, id: string): Promise<Task> {
    await this.requireOwnedTask(userId, id);
    const record = await this.prisma.task.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: TASK_INCLUDE,
    });
    return toGraphTask(record);
  }

  // Un-completing a task increment: the completed-tasks view was view-only
  // until now — this is the "undo a misclick" path. Only makes sense
  // starting from COMPLETED (reopening a CANCELLED task, say, would be a
  // different, unrequested feature), so this throws for any other starting
  // status rather than silently doing something the person didn't ask for;
  // the resolver's catch-all turns that into a clear REOPEN_FAILED error.
  // Clears completedAt and actualDurationMinutes since neither is true
  // anymore once the task isn't actually done — leaving stale values around
  // would misrepresent when a task now-reopened was really finished, and
  // (though nothing reads actualDurationMinutes today — see the Automatic
  // AI Memory learning README section) there's no reason to keep a duration
  // tied to a completion that's being undone.
  async reopen(userId: string, id: string): Promise<Task> {
    const existing = await this.requireOwnedTask(userId, id);
    if (existing.status !== 'COMPLETED') {
      throw new Error('Only a completed task can be reopened.');
    }
    const record = await this.prisma.task.update({
      where: { id },
      data: {
        status: 'PENDING',
        completedAt: null,
        actualDurationMinutes: null,
      },
      include: TASK_INCLUDE,
    });
    return toGraphTask(record);
  }

  // Used only by planner.service.ts to hydrate a stored plan diff's taskIds
  // back into full Task objects for the GraphQL response — scoped by userId
  // even though every id came from this same user's own tasks originally,
  // since defense-in-depth here costs nothing.
  async listByIds(userId: string, ids: string[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.task.findMany({
      where: { userId, id: { in: ids } },
      include: TASK_INCLUDE,
    });
    return records.map(toGraphTask);
  }

  // Used only by the AI plan-run accept flow (planner.service.ts) — a
  // proposed MOVE change becomes a real scheduledStart/scheduledEnd once
  // the user accepts it, and isAiScheduled=true is what lets the UI (and
  // any future re-plan) tell an AI-placed slot apart from a manual drag
  // (which sets it back to false — see UpdateTaskInput usage elsewhere).
  async applySchedule(userId: string, id: string, scheduledStart: Date, scheduledEnd: Date): Promise<Task> {
    await this.requireOwnedTask(userId, id);
    const record = await this.prisma.task.update({
      where: { id },
      data: { scheduledStart, scheduledEnd, isAiScheduled: true },
      include: TASK_INCLUDE,
    });
    return toGraphTask(record);
  }

  async createTag(userId: string, name: string, color?: string) {
    return this.prisma.tag.upsert({
      where: { userId_name: { userId, name } },
      update: { color },
      create: { userId, name, color },
    });
  }

  // Insights: task completion trends increment — a lightweight, unhydrated
  // query for AnalyticsService, same reasoning as HabitsService/
  // RoutinesService's own `listRawForAnalytics`: the full `toGraphTask`
  // shape (goal, tags, one level of subtasks) is real overhead this doesn't
  // need, since all AnalyticsService actually does with the result is
  // bucket `completedAt` into a local calendar day. Subtasks are
  // deliberately *not* excluded — a completed subtask is still a completed
  // task, and this app's task-completion trend has no reason to draw that
  // distinction the way, say, the Tasks screen's own top-level listing does.
  async listCompletedInRange(userId: string, fromDate: Date, toDate: Date): Promise<Array<{ completedAt: Date }>> {
    return this.prisma.task.findMany({
      where: { userId, status: 'COMPLETED' as any, completedAt: { gte: fromDate, lte: toDate } },
      select: { completedAt: true },
    }) as unknown as Promise<Array<{ completedAt: Date }>>;
  }
}
