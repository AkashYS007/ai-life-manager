import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { SignalsService } from '../signals/signals.service';
import { PlannerService } from '../planner/planner.service';
import { HabitsService } from '../habits/habits.service';
import { TodayPlan } from './models/today-plan.model';
import { User } from '../users/models/user.model';
import { zonedDayBounds } from '../common/date/zoned-day';

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

@Resolver()
@UseGuards(AuthGuard)
export class TodayResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    private readonly signalsService: SignalsService,
    private readonly plannerService: PlannerService,
    private readonly habitsService: HabitsService,
  ) {}

  @Query(() => TodayPlan)
  async todayPlan(
    @CurrentAuth() auth: AuthContext,
    @Args('date', { nullable: true }) date?: Date,
  ): Promise<TodayPlan> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const resolvedDate = date ?? new Date();
    const tasks = await this.tasksService.listOpenForUser(user.id);

    // Events are bucketed by the user's own local calendar day (§4.3), not
    // the server's day — see zoned-day.ts for why that distinction matters.
    const { start, end } = zonedDayBounds(resolvedDate, user.timezone);
    const events = await this.calendarService.listInRange(user.id, start, end);

    const [todayMood, todayEnergy, lastNightSleep, latestPlanRun, habits] = await Promise.all([
      this.signalsService.getTodayMood(user.id, user.timezone),
      this.signalsService.getTodayEnergy(user.id, user.timezone),
      this.signalsService.getLastNightSleep(user.id, user.timezone),
      this.plannerService.getLatest(user.id),
      this.habitsService.listDueToday(user.id, user.timezone),
    ]);

    return {
      date: resolvedDate,
      greeting: greetingFor(resolvedDate.getHours()),
      user: user as unknown as User,
      tasks,
      tasksCount: tasks.length,
      hasTasks: tasks.length > 0,
      events,
      hasEvents: events.length > 0,
      todayMood: todayMood ?? undefined,
      todayEnergy: todayEnergy ?? undefined,
      lastNightSleep: lastNightSleep ?? undefined,
      latestPlanRun: latestPlanRun ?? undefined,
      habits,
    };
  }
}
