import { Field, ObjectType } from '@nestjs/graphql';
import { User } from '../../users/models/user.model';
import { Task } from '../../tasks/models/task.model';
import { CalendarEvent } from '../../calendar/models/calendar-event.model';
import { MoodEntry } from '../../signals/models/mood-entry.model';
import { EnergyEntry } from '../../signals/models/energy-entry.model';
import { SleepEntry } from '../../signals/models/sleep-entry.model';
import { AiPlanRun } from '../../planner/models/ai-plan-run.model';
import { Habit } from '../../habits/models/habit.model';

// TodayPlan (API Design Document §5.1). `tasks` reflects the real tasks
// table (Tasks feature increment, Database Design Document §4.2); `events`
// reflects the real calendar_events table for the user's local calendar day
// (Calendar feature increment, §4.3); `todayMood`/`todayEnergy`/
// `lastNightSleep` reflect the real signal-collection tables (Signal
// tracking increment, §4.5); `latestPlanRun` reflects the real ai_plan_runs
// table (AI daily planning increment, §4.6) — the most recent proposal,
// whatever its status, so the client can show "review your plan" if it's
// still PROPOSED. `habits` reflects the real habits/habit_logs tables
// (Habits increment, §4.4) — only habits that are both active and due on
// today's local calendar date, each carrying whether today's log is
// already completed.
@ObjectType()
export class TodayPlan {
  @Field()
  date!: Date;

  @Field()
  greeting!: string;

  @Field(() => User)
  user!: User;

  @Field(() => [Task])
  tasks!: Task[];

  @Field()
  tasksCount!: number;

  @Field()
  hasTasks!: boolean;

  @Field(() => [CalendarEvent])
  events!: CalendarEvent[];

  @Field()
  hasEvents!: boolean;

  @Field(() => MoodEntry, { nullable: true })
  todayMood?: MoodEntry;

  @Field(() => EnergyEntry, { nullable: true })
  todayEnergy?: EnergyEntry;

  @Field(() => SleepEntry, { nullable: true })
  lastNightSleep?: SleepEntry;

  @Field(() => AiPlanRun, { nullable: true })
  latestPlanRun?: AiPlanRun;

  @Field(() => [Habit])
  habits!: Habit[];
}
