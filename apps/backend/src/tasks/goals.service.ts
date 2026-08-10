import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Goal } from './models/goal.model';
import { CreateGoalInput } from './dto/create-goal.input';
import { UpdateGoalInput } from './dto/update-goal.input';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  // Goal progress view increment: one `groupBy` covering every goal being
  // returned, rather than a per-goal count query — a real goal list is a
  // handful of rows at this app's scale, but there's no reason to pay an
  // N+1 cost for something one query already answers. `_count` groups by
  // (goalId, status) together, so a single pass over the result can
  // separate "total minus cancelled" from "completed" per goal without a
  // second query. Goals with zero tasks at all — the common case for a
  // freshly created one — simply have no entries here and default to
  // {taskCount: 0, completedTaskCount: 0} below, not a lookup miss/error.
  //
  // Linking habits to goals increment: `linkedHabitCount` is computed the
  // same batched way, from its own `habit.groupBy` run alongside the task
  // one — a habit has no CANCELLED/COMPLETED status to split on the way a
  // task does (see Goal.linkedHabitCount's own comment for why this is a
  // plain count, not folded into taskCount), so its groupBy only needs
  // `goalId`, not `goalId` + `status`.
  private async attachCounts<T extends { id: string }>(goals: T[]): Promise<(T & Goal)[]> {
    if (goals.length === 0) return goals as (T & Goal)[];
    const goalIds = goals.map((g) => g.id);
    const [groupedTasks, groupedHabits] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['goalId', 'status'],
        where: { goalId: { in: goalIds } },
        _count: true,
      }),
      this.prisma.habit.groupBy({
        by: ['goalId'],
        where: { goalId: { in: goalIds } },
        _count: true,
      }),
    ]);
    const counts = new Map<string, { taskCount: number; completedTaskCount: number }>();
    for (const row of groupedTasks) {
      if (!row.goalId) continue;
      const entry = counts.get(row.goalId) ?? { taskCount: 0, completedTaskCount: 0 };
      if (row.status !== 'CANCELLED') entry.taskCount += row._count;
      if (row.status === 'COMPLETED') entry.completedTaskCount += row._count;
      counts.set(row.goalId, entry);
    }
    const habitCounts = new Map<string, number>();
    for (const row of groupedHabits) {
      if (!row.goalId) continue;
      habitCounts.set(row.goalId, row._count);
    }
    return goals.map((goal) => ({
      ...goal,
      taskCount: counts.get(goal.id)?.taskCount ?? 0,
      completedTaskCount: counts.get(goal.id)?.completedTaskCount ?? 0,
      linkedHabitCount: habitCounts.get(goal.id) ?? 0,
    })) as (T & Goal)[];
  }

  async listForUser(userId: string, status?: string): Promise<Goal[]> {
    const goals = await this.prisma.goal.findMany({
      where: { userId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachCounts(goals as unknown as Goal[]);
  }

  async create(userId: string, input: CreateGoalInput): Promise<Goal> {
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: input.title,
        description: input.description,
        targetDate: input.targetDate,
      },
    });
    // A brand-new goal has nothing linked to it yet — real queries would
    // return the same zeros, this just skips the round trip.
    return { ...(goal as unknown as Goal), taskCount: 0, completedTaskCount: 0, linkedHabitCount: 0 };
  }

  async update(userId: string, id: string, input: UpdateGoalInput): Promise<Goal> {
    const existing = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException('Goal not found');
    }
    const goal = await this.prisma.goal.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        targetDate: input.targetDate,
        status: input.status as any,
      },
    });
    const [withCounts] = await this.attachCounts([goal as unknown as Goal]);
    return withCounts;
  }
}
