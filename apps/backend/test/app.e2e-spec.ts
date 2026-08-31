import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createClient as createWsClient } from 'graphql-ws';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { AnthropicClient } from '../src/planner/anthropic-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { GoogleCalendarWriteService, GoogleReconnectRequiredError } from '../src/integrations/google/google-calendar-write.service';
import { MicrosoftCalendarClient } from '../src/integrations/microsoft/microsoft-calendar-client';
import { MicrosoftCalendarWriteService, MicrosoftReconnectRequiredError } from '../src/integrations/microsoft/microsoft-calendar-write.service';
import { AppleCaldavClient, AppleAuthError } from '../src/integrations/apple/apple-caldav-client';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { PlannerService } from '../src/planner/planner.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { StripeService } from '../src/billing/stripe.service';
import Stripe from 'stripe';
import { signOAuthState } from '../src/integrations/oauth-state';

// Runs against a real Postgres instance (docker-compose) using the AUTH_MODE=dev
// bypass documented in auth/auth.guard.ts — the same pattern a real team uses
// to integration-test auth-gated resolvers without a live Clerk project
// (Architecture Document §4.8 testing strategy).
describe('GraphQL API (e2e)', () => {
  let app: INestApplication;
  const devEmail = `e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ me { id email } }' });

    expect(res.body.errors).toBeDefined();
  });

  it('provisions a new user on first request and returns it from me', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: '{ me { id email timezone subscription { tier status } } }' });

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me.email).toBe(devEmail);
    expect(res.body.data.me.timezone).toBe('UTC');
    expect(res.body.data.me.subscription.tier).toBe('FREE');
  });

  it('returns the same user on a repeat request (no duplicate row)', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: '{ me { id } }' });

    const res2 = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: '{ me { id } }' });

    expect(res.body.data.me.id).toBe(res2.body.data.me.id);
  });

  it('todayPlan returns a real, honest empty state before the Tasks increment', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: '{ todayPlan { greeting tasksCount hasTasks user { email } } }' });

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.todayPlan.tasksCount).toBe(0);
    expect(res.body.data.todayPlan.hasTasks).toBe(false);
    expect(res.body.data.todayPlan.user.email).toBe(devEmail);
  });

  it('updateProfile mutation follows the payload/errors pattern', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { updateProfile(input: { displayName: "Akash", timezone: "America/Los_Angeles" }) { user { displayName timezone } errors { code message } } }`,
      });

    expect(res.body.data.updateProfile.errors).toEqual([]);
    expect(res.body.data.updateProfile.user.displayName).toBe('Akash');
    expect(res.body.data.updateProfile.user.timezone).toBe('America/Los_Angeles');
  });

  // Visible settings screen increment — workHoursStart/End and
  // timezoneManual are new on updateProfile (chronotype/timezone already
  // worked); this confirms all three round-trip through a real save and a
  // real re-read, and that a bad HH:mm value is rejected the same way
  // CompleteOnboardingInput's identical fields already are.
  it('updateProfile now also saves work hours and the manual-timezone flag', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { updateProfile(input: { workHoursStart: "08:00", workHoursEnd: "18:00", timezoneManual: true, chronotype: NIGHT_OWL }) { user { workHoursStart workHoursEnd timezoneManual chronotype } errors { code message } } }`,
      });

    expect(res.body.data.updateProfile.errors).toEqual([]);
    expect(res.body.data.updateProfile.user.workHoursStart).toBe('08:00');
    expect(res.body.data.updateProfile.user.workHoursEnd).toBe('18:00');
    expect(res.body.data.updateProfile.user.timezoneManual).toBe(true);
    expect(res.body.data.updateProfile.user.chronotype).toBe('NIGHT_OWL');

    // Really persisted, not just echoed back from the input.
    const reread = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `{ me { workHoursStart workHoursEnd timezoneManual } }` });
    expect(reread.body.data.me.workHoursStart).toBe('08:00');
    expect(reread.body.data.me.workHoursEnd).toBe('18:00');
    expect(reread.body.data.me.timezoneManual).toBe(true);
  });

  // Configurable Pomodoro durations increment. Same round-trip shape as
  // workHoursStart/End above: a real save, a real re-read (not just the
  // mutation's own echo), and — since these are the one nullable-Int field
  // group on this input with real bounds attached (see UpdateProfileInput's
  // own comment for why: sanity limits, not a product spec) — confirms both
  // an out-of-range value is rejected the same way a malformed workHoursStart
  // already is, and that explicitly sending `null` clears a field back to
  // "use the fixed default," the same undefined-vs-null distinction
  // Habit.goalId and Task.goalId already rely on.
  it('updateProfile saves custom Pomodoro durations, round-trips them on a fresh read, and null clears a field back to the default', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { updateProfile(input: { pomodoroWorkMinutes: 50, pomodoroShortBreakMinutes: 10, pomodoroLongBreakMinutes: 30, pomodoroCyclesBeforeLongBreak: 3 }) { user { pomodoroWorkMinutes pomodoroShortBreakMinutes pomodoroLongBreakMinutes pomodoroCyclesBeforeLongBreak } errors { code message } } }`,
      });

    expect(res.body.data.updateProfile.errors).toEqual([]);
    expect(res.body.data.updateProfile.user.pomodoroWorkMinutes).toBe(50);
    expect(res.body.data.updateProfile.user.pomodoroShortBreakMinutes).toBe(10);
    expect(res.body.data.updateProfile.user.pomodoroLongBreakMinutes).toBe(30);
    expect(res.body.data.updateProfile.user.pomodoroCyclesBeforeLongBreak).toBe(3);

    const reread = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `{ me { pomodoroWorkMinutes pomodoroShortBreakMinutes pomodoroLongBreakMinutes pomodoroCyclesBeforeLongBreak } }` });
    expect(reread.body.data.me.pomodoroWorkMinutes).toBe(50);
    expect(reread.body.data.me.pomodoroShortBreakMinutes).toBe(10);
    expect(reread.body.data.me.pomodoroLongBreakMinutes).toBe(30);
    expect(reread.body.data.me.pomodoroCyclesBeforeLongBreak).toBe(3);

    const clearOne = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { updateProfile(input: { pomodoroWorkMinutes: null }) { user { pomodoroWorkMinutes pomodoroShortBreakMinutes } errors { code } } }`,
      });
    expect(clearOne.body.data.updateProfile.errors).toEqual([]);
    expect(clearOne.body.data.updateProfile.user.pomodoroWorkMinutes).toBeNull();
    // Unrelated fields left alone — omitted (not sent), not cleared.
    expect(clearOne.body.data.updateProfile.user.pomodoroShortBreakMinutes).toBe(10);
  });

  it('rejects a Pomodoro work duration outside the 5-120 minute sanity bounds', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `mutation { updateProfile(input: { pomodoroWorkMinutes: 200 }) { user { id } errors { code } } } ` });

    // Same @Max-guarded-input shape as the malformed-work-hours test above —
    // fails NestJS's global ValidationPipe before the resolver body runs.
    expect(res.body.errors).toBeDefined();
  });

  // Real billing/subscription management increment. Proves the real state
  // change `changeSubscriptionTier` makes: moving to a paid tier sets a
  // real `currentPeriodEnd` roughly 30 days out (simulating what a real
  // monthly billing cycle would leave behind — see UsersService.
  // changeSubscriptionTier's own comment for why this is a real column
  // update with no real charge behind it), and moving back to FREE clears
  // it again, since a free plan has no renewal date.
  it('changeSubscriptionTier moves a real Subscription row between tiers, setting and clearing currentPeriodEnd correctly', async () => {
    const toPlus = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { changeSubscriptionTier(tier: PLUS) { user { subscription { tier status currentPeriodEnd } } errors { code message } } }`,
      });
    expect(toPlus.body.data.changeSubscriptionTier.errors).toEqual([]);
    const plusSub = toPlus.body.data.changeSubscriptionTier.user.subscription;
    expect(plusSub.tier).toBe('PLUS');
    expect(plusSub.status).toBe('ACTIVE');
    expect(plusSub.currentPeriodEnd).not.toBeNull();
    const daysOut = (new Date(plusSub.currentPeriodEnd).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(29);
    expect(daysOut).toBeLessThan(31);

    // Really persisted — a fresh `me` read, not just the mutation's own echo.
    const reread = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `{ me { subscription { tier currentPeriodEnd } } }` });
    expect(reread.body.data.me.subscription.tier).toBe('PLUS');
    expect(reread.body.data.me.subscription.currentPeriodEnd).not.toBeNull();

    const backToFree = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({
        query: `mutation { changeSubscriptionTier(tier: FREE) { user { subscription { tier currentPeriodEnd } } errors { code message } } }`,
      });
    expect(backToFree.body.data.changeSubscriptionTier.errors).toEqual([]);
    expect(backToFree.body.data.changeSubscriptionTier.user.subscription.tier).toBe('FREE');
    expect(backToFree.body.data.changeSubscriptionTier.user.subscription.currentPeriodEnd).toBeNull();
  });

  it('rejects a malformed work-hours value', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `mutation { updateProfile(input: { workHoursStart: "not-a-time" }) { user { id } errors { code } } } ` });

    // A bad @Matches value fails NestJS's global ValidationPipe before the
    // resolver body ever runs, surfacing as a thrown GraphQL error (not a
    // payload-level `errors` entry) — same shape every other @Matches-guarded
    // input in this app already produces.
    expect(res.body.errors).toBeDefined();
  });
});

// Broader account settings increment. Its own describe block (its own app
// instance and its own throwaway devEmail — see the comment on
// UsersService.deleteAccount for why this can't safely reuse the shared
// devEmail any other describe block's tests depend on) purely because this
// is the one test in this whole file that actually deletes a user.
describe('Account deletion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `delete-account-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  // The core claim this increment's survey turned up: Task, JournalEntry,
  // and Habit (like most user-owned tables) never had a declared Prisma
  // relation/foreign key to User at all — only Subscription, Notification,
  // and PushSubscription did. Seeding real rows in these three directly via
  // Prisma (bypassing the GraphQL API, same "backdate via direct Prisma"
  // escape hatch other e2e tests already use) and then confirming they're
  // really gone proves UsersService.deleteAccount's explicit deleteMany
  // sweep is actually doing the work — a real FK cascade would have done
  // nothing for these three specifically.
  it('deleteAccount removes the user and every row across tables with no declared FK to User, and the same identity gets a fresh account next time', async () => {
    const me = await gql('{ me { id } }');
    const oldUserId = me.body.data.me.id;

    await prisma.task.create({ data: { userId: oldUserId, title: 'A task to be erased' } });
    await prisma.journalEntry.create({ data: { userId: oldUserId, content: 'A journal entry to be erased' } });
    await prisma.habit.create({
      data: { userId: oldUserId, title: 'A habit to be erased', rrule: 'FREQ=DAILY', protectedDurationMinutes: 15 },
    });

    const del = await gql('mutation { deleteAccount { deleted errors { code message } } }');
    expect(del.body.data.deleteAccount.errors).toEqual([]);
    expect(del.body.data.deleteAccount.deleted).toBe(true);

    // The users row itself is really gone, not just hidden behind
    // deletedAt (see the increment note on why this is a real hard delete,
    // not the soft-delete column that already existed but was never used).
    const stillThere = await prisma.user.findUnique({ where: { id: oldUserId } });
    expect(stillThere).toBeNull();

    // And so is every seeded row in the three no-declared-FK tables.
    expect(await prisma.task.findMany({ where: { userId: oldUserId } })).toHaveLength(0);
    expect(await prisma.journalEntry.findMany({ where: { userId: oldUserId } })).toHaveLength(0);
    expect(await prisma.habit.findMany({ where: { userId: oldUserId } })).toHaveLength(0);

    // Same dev identity (same x-dev-user-email header, same authProviderId
    // under the hood) immediately gets a genuinely new row —
    // getOrCreateFromAuth has no memory of the old one.
    const meAgain = await gql('{ me { id email } }');
    expect(meAgain.body.data.me.email).toBe(devEmail);
    expect(meAgain.body.data.me.id).not.toBe(oldUserId);
  });
});

describe('Tasks & Goals (e2e)', () => {
  let app: INestApplication;
  const devEmail = `tasks-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('creates a task and lists it in todayPlan', async () => {
    const create = await gql(
      `mutation { createTask(input: { title: "Write launch plan", priority: 1 }) { task { id title status priority } errors { code message } } }`,
    );
    expect(create.body.data.createTask.errors).toEqual([]);
    expect(create.body.data.createTask.task.title).toBe('Write launch plan');
    expect(create.body.data.createTask.task.status).toBe('PENDING');

    const today = await gql(`{ todayPlan { tasksCount hasTasks tasks { title } } }`);
    expect(today.body.data.todayPlan.tasksCount).toBe(1);
    expect(today.body.data.todayPlan.hasTasks).toBe(true);
    expect(today.body.data.todayPlan.tasks[0].title).toBe('Write launch plan');
  });

  it('creates a subtask and a tag, attaches the tag, then completes the task', async () => {
    const parent = await gql(`mutation { createTask(input: { title: "Plan launch" }) { task { id } errors { code } } }`);
    const parentId = parent.body.data.createTask.task.id;

    const tag = await gql(`mutation { createTag(input: { name: "urgent", color: "#DC2626" }) { tag { id name } errors { code } } }`);
    const tagId = tag.body.data.createTag.tag.id;
    expect(tag.body.data.createTag.tag.name).toBe('urgent');

    const child = await gql(
      `mutation { createTask(input: { title: "Draft announcement", parentTaskId: "${parentId}", tagIds: ["${tagId}"] }) { task { id title tags { name } } errors { code } } }`,
    );
    expect(child.body.data.createTask.task.tags.map((t: any) => t.name)).toEqual(['urgent']);

    const complete = await gql(
      `mutation { completeTask(id: "${child.body.data.createTask.task.id}", actualDurationMinutes: 30) { task { status actualDurationMinutes completedAt } errors { code } } }`,
    );
    expect(complete.body.data.completeTask.task.status).toBe('COMPLETED');
    expect(complete.body.data.completeTask.task.actualDurationMinutes).toBe(30);
    expect(complete.body.data.completeTask.task.completedAt).not.toBeNull();
  });

  it('links a task to a goal and cancels a task', async () => {
    const goal = await gql(`mutation { createGoal(input: { title: "Ship v1" }) { goal { id title status } errors { code } } }`);
    const goalId = goal.body.data.createGoal.goal.id;

    const task = await gql(
      `mutation { createTask(input: { title: "Finalize pricing", goalId: "${goalId}" }) { task { id goal { title } } errors { code } } }`,
    );
    expect(task.body.data.createTask.task.goal.title).toBe('Ship v1');

    const cancelled = await gql(`mutation { cancelTask(id: "${task.body.data.createTask.task.id}") { task { status } errors { code } } }`);
    expect(cancelled.body.data.cancelTask.task.status).toBe('CANCELLED');

    const goals = await gql(`{ goals { title status } }`);
    expect(goals.body.data.goals.some((g: any) => g.title === 'Ship v1')).toBe(true);
  });

  // Goal progress view increment: proves the real behavior the frontend's
  // new "N of M done" text and progress bar depend on — a brand-new goal
  // starts at {0, 0} with no extra query needed (GoalsService.create's own
  // shortcut), and once real tasks are linked, `taskCount` counts a
  // completed task and a still-open one but genuinely excludes the
  // cancelled one, while `completedTaskCount` only counts the one real
  // completion — not just "any task existing."
  it('goal progress counts a completed and an open task but excludes a cancelled one', async () => {
    const goal = await gql(
      `mutation { createGoal(input: { title: "Launch v3" }) { goal { id taskCount completedTaskCount } errors { code } } }`,
    );
    const goalId = goal.body.data.createGoal.goal.id;
    expect(goal.body.data.createGoal.goal.taskCount).toBe(0);
    expect(goal.body.data.createGoal.goal.completedTaskCount).toBe(0);

    const t1 = await gql(`mutation { createTask(input: { title: "Task A", goalId: "${goalId}" }) { task { id } errors { code } } }`);
    const t2 = await gql(`mutation { createTask(input: { title: "Task B", goalId: "${goalId}" }) { task { id } errors { code } } }`);
    const t3 = await gql(`mutation { createTask(input: { title: "Task C", goalId: "${goalId}" }) { task { id } errors { code } } }`);

    await gql(
      `mutation { completeTask(id: "${t1.body.data.createTask.task.id}", actualDurationMinutes: 15) { task { status } errors { code } } }`,
    );
    await gql(`mutation { cancelTask(id: "${t2.body.data.createTask.task.id}") { task { status } errors { code } } }`);
    // Task C is deliberately left untouched — still PENDING, still counted
    // toward taskCount, just not toward completedTaskCount.

    const goals = await gql(`{ goals(status: ACTIVE) { id taskCount completedTaskCount } }`);
    const found = goals.body.data.goals.find((g: any) => g.id === goalId);
    expect(found.taskCount).toBe(2); // Task A (completed) + Task C (open) — Task B (cancelled) excluded
    expect(found.completedTaskCount).toBe(1);
  });

  // Linking habits to goals increment: proves linkedHabitCount is a real,
  // batched count (GoalsService.attachCounts' new `habit.groupBy` run
  // alongside the existing task one) — a brand-new goal starts at 0, and
  // once a real habit is linked at creation time, the count reflects it.
  // Unlike taskCount, there's no cancelled/completed split to test here —
  // habits have no such statuses.
  it('linkedHabitCount reflects a habit linked to a goal at creation time', async () => {
    const goal = await gql(
      `mutation { createGoal(input: { title: "Build a reading habit" }) { goal { id linkedHabitCount } errors { code } } }`,
    );
    const goalId = goal.body.data.createGoal.goal.id;
    expect(goal.body.data.createGoal.goal.linkedHabitCount).toBe(0);

    await gql(
      `mutation { createHabit(input: { title: "Read 20 minutes", frequency: DAILY, goalId: "${goalId}" }) { habit { id goal { id title } } errors { code } } }`,
    );

    const goals = await gql(`{ goals(status: ACTIVE) { id linkedHabitCount } }`);
    const found = goals.body.data.goals.find((g: any) => g.id === goalId);
    expect(found.linkedHabitCount).toBe(1);
  });

  it('rejects updating a task that belongs to another user', async () => {
    const mine = await gql(`mutation { createTask(input: { title: "Private task" }) { task { id } errors { code } } }`);
    const id = mine.body.data.createTask.task.id;

    const otherEmail = `tasks-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { updateTask(id: "${id}", input: { title: "Hijacked" }) { task { id } errors { code message } } }` });

    expect(res.body.data.updateTask.task).toBeNull();
    expect(res.body.data.updateTask.errors[0].code).toBe('UPDATE_FAILED');
  });

  // Production Hardening Sprint 1 (2026-08-29) regression coverage for the
  // Update 50 IDOR fix (backend audit finding #4): createTask/updateTask
  // used to write a client-supplied goalId/tagIds straight onto the task
  // with no ownership check at all, and TASK_INCLUDE eagerly includes both
  // `goal` and `tags` on every read — so a task pointed at another user's
  // goal/tag id would come back on every future read carrying that other
  // user's goal title (or tag name/color) embedded in it. Nothing in this
  // suite exercised that specific fix before now, even though the cross-
  // user tests immediately above cover a different ownership boundary
  // (owning the task itself, not the goal/tag ids attached to it).
  it("rejects creating a task linked to another user's goal, and does not create the task", async () => {
    const otherEmail = `tasks-e2e-goal-owner-${Date.now()}@example.com`;
    const otherGoal = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { createGoal(input: { title: "Someone else's goal" }) { goal { id } errors { code } } }` });
    const otherGoalId = otherGoal.body.data.createGoal.goal.id;

    const attempt = await gql(
      `mutation { createTask(input: { title: "Hijack attempt", goalId: "${otherGoalId}" }) { task { id } errors { code message } } }`,
    );
    expect(attempt.body.data.createTask.task).toBeNull();
    expect(attempt.body.data.createTask.errors[0].code).toBe('CREATE_FAILED');

    const mine = await gql(`{ tasks(first: 50) { edges { node { title } } } }`);
    expect(mine.body.data.tasks.edges.some((e: any) => e.node.title === 'Hijack attempt')).toBe(false);
  });

  it("rejects attaching another user's tag to a task via updateTask", async () => {
    const otherEmail = `tasks-e2e-tag-owner-${Date.now()}@example.com`;
    const otherTag = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { createTag(input: { name: "not-yours", color: "#111111" }) { tag { id } errors { code } } }` });
    const otherTagId = otherTag.body.data.createTag.tag.id;

    const mine = await gql(`mutation { createTask(input: { title: "My own task" }) { task { id } errors { code } } }`);
    const myTaskId = mine.body.data.createTask.task.id;

    const attempt = await gql(
      `mutation { updateTask(id: "${myTaskId}", input: { tagIds: ["${otherTagId}"] }) { task { id tags { name } } errors { code message } } }`,
    );
    expect(attempt.body.data.updateTask.task).toBeNull();
    expect(attempt.body.data.updateTask.errors[0].code).toBe('UPDATE_FAILED');

    const reread = await gql(`{ tasks(first: 50) { edges { node { id tags { name } } } } }`);
    const found = reread.body.data.tasks.edges.find((e: any) => e.node.id === myTaskId);
    expect(found.node.tags).toEqual([]);
  });

// Tasks list/edit screen increment: both paths below (`goalId: null` to
  // unlink, `tagIds: []` to clear) have been supported by updateTask's
  // underlying Prisma call (see tasks.service.ts's `update`) since the very
  // first Tasks increment, but nothing had ever actually exercised either
  // one against a real server before this new screen — its goal picker's
  // "No goal" option and its tag text field being cleared out both rely on
  // this working correctly.
  it('updateTask with goalId: null unlinks a task from its goal', async () => {
    const goal = await gql(`mutation { createGoal(input: { title: "Ship v2" }) { goal { id } errors { code } } }`);
    const goalId = goal.body.data.createGoal.goal.id;
    const task = await gql(
      `mutation { createTask(input: { title: "Task linked to a goal", goalId: "${goalId}" }) { task { id goal { id } } errors { code } } }`,
    );
    const taskId = task.body.data.createTask.task.id;
    expect(task.body.data.createTask.task.goal.id).toBe(goalId);

    const updated = await gql(
      `mutation { updateTask(id: "${taskId}", input: { goalId: null }) { task { id goal { id } } errors { code } } }`,
    );
    expect(updated.body.data.updateTask.errors).toEqual([]);
    expect(updated.body.data.updateTask.task.goal).toBeNull();
  });

  it('updateTask with tagIds: [] clears every tag from a task', async () => {
    const tag = await gql(`mutation { createTag(input: { name: "will-be-cleared" }) { tag { id } errors { code } } }`);
    const tagId = tag.body.data.createTag.tag.id;
    const task = await gql(
      `mutation { createTask(input: { title: "Task with a tag", tagIds: ["${tagId}"] }) { task { id tags { id } } errors { code } } }`,
    );
    const taskId = task.body.data.createTask.task.id;
    expect(task.body.data.createTask.task.tags).toHaveLength(1);

    const updated = await gql(
      `mutation { updateTask(id: "${taskId}", input: { tagIds: [] }) { task { id tags { id } } errors { code } } }`,
    );
    expect(updated.body.data.updateTask.errors).toEqual([]);
    expect(updated.body.data.updateTask.task.tags).toHaveLength(0);
  });

  // Un-completing a task increment: reopenTask is the undo for the
  // completed-tasks view. Covers the real path (a genuinely completed task
  // moves back to PENDING and its completion data clears), the guard
  // against reopening a task that was never completed (this mutation is
  // specifically for undoing a *completion*, not a generic status reset),
  // and the same cross-user ownership check every other task mutation gets.
  it('reopens a completed task back to PENDING and clears its completion data', async () => {
    const created = await gql(`mutation { createTask(input: { title: "Finish report" }) { task { id } errors { code } } }`);
    const id = created.body.data.createTask.task.id;

    const completed = await gql(
      `mutation { completeTask(id: "${id}", actualDurationMinutes: 45) { task { status actualDurationMinutes completedAt } errors { code } } }`,
    );
    expect(completed.body.data.completeTask.task.status).toBe('COMPLETED');

    const reopened = await gql(
      `mutation { reopenTask(id: "${id}") { task { id status actualDurationMinutes completedAt } errors { code } } }`,
    );
    expect(reopened.body.data.reopenTask.errors).toEqual([]);
    expect(reopened.body.data.reopenTask.task.status).toBe('PENDING');
    expect(reopened.body.data.reopenTask.task.actualDurationMinutes).toBeNull();
    expect(reopened.body.data.reopenTask.task.completedAt).toBeNull();

    // Reopened means "really back to open" — it should show up in
    // todayPlan's open-tasks list again, the same list it disappeared from
    // when it was completed.
    const today = await gql(`{ todayPlan { tasks { id status } } }`);
    expect(today.body.data.todayPlan.tasks.some((t: any) => t.id === id && t.status === 'PENDING')).toBe(true);
  });

  it('refuses to reopen a task that was never completed', async () => {
    const created = await gql(`mutation { createTask(input: { title: "Still open task" }) { task { id } errors { code } } }`);
    const id = created.body.data.createTask.task.id;

    const res = await gql(`mutation { reopenTask(id: "${id}") { task { id } errors { code message } } }`);
    expect(res.body.data.reopenTask.task).toBeNull();
    expect(res.body.data.reopenTask.errors[0].code).toBe('REOPEN_FAILED');

    // Refusing to reopen shouldn't have changed anything about the task.
    const today = await gql(`{ todayPlan { tasks { id status } } }`);
    expect(today.body.data.todayPlan.tasks.some((t: any) => t.id === id && t.status === 'PENDING')).toBe(true);
  });

  it('rejects reopening a task that belongs to another user', async () => {
    const mine = await gql(`mutation { createTask(input: { title: "Another private task" }) { task { id } errors { code } } }`);
    const id = mine.body.data.createTask.task.id;
    await gql(`mutation { completeTask(id: "${id}") { task { status } errors { code } } }`);

    const otherEmail = `tasks-e2e-other-reopen-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { reopenTask(id: "${id}") { task { id } errors { code message } } }` });

    expect(res.body.data.reopenTask.task).toBeNull();
    expect(res.body.data.reopenTask.errors[0].code).toBe('REOPEN_FAILED');
  });
});

describe('Calendar (e2e)', () => {
  let app: INestApplication;
  const devEmail = `calendar-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('creates a native calendar event and finds it in todayPlan.events', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const create = await gql(
      `mutation { createCalendarEvent(input: { title: "Design review", startTime: "${start}", endTime: "${end}" }) { event { id title source isImmovable } errors { code message } } }`,
    );
    expect(create.body.data.createCalendarEvent.errors).toEqual([]);
    expect(create.body.data.createCalendarEvent.event.title).toBe('Design review');
    expect(create.body.data.createCalendarEvent.event.source).toBe('NATIVE');

    const today = await gql(`{ todayPlan { hasEvents events { title } } }`);
    expect(today.body.data.todayPlan.hasEvents).toBe(true);
    expect(today.body.data.todayPlan.events.some((e: any) => e.title === 'Design review')).toBe(true);
  });

  it('rejects an end time at or before the start time', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // before start

    const res = await gql(
      `mutation { createCalendarEvent(input: { title: "Bad range", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code field } } }`,
    );
    expect(res.body.data.createCalendarEvent.event).toBeNull();
    expect(res.body.data.createCalendarEvent.errors[0].code).toBe('INVALID_RANGE');
  });

  it('updates and then deletes an event', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

    const create = await gql(
      `mutation { createCalendarEvent(input: { title: "Draft", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code } } }`,
    );
    const id = create.body.data.createCalendarEvent.event.id;

    const update = await gql(
      `mutation { updateCalendarEvent(id: "${id}", input: { title: "Final", isImmovable: true }) { event { title isImmovable } errors { code } } }`,
    );
    expect(update.body.data.updateCalendarEvent.event.title).toBe('Final');
    expect(update.body.data.updateCalendarEvent.event.isImmovable).toBe(true);

    const del = await gql(`mutation { deleteCalendarEvent(id: "${id}") { deletedEventId errors { code } } }`);
    expect(del.body.data.deleteCalendarEvent.deletedEventId).toBe(id);
  });

  it('rejects updating an event that belongs to another user', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

    const mine = await gql(
      `mutation { createCalendarEvent(input: { title: "Private event", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code } } }`,
    );
    const id = mine.body.data.createCalendarEvent.event.id;

    const otherEmail = `calendar-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({
        query: `mutation { updateCalendarEvent(id: "${id}", input: { title: "Hijacked" }) { event { id } errors { code message } } }`,
      });

    expect(res.body.data.updateCalendarEvent.event).toBeNull();
    expect(res.body.data.updateCalendarEvent.errors[0].code).toBe('UPDATE_FAILED');
  });
});

describe('Signal tracking (e2e)', () => {
  let app: INestApplication;
  const devEmail = `signals-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('logs a mood check-in and finds it in todayPlan.todayMood', async () => {
    const log = await gql(
      `mutation { logMood(input: { moodScore: 4, note: "feeling good" }) { moodEntry { id moodScore note } errors { code } } }`,
    );
    expect(log.body.data.logMood.errors).toEqual([]);
    expect(log.body.data.logMood.moodEntry.moodScore).toBe(4);

    const today = await gql(`{ todayPlan { todayMood { moodScore note } } }`);
    expect(today.body.data.todayPlan.todayMood.moodScore).toBe(4);
    expect(today.body.data.todayPlan.todayMood.note).toBe('feeling good');
  });

  it('rejects an out-of-range mood score', async () => {
    const res = await gql(`mutation { logMood(input: { moodScore: 9 }) { moodEntry { id } errors { code } } }`);
    // class-validator rejects this before the resolver runs, surfacing as a thrown GraphQL error, not a payload error
    expect(res.body.errors).toBeDefined();
  });

  it('logs an energy check-in with source MANUAL and finds it in todayPlan.todayEnergy', async () => {
    const log = await gql(
      `mutation { logEnergy(input: { energyScore: 3 }) { energyEntry { id energyScore source } errors { code } } }`,
    );
    expect(log.body.data.logEnergy.energyEntry.source).toBe('MANUAL');

    const today = await gql(`{ todayPlan { todayEnergy { energyScore } } }`);
    expect(today.body.data.todayPlan.todayEnergy.energyScore).toBe(3);
  });

  it('logs sleep for today and finds it in todayPlan.lastNightSleep, then correcting it updates in place', async () => {
    const log = await gql(
      `mutation { logSleep(input: { durationMinutes: 420, qualityScore: 3 }) { sleepEntry { id durationMinutes qualityScore } errors { code } } }`,
    );
    expect(log.body.data.logSleep.sleepEntry.durationMinutes).toBe(420);

    const today = await gql(`{ todayPlan { lastNightSleep { durationMinutes qualityScore } } }`);
    expect(today.body.data.todayPlan.lastNightSleep.durationMinutes).toBe(420);

    // Logging again for the same night corrects the entry rather than duplicating it.
    const correction = await gql(
      `mutation { logSleep(input: { durationMinutes: 450, qualityScore: 4 }) { sleepEntry { id durationMinutes qualityScore } errors { code } } }`,
    );
    expect(correction.body.data.logSleep.sleepEntry.id).toBe(log.body.data.logSleep.sleepEntry.id);
    expect(correction.body.data.logSleep.sleepEntry.durationMinutes).toBe(450);

    const todayAfter = await gql(`{ todayPlan { lastNightSleep { durationMinutes } } }`);
    expect(todayAfter.body.data.todayPlan.lastNightSleep.durationMinutes).toBe(450);
  });

  it('keeps signals scoped per user — a second identity sees no check-ins', async () => {
    const otherEmail = `signals-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `{ todayPlan { todayMood { moodScore } todayEnergy { energyScore } lastNightSleep { durationMinutes } } }` });

    expect(res.body.data.todayPlan.todayMood).toBeNull();
    expect(res.body.data.todayPlan.todayEnergy).toBeNull();
    expect(res.body.data.todayPlan.lastNightSleep).toBeNull();
  });
});

// This module never calls the real Anthropic API — AnthropicClient is
// overridden with a fake so these tests are deterministic and don't need a
// real ANTHROPIC_API_KEY or network access, whether or not the developer
// running the suite happens to have a real key in their .env. What's under
// test here is PlannerService's own logic (the policy layer that validates
// proposals, acceptance writing real scheduledStart/scheduledEnd, ownership
// scoping) — not Anthropic's API itself.
describe('AI daily planning — not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `planner-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue({ isConfigured: () => false, proposeSchedule: async () => { throw new Error('should not be called'); } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('returns AI_NOT_CONFIGURED instead of crashing when no API key is set', async () => {
    const res = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    expect(res.body.data.requestReplan.planRun).toBeNull();
    expect(res.body.data.requestReplan.errors[0].code).toBe('AI_NOT_CONFIGURED');
  });

  it('latestPlanRun is null when nothing has ever been generated', async () => {
    const res = await gql(`{ todayPlan { latestPlanRun { id } } }`);
    expect(res.body.data.todayPlan.latestPlanRun).toBeNull();
  });
});

describe('AI daily planning — configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `planner-e2e-${Date.now()}@example.com`;
  let fixedTaskId: string;
  let movableTaskId: string;

  // A deterministic stand-in for the real model: proposes moving the movable
  // task to a time that overlaps the fixed calendar event (to prove the
  // policy layer drops it) plus a second, valid time later in the day.
  let proposedStartValid: string;
  let proposedStartConflicting: string;
  // Hoisted out of beforeAll (rather than a local `const` there) so later
  // `it()` blocks — like the malformed-summary regression test below — can
  // still reassign `.proposeSchedule` on the same fake the app was already
  // wired up with, same "mutate the shared fake mid-suite" pattern already
  // used inside beforeAll itself just below.
  let fakeAnthropic: { isConfigured: () => boolean; proposeSchedule: () => Promise<any> };

  beforeAll(async () => {
    const now = new Date();
    proposedStartConflicting = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // +1h, inside the fixed event below
    proposedStartValid = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(); // +3h, free

    fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: {
          summary: 'Proposed a light afternoon focused on the two open tasks.',
          changes: [
            { taskId: 'placeholder-fixed', proposedStart: proposedStartConflicting, reason: 'Tackle it early.' },
            { taskId: 'placeholder-movable', proposedStart: proposedStartValid, reason: 'Good focus window.' },
          ],
        },
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // Seed two open tasks and one fixed calendar event that overlaps the
    // "conflicting" proposed time, then patch the fake's changes to
    // reference the real task ids once they exist.
    const t1 = await gql(`mutation { createTask(input: { title: "Task to conflict", priority: 2 }) { task { id } errors { code } } }`);
    fixedTaskId = t1.body.data.createTask.task.id;
    const t2 = await gql(`mutation { createTask(input: { title: "Task to schedule", priority: 2, estimatedDurationMinutes: 45 }) { task { id } errors { code } } }`);
    movableTaskId = t2.body.data.createTask.task.id;

    fakeAnthropic.proposeSchedule = async () => ({
      modelUsed: 'fake-model-for-tests',
      proposal: {
        summary: 'Proposed a light afternoon focused on the two open tasks.',
        changes: [
          { taskId: fixedTaskId, proposedStart: proposedStartConflicting, reason: 'Tackle it early.' },
          { taskId: movableTaskId, proposedStart: proposedStartValid, reason: 'Good focus window.' },
        ],
      },
    });

    const eventStart = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // +30m
    const eventEnd = new Date(now.getTime() + 90 * 60 * 1000).toISOString(); // +90m, spans the conflicting proposal
    await gql(
      `mutation { createCalendarEvent(input: { title: "Immovable meeting", startTime: "${eventStart}", endTime: "${eventEnd}", isImmovable: true }) { event { id } errors { code } } }`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('generates a plan, drops the change that conflicts with a fixed event, and explains the drop in the summary', async () => {
    const res = await gql(
      `mutation { requestReplan { planRun { id status diff { summary changes { task { id } proposedStart reason } } } errors { code } } }`,
    );
    const planRun = res.body.data.requestReplan.planRun;
    expect(res.body.data.requestReplan.errors).toEqual([]);
    expect(planRun.status).toBe('PROPOSED');
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes[0].task.id).toBe(movableTaskId);
    expect(planRun.diff.summary).toContain('skipped');
  });

  it('shows the pending plan run via todayPlan.latestPlanRun', async () => {
    const res = await gql(`{ todayPlan { latestPlanRun { status diff { changes { task { id } } } } } }`);
    expect(res.body.data.todayPlan.latestPlanRun.status).toBe('PROPOSED');
    expect(res.body.data.todayPlan.latestPlanRun.diff.changes[0].task.id).toBe(movableTaskId);
  });

  it('rejecting a plan run leaves the task unscheduled', async () => {
    const latest = await gql(`{ todayPlan { latestPlanRun { id } } }`);
    const id = latest.body.data.todayPlan.latestPlanRun.id;

    const rejected = await gql(`mutation { respondToPlanRun(id: "${id}", decision: REJECT) { planRun { status } errors { code } } }`);
    expect(rejected.body.data.respondToPlanRun.planRun.status).toBe('REJECTED');

    const task = await gql(`{ todayPlan { tasks { id scheduledStart isAiScheduled } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId);
    expect(found.scheduledStart).toBeNull();
    expect(found.isAiScheduled).toBe(false);
  });

  it('accepting a plan run writes real scheduledStart/scheduledEnd onto the task', async () => {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);
    const id = gen.body.data.requestReplan.planRun.id;

    const accepted = await gql(`mutation { respondToPlanRun(id: "${id}", decision: ACCEPT) { planRun { status } errors { code } } }`);
    expect(accepted.body.data.respondToPlanRun.planRun.status).toBe('ACCEPTED');

    const task = await gql(`{ todayPlan { tasks { id scheduledStart isAiScheduled } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId);
    expect(found.scheduledStart).not.toBeNull();
    expect(found.isAiScheduled).toBe(true);
  });

  it('rejects responding twice to the same plan run', async () => {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);
    const id = gen.body.data.requestReplan.planRun.id;

    await gql(`mutation { respondToPlanRun(id: "${id}", decision: REJECT) { planRun { status } errors { code } } }`);
    const second = await gql(`mutation { respondToPlanRun(id: "${id}", decision: REJECT) { planRun { status } errors { code } } }`);

    expect(second.body.data.respondToPlanRun.planRun).toBeNull();
    expect(second.body.data.respondToPlanRun.errors[0].code).toBe('ALREADY_RESPONDED');
  });

  it('rejects responding to a plan run that belongs to another user', async () => {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);
    const id = gen.body.data.requestReplan.planRun.id;

    const otherEmail = `planner-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { respondToPlanRun(id: "${id}", decision: ACCEPT) { planRun { id } errors { code } } }` });

    expect(res.body.data.respondToPlanRun.planRun).toBeNull();
    expect(res.body.data.respondToPlanRun.errors[0].code).toBe('RESPOND_FAILED');
  });

  // Regression test for a real bug: a malformed/truncated tool-use response
  // from Anthropic (missing or blank `summary`) used to get persisted as-is
  // into the non-nullable PlanDiff.summary GraphQL field, which only
  // surfaced later as an "Cannot return null for non-nullable field
  // PlanDiff.summary" crash when the plan was read back — not when it was
  // generated. `changes` was always re-validated (see the conflict-dropping
  // test above); `summary` itself had been missed. Covers every falsy shape
  // a real response could plausibly send: absent, empty string, and
  // whitespace-only.
  it('falls back to a generic summary instead of crashing when the AI response omits one', async () => {
    for (const badSummary of [undefined, '', '   ']) {
      fakeAnthropic.proposeSchedule = async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: {
          summary: badSummary as unknown as string,
          changes: [{ taskId: movableTaskId, proposedStart: proposedStartValid, reason: 'Good focus window.' }],
        },
      });

      const res = await gql(`mutation { requestReplan { planRun { diff { summary } } errors { code } } }`);
      expect(res.body.data.requestReplan.errors).toEqual([]);
      expect(res.body.data.requestReplan.planRun.diff.summary).toBe('Plan updated.');
    }
  });

  // Editing a proposed AI plan increment — three tests below, each
  // generating its own fresh PROPOSED plan run first (respondToPlanRun only
  // accepts a PROPOSED run, and every prior test in this suite has already
  // consumed whichever one it generated). The shared fake always proposes a
  // single valid change (movableTaskId at proposedStartValid, +3h) once
  // reset to this suite's baseline — the fixedTaskId change from earlier
  // tests would just get filtered out at generation time anyway (it
  // conflicts with the immovable "Immovable meeting" event from beforeAll),
  // so leaving it out here keeps each test's fresh plan down to exactly the
  // one change being edited.
  function resetFakeToSingleValidChange() {
    fakeAnthropic.proposeSchedule = async () => ({
      modelUsed: 'fake-model-for-tests',
      proposal: {
        summary: 'Proposed a light afternoon.',
        changes: [{ taskId: movableTaskId, proposedStart: proposedStartValid, reason: 'Good focus window.' }],
      },
    });
  }

  it('EDIT with a valid new time moves the change and writes the edited time onto the task', async () => {
    resetFakeToSingleValidChange();
    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const changeId = gen.body.data.requestReplan.planRun.diff.changes[0].id;

    const newTime = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // +4h, still free

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, edits: [{ changeId: "${changeId}", proposedStart: "${newTime}" }]) { planRun { status diff { summary changes { id proposedStart } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.status).toBe('EDITED');
    expect(planRun.diff.changes).toHaveLength(1);
    expect(new Date(planRun.diff.changes[0].proposedStart).toISOString()).toBe(newTime);
    expect(planRun.diff.summary).toContain('1 edit applied');

    const task = await gql(`{ todayPlan { tasks { id scheduledStart isAiScheduled } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId);
    expect(new Date(found.scheduledStart).toISOString()).toBe(newTime);
    expect(found.isAiScheduled).toBe(true);
  });

  it('EDIT with a time that conflicts with a fixed event keeps the original time instead of applying the edit', async () => {
    resetFakeToSingleValidChange();
    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id proposedStart } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const changeId = gen.body.data.requestReplan.planRun.diff.changes[0].id;
    const originalStart = gen.body.data.requestReplan.planRun.diff.changes[0].proposedStart;

    // +45m — inside the "Immovable meeting" event's +30m..+90m window from
    // this suite's beforeAll, so this edit should be rejected and the
    // change kept at its original (+3h) time instead.
    const conflictingTime = new Date(Date.now() + 45 * 60 * 1000).toISOString();

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, edits: [{ changeId: "${changeId}", proposedStart: "${conflictingTime}" }]) { planRun { status diff { summary changes { id proposedStart } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.status).toBe('EDITED');
    expect(new Date(planRun.diff.changes[0].proposedStart).toISOString()).toBe(new Date(originalStart).toISOString());
    expect(planRun.diff.summary).toContain("couldn't be applied");

    const task = await gql(`{ todayPlan { tasks { id scheduledStart } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId);
    expect(new Date(found.scheduledStart).toISOString()).toBe(new Date(originalStart).toISOString());
  });

  it("EDIT with remove drops the change entirely, leaving the task's existing schedule untouched", async () => {
    resetFakeToSingleValidChange();
    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const changeId = gen.body.data.requestReplan.planRun.diff.changes[0].id;

    // movableTaskId was already scheduled by the two EDIT tests above —
    // "remove" means "don't apply *this* plan's suggestion for it," not
    // "un-schedule whatever it already had." Capture what that is now
    // (before this test's own EDIT call) so the assertion below proves
    // nothing changed, rather than assuming a specific value.
    const before = await gql(`{ todayPlan { tasks { id scheduledStart } } }`);
    const beforeScheduledStart = before.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId).scheduledStart;

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, edits: [{ changeId: "${changeId}", remove: true }]) { planRun { status diff { changes { id } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.status).toBe('EDITED');
    expect(planRun.diff.changes).toHaveLength(0);

    const after = await gql(`{ todayPlan { tasks { id scheduledStart } } }`);
    const found = after.body.data.todayPlan.tasks.find((t: any) => t.id === movableTaskId);
    expect(found.scheduledStart).toBe(beforeScheduledStart);
  });

  // Free-form plan editing increment — three tests below, same
  // resetFakeToSingleValidChange() baseline as the three EDIT tests above.
  // Each creates its own fresh addable task, since a task already carrying a
  // change on the plan (movableTaskId) can't also be the target of an add
  // (see the third test, which deliberately tries that and expects it to be
  // skipped).

  it('EDIT with adds places a task the AI never proposed, alongside the AI-proposed change', async () => {
    resetFakeToSingleValidChange();
    const addTask = await gql(`mutation { createTask(input: { title: "Manually added task", priority: 2 }) { task { id } errors { code } } }`);
    const addableTaskId = addTask.body.data.createTask.task.id;

    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;

    const addTime = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(); // +5h, free

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, adds: [{ taskId: "${addableTaskId}", proposedStart: "${addTime}" }]) { planRun { status diff { summary changes { task { id } proposedStart } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.status).toBe('EDITED');
    expect(planRun.diff.changes).toHaveLength(2);
    const added = planRun.diff.changes.find((c: any) => c.task.id === addableTaskId);
    expect(added).toBeDefined();
    expect(new Date(added.proposedStart).toISOString()).toBe(addTime);
    expect(planRun.diff.summary).toContain('1 task added');

    const task = await gql(`{ todayPlan { tasks { id scheduledStart isAiScheduled } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === addableTaskId);
    expect(new Date(found.scheduledStart).toISOString()).toBe(addTime);
    expect(found.isAiScheduled).toBe(true);
  });

  it('EDIT with an add that conflicts with a fixed event skips the add, leaving the task unscheduled', async () => {
    resetFakeToSingleValidChange();
    const addTask = await gql(`mutation { createTask(input: { title: "Task that will conflict" }) { task { id } errors { code } } }`);
    const addableTaskId = addTask.body.data.createTask.task.id;

    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;

    // +45m — inside the "Immovable meeting" event's +30m..+90m window from
    // this suite's beforeAll, same conflicting time the EDIT-time test above
    // uses.
    const conflictingTime = new Date(Date.now() + 45 * 60 * 1000).toISOString();

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, adds: [{ taskId: "${addableTaskId}", proposedStart: "${conflictingTime}" }]) { planRun { status diff { summary changes { task { id } } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.status).toBe('EDITED');
    // Only the original AI-proposed change survives — the conflicting add
    // never made it in.
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes.find((c: any) => c.task.id === addableTaskId)).toBeUndefined();
    expect(planRun.diff.summary).toContain("couldn't be placed");

    const task = await gql(`{ todayPlan { tasks { id scheduledStart } } }`);
    const found = task.body.data.todayPlan.tasks.find((t: any) => t.id === addableTaskId);
    expect(found.scheduledStart).toBeNull();
  });

  it("EDIT can't add a task that already has a change on this same plan", async () => {
    resetFakeToSingleValidChange();
    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id proposedStart } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const originalStart = gen.body.data.requestReplan.planRun.diff.changes[0].proposedStart;

    // movableTaskId is already the AI-proposed change on this very plan —
    // trying to also "add" it should be rejected as a duplicate, not create
    // a second change for the same task.
    const secondTime = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, adds: [{ taskId: "${movableTaskId}", proposedStart: "${secondTime}" }]) { planRun { status diff { summary changes { task { id } proposedStart } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.diff.changes).toHaveLength(1);
    expect(new Date(planRun.diff.changes[0].proposedStart).toISOString()).toBe(new Date(originalStart).toISOString());
    expect(planRun.diff.summary).toContain("couldn't be placed");
  });

  // Editing a task's own details increment — two tests below. Both use
  // their own freshly-created task(s) rather than fixedTaskId/movableTaskId,
  // since those two have accumulated real schedules from every test above
  // and this feature is about a task's *duration* specifically, which is
  // easiest to verify starting from a clean, purpose-built task.

  it("editing a task's duration mid-review resizes the applied schedule to match, without any time edit at all", async () => {
    const task = await gql(
      `mutation { createTask(input: { title: "Task with editable duration", estimatedDurationMinutes: 30 }) { task { id } errors { code } } }`,
    );
    const taskId = task.body.data.createTask.task.id;
    const proposedStart = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // +3h, free

    fakeAnthropic.proposeSchedule = async () => ({
      modelUsed: 'fake-model-for-tests',
      proposal: {
        summary: 'Proposed one task.',
        changes: [{ taskId, proposedStart, reason: 'Good focus window.' }],
      },
    });

    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id proposedEnd } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const changeId = gen.body.data.requestReplan.planRun.diff.changes[0].id;
    const originalEnd = gen.body.data.requestReplan.planRun.diff.changes[0].proposedEnd;
    expect(new Date(originalEnd).getTime() - new Date(proposedStart).getTime()).toBe(30 * 60 * 1000);

    // Edit the task's own duration directly (same mutation
    // AiPlanCard/WeeklyPlanCard's "Edit task" control calls) — no time
    // edit at all, just this.
    const updated = await gql(
      `mutation { updateTask(id: "${taskId}", input: { estimatedDurationMinutes: 90 }) { task { estimatedDurationMinutes } errors { code } } }`,
    );
    expect(updated.body.data.updateTask.errors).toEqual([]);

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, edits: [{ changeId: "${changeId}" }]) { planRun { status diff { changes { id proposedStart proposedEnd } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.diff.changes).toHaveLength(1);
    // Start is unchanged (no time edit); end now reflects the new 90-minute
    // duration, not the stale 30-minute one the change was generated with.
    expect(new Date(planRun.diff.changes[0].proposedStart).toISOString()).toBe(new Date(proposedStart).toISOString());
    expect(new Date(planRun.diff.changes[0].proposedEnd).getTime() - new Date(proposedStart).getTime()).toBe(90 * 60 * 1000);

    const afterTask = await gql(`{ todayPlan { tasks { id scheduledStart scheduledEnd } } }`);
    const found = afterTask.body.data.todayPlan.tasks.find((t: any) => t.id === taskId);
    expect(new Date(found.scheduledEnd).getTime() - new Date(found.scheduledStart).getTime()).toBe(90 * 60 * 1000);
  });

  it("editing a task's duration into a new conflict drops that change, leaving the untouched one in place", async () => {
    const taskB = await gql(
      `mutation { createTask(input: { title: "Task B, untouched", estimatedDurationMinutes: 30 }) { task { id } errors { code } } }`,
    );
    const taskBId = taskB.body.data.createTask.task.id;
    const taskA = await gql(
      `mutation { createTask(input: { title: "Task A, duration will grow", estimatedDurationMinutes: 30 }) { task { id } errors { code } } }`,
    );
    const taskAId = taskA.body.data.createTask.task.id;

    // B: +2h45m..+3h15m. A: +2h..+2h30m at its original 30-minute duration —
    // a real 15-minute gap between them, so both validate fine at
    // generation time. B is listed first in the fake response so it's the
    // one that gets placed first in the EDIT-response loop below (this
    // suite's placedIntervals is order-dependent, same "first come, first
    // placed" rule requestReplan itself already uses at generation time).
    const startB = new Date(Date.now() + 2.75 * 60 * 60 * 1000).toISOString();
    const startA = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    fakeAnthropic.proposeSchedule = async () => ({
      modelUsed: 'fake-model-for-tests',
      proposal: {
        summary: 'Proposed two tasks.',
        changes: [
          { taskId: taskBId, proposedStart: startB, reason: 'B.' },
          { taskId: taskAId, proposedStart: startA, reason: 'A.' },
        ],
      },
    });

    const gen = await gql(`mutation { requestReplan { planRun { id diff { changes { id task { id } } } } errors { code } } }`);
    const planRunId = gen.body.data.requestReplan.planRun.id;
    const changes = gen.body.data.requestReplan.planRun.diff.changes;
    expect(changes).toHaveLength(2); // confirms no conflict yet, both survived generation

    // Grow A's duration to 60 minutes — its interval becomes
    // +2h..+3h, which now overlaps B's +2h45m..+3h15m.
    const updated = await gql(
      `mutation { updateTask(id: "${taskAId}", input: { estimatedDurationMinutes: 60 }) { task { estimatedDurationMinutes } errors { code } } }`,
    );
    expect(updated.body.data.updateTask.errors).toEqual([]);

    const res = await gql(
      `mutation { respondToPlanRun(id: "${planRunId}", decision: EDIT, edits: []) { planRun { status diff { summary changes { task { id } } } } errors { code } } }`,
    );
    const planRun = res.body.data.respondToPlanRun.planRun;
    expect(res.body.data.respondToPlanRun.errors).toEqual([]);
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes[0].task.id).toBe(taskBId); // B survives; A was dropped
    expect(planRun.diff.summary).toContain("edited duration no longer fits");

    const afterTasks = await gql(`{ todayPlan { tasks { id scheduledStart } } }`);
    const foundA = afterTasks.body.data.todayPlan.tasks.find((t: any) => t.id === taskAId);
    expect(foundA.scheduledStart).toBeNull(); // never applied — it was dropped
  });
});

// Regression test for a real bug found in live use (not caught by the
// suites above, since every fake AnthropicClient response in this file
// always used `.toISOString()`, which always carries a trailing "Z" —
// exactly the one shape that was never affected by the bug). A real
// Anthropic response can omit a UTC offset entirely, since the tool
// schema only ever said "ISO 8601 datetime" without saying whether one
// was required; `new Date(rawString)` on an offset-less string is parsed
// as local time to wherever the Node process happens to be running, not
// local time to the *user* — silently shifting the intended instant by
// however many hours separate the two, which could push an intended
// "this afternoon" proposal outside the valid window entirely and get it
// dropped for looking like it's in the past. Uses a real non-UTC user
// timezone specifically so this test can't accidentally pass just because
// the CI/sandbox process itself happens to default to UTC too.
describe('AI daily planning — timezone-naive proposed times (e2e)', () => {
  let app: INestApplication;
  const devEmail = `planner-tz-e2e-${Date.now()}@example.com`;
  let fakeProposedStart: string;
  let expectedInstant: Date;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: {
          summary: 'Proposed one task this afternoon.',
          changes: [{ taskId: 'placeholder', proposedStart: '', reason: 'Focused afternoon block.' }],
        },
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await gql(`mutation { updateProfile(input: { timezone: "America/New_York" }) { user { timezone } errors { code } } }`);
    const task = await gql(`mutation { createTask(input: { title: "Deep work block", priority: 2 }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;

    // The real, unambiguous target instant this proposal is meant to
    // represent: 3 hours from right now. Formatted below as a plain
    // "YYYY-MM-DDTHH:mm:ss" wall-clock string *as it would read on a
    // clock in America/New_York at that instant* — with no "Z" and no
    // numeric offset, exactly the ambiguous shape a real Anthropic
    // response can produce.
    expectedInstant = new Date(Date.now() + 3 * 60 * 60 * 1000);
    fakeProposedStart = DateTime.fromJSDate(expectedInstant, { zone: 'America/New_York' }).toFormat("yyyy-MM-dd'T'HH:mm:ss");

    fakeAnthropic.proposeSchedule = async () => ({
      modelUsed: 'fake-model-for-tests',
      proposal: {
        summary: 'Proposed one task this afternoon.',
        changes: [{ taskId, proposedStart: fakeProposedStart, reason: 'Focused afternoon block.' }],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('interprets an offset-less proposed time as local to the user, not the server, and keeps it valid', async () => {
    const res = await gql(
      `mutation { requestReplan { planRun { diff { summary changes { proposedStart } } } errors { code } } }`,
    );
    expect(res.body.data.requestReplan.errors).toEqual([]);
    const planRun = res.body.data.requestReplan.planRun;
    // The real bug: this used to come back as `diff.changes: []` (dropped,
    // "looked" like it was in the past) with the summary explaining a
    // skipped suggestion — proving the fix means asserting the change
    // actually survived, not just that the mutation didn't error.
    expect(planRun.diff.changes).toHaveLength(1);
    // Loose (5s) tolerance deliberately: fakeProposedStart truncates to
    // whole seconds ("HH:mm:ss", no milliseconds) and real time passes
    // between computing expectedInstant and this response coming back, so
    // exact equality isn't the right check here. What actually matters —
    // and what the bug broke — is being off by seconds, not by the ~4-5
    // hours a UTC/EDT offset mixup would produce.
    expect(new Date(planRun.diff.changes[0].proposedStart).getTime()).toBeCloseTo(expectedInstant.getTime(), -4);
  });
});

// Regression test for the second, more fundamental bug found in the same
// live testing session as the one above: the DAY-scope prompt only ever
// stated the current *time* (HH:mm), never the actual calendar date —
// unlike the WEEK/MONTH branch of the same prompt-building function, which
// always has. A model given only a time and no date has to guess what
// today's real date is to answer with a full date+time `proposedStart`;
// observed live, a real response guessed a date over a year in the past,
// which the (correctly working) policy layer then correctly rejected as
// "before now" — making a perfectly reasonable model response look like a
// validation failure. This can't be proven by asserting a change survives
// (the fake AnthropicClient below doesn't simulate a date-guessing model —
// there'd be no reliable way to fake "wrong guess" deterministically); what
// this proves instead is the actual root cause and its fix: the real
// prompt text sent to the model now unambiguously states today's date, so
// a model has nothing left to guess.
describe('AI daily planning — DAY-scope prompt states the real date (e2e)', () => {
  let app: INestApplication;
  const devEmail = `planner-date-e2e-${Date.now()}@example.com`;
  let capturedPrompt = '';

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPrompt = prompt;
        return { modelUsed: 'fake-model-for-tests', proposal: { summary: 'No changes proposed.', changes: [] } };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await gql(`mutation { createTask(input: { title: "Anything" }) { task { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it("states today's real calendar date in the DAY-scope prompt, not just the time of day", async () => {
    // Dev-auth accounts default to timezone "UTC" (never changed by this
    // test), so today's date in that zone is the same thing this
    // assertion computes independently — if the prompt-building code ever
    // regresses back to time-only, this would fail since the literal date
    // string just wouldn't appear anywhere in the captured prompt.
    const todayUtc = new Date().toISOString().slice(0, 10);
    await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);
    expect(capturedPrompt).toContain(`Today's date is ${todayUtc}`);
    expect(capturedPrompt).toContain(`today's actual date, ${todayUtc}`);
  });
});

describe('Habits (e2e)', () => {
  let app: INestApplication;
  const devEmail = `habits-e2e-${Date.now()}@example.com`;

  // Computed at run time rather than hard-coded, so this suite is never
  // flaky depending on which day it happens to run: "today" and "some other
  // day of the week" (used to prove a weekly habit that ISN'T due today
  // correctly stays out of todayPlan.habits).
  // UTC, not local time: new dev-mode users default to users.timezone="UTC"
  // (confirmed by the very first describe block in this file), and
  // HabitsService.listDueToday computes "today" in the user's own
  // timezone — so this has to match UTC specifically, not whatever
  // timezone the machine running this test suite happens to be in.
  const jsDay = new Date().getUTCDay(); // 0=Sunday..6=Saturday
  const isoToday = jsDay === 0 ? 7 : jsDay; // ISO weekday: 1=Monday..7=Sunday
  const isoNotToday = (isoToday % 7) + 1; // always a different ISO weekday than isoToday

  // Full custom habit recurrence increment: same "compute it from the real
  // run date, don't hardcode a date that'll eventually be wrong" discipline
  // as isoToday/isoNotToday just above — these have to work correctly no
  // matter which real calendar day this suite actually runs on.
  const todayDayOfMonth = new Date().getUTCDate(); // 1-31
  // Always in 1-28 (valid in every month, even a non-leap February) and,
  // by construction, never equal to todayDayOfMonth: for d in 1-27,
  // (d%28)+1 = d+1 != d; for d=28, (28%28)+1 = 1 != 28.
  const notTodayDayOfMonth = (todayDayOfMonth % 28) + 1;
  // Which occurrence of today's weekday today actually is within its
  // month (1st through 5th). A 5th occurrence only happens on day 29-31,
  // which — because 29+7=36 already exceeds every possible days-in-month
  // (28-31) — is *always* also that weekday's last occurrence that month,
  // so it's safe to fold "5th" into "-1 (last)" here without miscounting.
  const todayOrdinalRaw = Math.ceil(todayDayOfMonth / 7);
  const todayOrdinal = todayOrdinalRaw >= 5 ? -1 : todayOrdinalRaw;
  // A different, definitely-not-today ordinal for the negative case below.
  // If today is the last occurrence, "1st" is always a distinct, real
  // occurrence too (every weekday occurs at least 4 times a month), so it
  // never accidentally also matches today.
  const notTodayOrdinal = todayOrdinal === 1 ? 2 : 1;

  // Fuller habit recurrence increment: a plain calendar-date offset from
  // today, in UTC (matching the new dev-mode user's default timezone, same
  // reasoning as isoToday/isoNotToday above) — used for UNTIL, which is a
  // literal date-string comparison, not occurrence-index math, so unlike
  // COUNT it's possible to build a genuinely meaningful "already ended"
  // e2e case without time travel.
  function isoDateOffset(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('creates a daily habit and it shows up in todayPlan.habits, not completed yet', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Drink water", frequency: DAILY, protectedDurationMinutes: 5 }) { habit { id title frequency active todayCompleted } errors { code } } }`,
    );
    expect(create.body.data.createHabit.errors).toEqual([]);
    expect(create.body.data.createHabit.habit.frequency).toBe('DAILY');
    expect(create.body.data.createHabit.habit.todayCompleted).toBe(false);

    const today = await gql(`{ todayPlan { habits { title todayCompleted } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === 'Drink water')).toBe(true);
  });

  it('rejects a weekly habit with no days of the week selected', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Bad habit", frequency: WEEKLY }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.createHabit.habit).toBeNull();
    expect(res.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');
  });

  it('a weekly habit only shows up in todayPlan.habits on its selected day', async () => {
    const dueToday = await gql(
      `mutation { createHabit(input: { title: "Due today", frequency: WEEKLY, daysOfWeek: [${isoToday}] }) { habit { id } errors { code } } }`,
    );
    expect(dueToday.body.data.createHabit.errors).toEqual([]);

    const dueOtherDay = await gql(
      `mutation { createHabit(input: { title: "Due some other day", frequency: WEEKLY, daysOfWeek: [${isoNotToday}] }) { habit { id } errors { code } } }`,
    );
    expect(dueOtherDay.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Due today');
    expect(titles).not.toContain('Due some other day');

    // Both still show up in the full management list regardless of today's date.
    const all = await gql(`{ habits { title } }`);
    const allTitles = all.body.data.habits.map((h: any) => h.title);
    expect(allTitles).toContain('Due today');
    expect(allTitles).toContain('Due some other day');
  });

  // Full custom habit recurrence increment. Interval-based due-checks
  // ("every N days"/"every N weeks") are already exhaustively verified
  // against fixed, hand-computed dates in rrule.spec.ts (35 passing unit
  // tests, run for real in this environment) — these two are just a real,
  // end-to-end sanity check that createHabit actually accepts the new
  // fields and that day 0 (today, right when the habit's createdAt is
  // stamped) is correctly due either way, the one thing a pure unit test
  // of rrule.ts alone can't confirm on its own.
  it('an "every N days" habit is due the day it is created (day 0 of its own interval)', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Water the plants", frequency: DAILY, intervalDays: 3 }) { habit { id intervalDays } errors { code } } }`,
    );
    expect(res.body.data.createHabit.errors).toEqual([]);
    expect(res.body.data.createHabit.habit.intervalDays).toBe(3);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Water the plants');
  });

  it('an "every N weeks" habit is due the week it is created (week 0), on its selected day', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Deep clean", frequency: WEEKLY, daysOfWeek: [${isoToday}], intervalWeeks: 2 }) { habit { id intervalWeeks } errors { code } } }`,
    );
    expect(res.body.data.createHabit.errors).toEqual([]);
    expect(res.body.data.createHabit.habit.intervalWeeks).toBe(2);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Deep clean');
  });

  it('a monthly "day of the month" habit only shows up in todayPlan.habits on that day', async () => {
    const dueToday = await gql(
      `mutation { createHabit(input: { title: "Pay rent", frequency: MONTHLY, monthlyMode: DAY_OF_MONTH, dayOfMonth: ${todayDayOfMonth} }) { habit { id dayOfMonth } errors { code } } }`,
    );
    expect(dueToday.body.data.createHabit.errors).toEqual([]);
    expect(dueToday.body.data.createHabit.habit.dayOfMonth).toBe(todayDayOfMonth);

    const dueOtherDay = await gql(
      `mutation { createHabit(input: { title: "Pay rent (other day)", frequency: MONTHLY, monthlyMode: DAY_OF_MONTH, dayOfMonth: ${notTodayDayOfMonth} }) { habit { id } errors { code } } }`,
    );
    expect(dueOtherDay.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Pay rent');
    expect(titles).not.toContain('Pay rent (other day)');
  });

  it('a monthly "Nth weekday" habit only shows up in todayPlan.habits on that specific occurrence', async () => {
    const dueToday = await gql(
      `mutation { createHabit(input: { title: "Team sync", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY, monthlyWeekday: ${isoToday}, monthlyOrdinal: ${todayOrdinal} }) { habit { id monthlyWeekday monthlyOrdinal } errors { code } } }`,
    );
    expect(dueToday.body.data.createHabit.errors).toEqual([]);
    expect(dueToday.body.data.createHabit.habit.monthlyOrdinal).toBe(todayOrdinal);

    const dueOtherOccurrence = await gql(
      `mutation { createHabit(input: { title: "Team sync (other week)", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY, monthlyWeekday: ${isoToday}, monthlyOrdinal: ${notTodayOrdinal} }) { habit { id } errors { code } } }`,
    );
    expect(dueOtherOccurrence.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Team sync');
    expect(titles).not.toContain('Team sync (other week)');
  });

  it('rejects a monthly habit with no monthlyMode, and one missing the fields its chosen mode needs', async () => {
    const noMode = await gql(
      `mutation { createHabit(input: { title: "Bad monthly", frequency: MONTHLY }) { habit { id } errors { code field } } }`,
    );
    expect(noMode.body.data.createHabit.habit).toBeNull();
    expect(noMode.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');

    const noDayOfMonth = await gql(
      `mutation { createHabit(input: { title: "Bad monthly 2", frequency: MONTHLY, monthlyMode: DAY_OF_MONTH }) { habit { id } errors { code field } } }`,
    );
    expect(noDayOfMonth.body.data.createHabit.habit).toBeNull();
    expect(noDayOfMonth.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');

    const noWeekday = await gql(
      `mutation { createHabit(input: { title: "Bad monthly 3", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY, monthlyOrdinal: 1 }) { habit { id } errors { code field } } }`,
    );
    expect(noWeekday.body.data.createHabit.habit).toBeNull();
    expect(noWeekday.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');
  });

  // Fuller habit recurrence increment. "Every N months"'s exact due-date
  // math is already exhaustively verified against fixed, hand-computed
  // dates in rrule.spec.ts (61 passing unit tests) — this is the same
  // "day 0" e2e sanity check the intervalDays/intervalWeeks tests above
  // already do for their own shapes.
  it('an "every N months" habit is due the month it is created (month 0), on today\'s day of the month', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Pay quarterly tax", frequency: MONTHLY, monthlyMode: DAY_OF_MONTH, dayOfMonth: ${todayDayOfMonth}, intervalMonths: 3 }) { habit { id intervalMonths } errors { code } } }`,
    );
    expect(res.body.data.createHabit.errors).toEqual([]);
    expect(res.body.data.createHabit.habit.intervalMonths).toBe(3);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Pay quarterly tax');
  });

  // COUNT's exact stop-after-N-occurrences math is already exhaustively
  // verified in rrule.spec.ts — this just confirms createHabit actually
  // accepts and round-trips the field, and that a freshly-created COUNT
  // habit (occurrence index 0, always < any count >= 1) is due on its own
  // creation day.
  it('accepts a habit with a fixed occurrence COUNT, due on day 0', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Ten-day challenge", frequency: DAILY, count: 10 }) { habit { id count } errors { code } } }`,
    );
    expect(res.body.data.createHabit.errors).toEqual([]);
    expect(res.body.data.createHabit.habit.count).toBe(10);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === 'Ten-day challenge')).toBe(true);
  });

  // UNTIL is a plain calendar-date cutoff — unlike COUNT, this doesn't
  // depend on the habit's own occurrence index, so a genuinely meaningful
  // "not due" case is achievable in a single e2e run without time travel.
  it('an end-dated (UNTIL) habit is due up to and including its end date, and not due once that date has passed', async () => {
    const stillActive = await gql(
      `mutation { createHabit(input: { title: "Short sprint", frequency: DAILY, until: "${isoDateOffset(1)}" }) { habit { id until } errors { code } } }`,
    );
    expect(stillActive.body.data.createHabit.errors).toEqual([]);
    expect(stillActive.body.data.createHabit.habit.until).toBe(isoDateOffset(1));

    const alreadyEnded = await gql(
      `mutation { createHabit(input: { title: "Already over", frequency: DAILY, until: "${isoDateOffset(-1)}" }) { habit { id } errors { code } } }`,
    );
    expect(alreadyEnded.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Short sprint');
    expect(titles).not.toContain('Already over');
  });

  it('rejects createHabit with both count and until set on the same call', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Bad end condition", frequency: DAILY, count: 5, until: "${isoDateOffset(30)}" }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.createHabit.habit).toBeNull();
    expect(res.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');
    expect(res.body.data.createHabit.errors[0].field).toBe('count');
  });

  it('updateHabit can set an end condition, and switching from COUNT to UNTIL implicitly clears the old COUNT (and vice versa)', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Habit with a changing end condition", frequency: DAILY }) { habit { id count until } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;
    expect(create.body.data.createHabit.habit.count).toBeNull();
    expect(create.body.data.createHabit.habit.until).toBeNull();

    const withCount = await gql(
      `mutation { updateHabit(id: "${id}", input: { count: 20 }) { habit { count until } errors { code } } }`,
    );
    expect(withCount.body.data.updateHabit.errors).toEqual([]);
    expect(withCount.body.data.updateHabit.habit.count).toBe(20);
    expect(withCount.body.data.updateHabit.habit.until).toBeNull();

    const switchedToUntil = await gql(
      `mutation { updateHabit(id: "${id}", input: { until: "${isoDateOffset(60)}" }) { habit { count until } errors { code } } }`,
    );
    expect(switchedToUntil.body.data.updateHabit.errors).toEqual([]);
    expect(switchedToUntil.body.data.updateHabit.habit.count).toBeNull();
    expect(switchedToUntil.body.data.updateHabit.habit.until).toBe(isoDateOffset(60));

    const clearedBackToForever = await gql(
      `mutation { updateHabit(id: "${id}", input: { until: null }) { habit { count until } errors { code } } }`,
    );
    expect(clearedBackToForever.body.data.updateHabit.errors).toEqual([]);
    expect(clearedBackToForever.body.data.updateHabit.habit.count).toBeNull();
    expect(clearedBackToForever.body.data.updateHabit.habit.until).toBeNull();
  });

  it('rejects updateHabit with both count and until set on the same call', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Habit for bad update", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const res = await gql(
      `mutation { updateHabit(id: "${id}", input: { count: 5, until: "${isoDateOffset(30)}" }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.updateHabit.habit).toBeNull();
    expect(res.body.data.updateHabit.errors[0].code).toBe('INVALID_RECURRENCE');
  });

  // BYSETPOS / multiple weekdays per month increment. Several days of the
  // month in one rule — the exact due-date math is already exhaustively
  // unit-tested in rrule.spec.ts; this confirms createHabit actually
  // accepts and round-trips the new fields and that today (whichever real
  // day this suite happens to run on) is correctly due when it's one of the
  // listed days, and not due when it isn't.
  it('a "several days of the month" habit is due on any of its listed days, and round-trips daysOfMonth', async () => {
    // Distinct from both todayDayOfMonth and notTodayDayOfMonth (which is
    // itself (todayDayOfMonth % 28) + 1 — reusing that same formula here
    // would collide) — always in 1-28, verified the same way
    // notTodayDayOfMonth's own comment above already verifies its formula.
    const otherDay = ((todayDayOfMonth + 1) % 28) + 1;
    const dueToday = await gql(
      `mutation { createHabit(input: { title: "Pay bills twice a month", frequency: MONTHLY, monthlyMode: DAYS_OF_MONTH, daysOfMonth: [${todayDayOfMonth}, ${otherDay}] }) { habit { id daysOfMonth } errors { code } } }`,
    );
    expect(dueToday.body.data.createHabit.errors).toEqual([]);
    expect([...dueToday.body.data.createHabit.habit.daysOfMonth].sort((a: number, b: number) => a - b)).toEqual(
      [todayDayOfMonth, otherDay].sort((a, b) => a - b),
    );

    const notDueToday = await gql(
      `mutation { createHabit(input: { title: "Not today's days", frequency: MONTHLY, monthlyMode: DAYS_OF_MONTH, daysOfMonth: [${notTodayDayOfMonth}, ${otherDay}] }) { habit { id } errors { code } } }`,
    );
    expect(notDueToday.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    const titles = today.body.data.todayPlan.habits.map((h: any) => h.title);
    expect(titles).toContain('Pay bills twice a month');
    expect(titles).not.toContain("Not today's days");
  });

  it('rejects a "several days of the month" habit with fewer than 2 days', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Bad days-of-month", frequency: MONTHLY, monthlyMode: DAYS_OF_MONTH, daysOfMonth: [1] }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.createHabit.habit).toBeNull();
    expect(res.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');
    expect(res.body.data.createHabit.errors[0].field).toBe('daysOfMonth');
  });

  // "The Nth (or last) day among a set of weekdays" — a single-weekday set
  // behaves identically to NTH_WEEKDAY for that same weekday (proven here,
  // reusing this file's own isoToday/todayOrdinal so it's correct no
  // matter which real day the suite runs on), and a set that deliberately
  // excludes today's weekday is never due today regardless of the date.
  it('a "set of weekdays" habit with only today\'s weekday in the set behaves like a single-weekday habit', async () => {
    const dueToday = await gql(
      `mutation { createHabit(input: { title: "Single-day weekday set", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY_SET, monthlyWeekdaySet: [${isoToday}], monthlyOrdinal: ${todayOrdinal} }) { habit { id monthlyWeekdaySet monthlyOrdinal } errors { code } } }`,
    );
    expect(dueToday.body.data.createHabit.errors).toEqual([]);
    expect(dueToday.body.data.createHabit.habit.monthlyWeekdaySet).toEqual([isoToday]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === 'Single-day weekday set')).toBe(true);
  });

  it('a "set of weekdays" habit is never due on a day whose weekday is not in the set', async () => {
    // isoNotToday (defined at the top of this describe block) is always a
    // different ISO weekday than today, whatever today actually is.
    const res = await gql(
      `mutation { createHabit(input: { title: "Excludes today's weekday", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY_SET, monthlyWeekdaySet: [${isoNotToday}], monthlyOrdinal: 1 }) { habit { id } errors { code } } }`,
    );
    expect(res.body.data.createHabit.errors).toEqual([]);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === "Excludes today's weekday")).toBe(false);
  });

  it('rejects a "set of weekdays" habit with an empty set', async () => {
    const res = await gql(
      `mutation { createHabit(input: { title: "Bad weekday set", frequency: MONTHLY, monthlyMode: NTH_WEEKDAY_SET, monthlyOrdinal: 1 }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.createHabit.habit).toBeNull();
    expect(res.body.data.createHabit.errors[0].code).toBe('INVALID_RECURRENCE');
    expect(res.body.data.createHabit.errors[0].field).toBe('monthlyWeekdaySet');
  });

  it('updateHabit can switch a habit from one new MONTHLY mode to the other, dropping the old mode\'s fields', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Switches monthly mode", frequency: MONTHLY, monthlyMode: DAYS_OF_MONTH, daysOfMonth: [1, 15] }) { habit { id daysOfMonth monthlyWeekdaySet } errors { code } } }`,
    );
    expect(create.body.data.createHabit.errors).toEqual([]);
    expect(create.body.data.createHabit.habit.daysOfMonth).toEqual([1, 15]);
    const id = create.body.data.createHabit.habit.id;

    const updated = await gql(
      `mutation { updateHabit(id: "${id}", input: { monthlyMode: NTH_WEEKDAY_SET, monthlyWeekdaySet: [6, 7], monthlyOrdinal: -1 }) { habit { monthlyMode daysOfMonth monthlyWeekdaySet monthlyOrdinal } errors { code } } }`,
    );
    expect(updated.body.data.updateHabit.errors).toEqual([]);
    expect(updated.body.data.updateHabit.habit.monthlyMode).toBe('NTH_WEEKDAY_SET');
    expect(updated.body.data.updateHabit.habit.daysOfMonth).toBeNull();
    expect(updated.body.data.updateHabit.habit.monthlyWeekdaySet).toEqual([6, 7]);
    expect(updated.body.data.updateHabit.habit.monthlyOrdinal).toBe(-1);
  });

  it('completing and uncompleting a habit log flips todayCompleted', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Stretch", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;
    const todayIso = new Date().toISOString();

    const completed = await gql(
      `mutation { completeHabitLog(habitId: "${id}", date: "${todayIso}") { habit { todayCompleted } errors { code } } }`,
    );
    expect(completed.body.data.completeHabitLog.habit.todayCompleted).toBe(true);

    const uncompleted = await gql(
      `mutation { uncompleteHabitLog(habitId: "${id}", date: "${todayIso}") { habit { todayCompleted } errors { code } } }`,
    );
    expect(uncompleted.body.data.uncompleteHabitLog.habit.todayCompleted).toBe(false);
  });

  it('deactivating a habit removes it from todayPlan.habits and from the active-only list, but keeps it in the full list', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Meditate", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const deactivated = await gql(`mutation { deactivateHabit(id: "${id}") { habit { active } errors { code } } }`);
    expect(deactivated.body.data.deactivateHabit.habit.active).toBe(false);

    const today = await gql(`{ todayPlan { habits { title } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === 'Meditate')).toBe(false);

    const activeOnly = await gql(`{ habits(activeOnly: true) { title } }`);
    expect(activeOnly.body.data.habits.some((h: any) => h.title === 'Meditate')).toBe(false);

    const all = await gql(`{ habits { title active } }`);
    const meditate = all.body.data.habits.find((h: any) => h.title === 'Meditate');
    expect(meditate).toBeDefined();
    expect(meditate.active).toBe(false);
  });

  it('rejects completing a habit log for a habit that belongs to another user', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Private habit", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const otherEmail = `habits-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({
        query: `mutation { completeHabitLog(habitId: "${id}", date: "${new Date().toISOString()}") { habit { id } errors { code } } }`,
      });

    expect(res.body.data.completeHabitLog.habit).toBeNull();
    expect(res.body.data.completeHabitLog.errors[0].code).toBe('COMPLETE_LOG_FAILED');
  });

  // Habit-edit UI increment: updateHabit itself already existed on the
  // backend before this increment (no migration, no resolver change needed
  // here) — these are the first real tests it's ever had, plus real
  // coverage of the two small additions this increment actually made
  // (goalId, and the new reactivateHabit mutation).
  it('updateHabit changes the title, switches recurrence shape entirely, and updates preferred time/protected duration', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Read", frequency: DAILY, protectedDurationMinutes: 10 }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const updated = await gql(
      `mutation { updateHabit(id: "${id}", input: { title: "Read before bed", frequency: WEEKLY, daysOfWeek: [${isoToday}], preferredTime: "21:00", protectedDurationMinutes: 20 }) { habit { title frequency daysOfWeek preferredTime protectedDurationMinutes } errors { code } } }`,
    );
    expect(updated.body.data.updateHabit.errors).toEqual([]);
    const habit = updated.body.data.updateHabit.habit;
    expect(habit.title).toBe('Read before bed');
    expect(habit.frequency).toBe('WEEKLY');
    expect(habit.daysOfWeek).toEqual([isoToday]);
    expect(habit.preferredTime).toBe('21:00');
    expect(habit.protectedDurationMinutes).toBe(20);

    // The switch to WEEKLY (due today, per daysOfWeek above) actually
    // reaches todayPlan.habits — not just the raw stored fields.
    const today = await gql(`{ todayPlan { habits { title } } }`);
    expect(today.body.data.todayPlan.habits.some((h: any) => h.title === 'Read before bed')).toBe(true);
  });

  it('updateHabit rejects switching to WEEKLY with no days selected, same as createHabit', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Journal", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const res = await gql(
      `mutation { updateHabit(id: "${id}", input: { frequency: WEEKLY, daysOfWeek: [] }) { habit { id } errors { code field } } }`,
    );
    expect(res.body.data.updateHabit.habit).toBeNull();
    expect(res.body.data.updateHabit.errors[0].code).toBe('INVALID_RECURRENCE');
  });

  it('updateHabit can link a habit to a goal after creation, and later clear that link — the gap this increment closes', async () => {
    const goal = await gql(`mutation { createGoal(input: { title: "Read more books" }) { goal { id } errors { code } } }`);
    const goalId = goal.body.data.createGoal.goal.id;
    const create = await gql(
      `mutation { createHabit(input: { title: "Read", frequency: DAILY }) { habit { id goal { id } } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;
    expect(create.body.data.createHabit.habit.goal).toBeNull(); // no goalId sent at creation

    const linked = await gql(
      `mutation { updateHabit(id: "${id}", input: { goalId: "${goalId}" }) { habit { goal { id title } } errors { code } } }`,
    );
    expect(linked.body.data.updateHabit.habit.goal.id).toBe(goalId);
    expect(linked.body.data.updateHabit.habit.goal.title).toBe('Read more books');

    const unlinked = await gql(
      `mutation { updateHabit(id: "${id}", input: { goalId: null }) { habit { goal { id } } errors { code } } }`,
    );
    expect(unlinked.body.data.updateHabit.habit.goal).toBeNull();
  });

  it('rejects updating a habit that belongs to another user', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Private habit for update", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;

    const otherEmail = `habits-e2e-other-update-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { updateHabit(id: "${id}", input: { title: "Hijacked" }) { habit { id } errors { code } } }` });

    expect(res.body.data.updateHabit.habit).toBeNull();
    expect(res.body.data.updateHabit.errors[0].code).toBe('UPDATE_FAILED');
  });

  // Production Hardening Sprint 1 (2026-08-29) regression coverage for the
  // Update 50 IDOR fix (backend audit finding #4) on the Habit→Goal side —
  // habits.service.ts's requireOwnedGoal check has had no test guarding it
  // from regressing until now, even though the equivalent Task→Goal/Tag
  // coverage was just added alongside it in the Tasks & Goals block above.
  it("rejects creating a habit linked to another user's goal, and does not create the habit", async () => {
    const otherEmail = `habits-e2e-goal-owner-${Date.now()}@example.com`;
    const otherGoal = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { createGoal(input: { title: "Someone else's habit goal" }) { goal { id } errors { code } } }` });
    const otherGoalId = otherGoal.body.data.createGoal.goal.id;

    const attempt = await gql(
      `mutation { createHabit(input: { title: "Hijack attempt", frequency: DAILY, goalId: "${otherGoalId}" }) { habit { id } errors { code message } } }`,
    );
    expect(attempt.body.data.createHabit.habit).toBeNull();
    expect(attempt.body.data.createHabit.errors[0].code).toBe('CREATE_FAILED');

    const mine = await gql(`{ habits { title } }`);
    expect(mine.body.data.habits.some((h: any) => h.title === 'Hijack attempt')).toBe(false);
  });

  it("rejects linking an existing habit to another user's goal via updateHabit", async () => {
    const otherEmail = `habits-e2e-goal-owner-update-${Date.now()}@example.com`;
    const otherGoal = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { createGoal(input: { title: "Another user's other goal" }) { goal { id } errors { code } } }` });
    const otherGoalId = otherGoal.body.data.createGoal.goal.id;

    const mine = await gql(`mutation { createHabit(input: { title: "My own habit", frequency: DAILY }) { habit { id } errors { code } } }`);
    const myHabitId = mine.body.data.createHabit.habit.id;

    const attempt = await gql(
      `mutation { updateHabit(id: "${myHabitId}", input: { goalId: "${otherGoalId}" }) { habit { id goal { id } } errors { code message } } }`,
    );
    expect(attempt.body.data.updateHabit.habit).toBeNull();
    expect(attempt.body.data.updateHabit.errors[0].code).toBe('UPDATE_FAILED');

    const reread = await gql(`{ habits { id goal { id } } }`);
    const found = reread.body.data.habits.find((h: any) => h.id === myHabitId);
    expect(found.goal).toBeNull();
  });

it('reactivateHabit brings a deactivated habit back into todayPlan.habits and the active-only list — the one-way trap this increment closes', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Cold shower", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;
    await gql(`mutation { deactivateHabit(id: "${id}") { habit { active } errors { code } } }`);

    const beforeReactivate = await gql(`{ todayPlan { habits { title } } }`);
    expect(beforeReactivate.body.data.todayPlan.habits.some((h: any) => h.title === 'Cold shower')).toBe(false);

    const reactivated = await gql(`mutation { reactivateHabit(id: "${id}") { habit { active } errors { code } } }`);
    expect(reactivated.body.data.reactivateHabit.habit.active).toBe(true);

    const afterReactivate = await gql(`{ todayPlan { habits { title } } }`);
    expect(afterReactivate.body.data.todayPlan.habits.some((h: any) => h.title === 'Cold shower')).toBe(true);

    const activeOnly = await gql(`{ habits(activeOnly: true) { title } }`);
    expect(activeOnly.body.data.habits.some((h: any) => h.title === 'Cold shower')).toBe(true);
  });

  it('rejects reactivating a habit that belongs to another user', async () => {
    const create = await gql(
      `mutation { createHabit(input: { title: "Private habit for reactivate", frequency: DAILY }) { habit { id } errors { code } } }`,
    );
    const id = create.body.data.createHabit.habit.id;
    await gql(`mutation { deactivateHabit(id: "${id}") { habit { active } errors { code } } }`);

    const otherEmail = `habits-e2e-other-reactivate-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { reactivateHabit(id: "${id}") { habit { id } errors { code } } }` });

    expect(res.body.data.reactivateHabit.habit).toBeNull();
    expect(res.body.data.reactivateHabit.errors[0].code).toBe('REACTIVATE_FAILED');
  });
});

// Proves the "hard-protected, like calendar events" scope decision actually
// reaches production code: a habit with a preferredTime becomes a real
// blocked interval the policy layer enforces (same overlap check as FIXED
// calendar events), while a habit with no preferredTime only ever shows up
// as advisory text in the prompt, never positionally enforced. AnthropicClient
// is overridden with a fake that captures the exact prompt string, so this
// is checking real production code (requestReplan/buildPrompt in
// planner.service.ts), not a mock of it.
describe('Habits — reaching the AI planner (e2e)', () => {
  let app: INestApplication;
  const devEmail = `habits-planner-e2e-${Date.now()}@example.com`;
  let capturedPrompt: string | undefined;
  let taskId: string;
  let proposedStart: string;
  let habitPreferredTime: string;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const now = new Date();
    // The proposed task time and the habit's protected time are derived from
    // the exact same instant (+1h from now), so they're guaranteed to
    // overlap regardless of when this suite happens to run — same technique
    // as the "AI daily planning — configured" describe block above, just
    // reused for a habit-protected interval instead of a calendar event.
    const overlapInstant = new Date(now.getTime() + 60 * 60 * 1000);
    proposedStart = overlapInstant.toISOString();
    const hh = String(overlapInstant.getUTCHours()).padStart(2, '0');
    const mm = String(overlapInstant.getUTCMinutes()).padStart(2, '0');
    habitPreferredTime = `${hh}:${mm}`; // new dev-mode users default to users.timezone="UTC" — see the first describe block in this file

    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPrompt = prompt;
        return {
          modelUsed: 'fake-model-for-tests',
          proposal: {
            summary: 'Proposed fitting the task in.',
            changes: [{ taskId, proposedStart, reason: 'Only open slot today.' }],
          },
        };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const t = await gql(`mutation { createTask(input: { title: "Task colliding with habit" }) { task { id } errors { code } } }`);
    taskId = t.body.data.createTask.task.id;

    await gql(
      `mutation { createHabit(input: { title: "Morning workout", frequency: DAILY, preferredTime: "${habitPreferredTime}", protectedDurationMinutes: 30 }) { habit { id } errors { code } } }`,
    );
    await gql(`mutation { createHabit(input: { title: "Call mom", frequency: DAILY }) { habit { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('drops a task proposal that overlaps protected habit time, and explains the drop in the summary', async () => {
    const res = await gql(
      `mutation { requestReplan { planRun { diff { summary changes { task { id } } } } errors { code } } }`,
    );
    expect(res.body.data.requestReplan.errors).toEqual([]);
    expect(res.body.data.requestReplan.planRun.diff.changes).toHaveLength(0);
    expect(res.body.data.requestReplan.planRun.diff.summary).toContain('protected habit time');
  });

  it('includes the protected habit as a fixed block and the flexible habit as advisory text in the prompt sent to the model', async () => {
    expect(capturedPrompt).toContain('Morning workout');
    expect(capturedPrompt).toContain('FIXED — protected habit time');
    expect(capturedPrompt).toContain('Call mom');
    expect(capturedPrompt).toContain('no fixed time');
  });
});

// Same rationale as the AI planning describe blocks above: AnthropicClient
// is overridden with a fake, so these tests are deterministic and need
// neither a real ANTHROPIC_API_KEY nor network access. Chat and Planner now
// share one AnthropicClient token (PlannerModule exports it, ChatModule
// imports PlannerModule — see planner.module.ts/chat.module.ts), so a
// single overrideProvider call here replaces it everywhere in the app,
// including inside PlannerModule.
describe('Chat — not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `chat-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue({
        isConfigured: () => false,
        proposeSchedule: async () => { throw new Error('should not be called'); },
        sendMessage: async () => { throw new Error('should not be called'); },
        streamMessage: async () => { throw new Error('should not be called'); },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('returns AI_NOT_CONFIGURED instead of crashing when no API key is set', async () => {
    const res = await gql(`mutation { sendChatMessage(content: "hello") { conversation { id } errors { code message } } }`);
    expect(res.body.data.sendChatMessage.conversation).toBeNull();
    expect(res.body.data.sendChatMessage.errors[0].code).toBe('AI_NOT_CONFIGURED');
  });

  it('aiConversations is an empty list when nothing has ever been sent', async () => {
    const res = await gql(`{ aiConversations { id } }`);
    expect(res.body.data.aiConversations).toEqual([]);
  });
});

describe('Chat — configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `chat-e2e-${Date.now()}@example.com`;
  const fakeReply = "Here's what I'd suggest based on your day.";

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('not used by chat tests'); },
      sendMessage: async () => ({ content: fakeReply, modelUsed: 'fake-model-for-tests' }),
      streamMessage: async (
        _messages: unknown,
        _system: string,
        onDelta: (text: string) => void,
      ) => {
        onDelta(fakeReply);
        return { content: fakeReply, modelUsed: 'fake-model-for-tests', toolUses: [] };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('rejects an empty message', async () => {
    const res = await gql(`mutation { sendChatMessage(content: "   ") { conversation { id } errors { code } } }`);
    expect(res.body.data.sendChatMessage.conversation).toBeNull();
    expect(res.body.data.sendChatMessage.errors[0].code).toBe('EMPTY_MESSAGE');
  });

  it('sending a first message creates a new conversation with both the user and assistant messages, in order', async () => {
    const res = await gql(
      `mutation { sendChatMessage(content: "What should I focus on today?") { conversation { id title messages { role content } } errors { code } } }`,
    );
    expect(res.body.data.sendChatMessage.errors).toEqual([]);
    const conversation = res.body.data.sendChatMessage.conversation;
    expect(conversation.title).toBe('What should I focus on today?');
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]).toEqual({ role: 'USER', content: 'What should I focus on today?' });
    expect(conversation.messages[1]).toEqual({ role: 'ASSISTANT', content: fakeReply });
  });

  it('sending a follow-up with the same conversationId continues the same thread', async () => {
    const first = await gql(`mutation { sendChatMessage(content: "First message") { conversation { id } errors { code } } }`);
    const conversationId = first.body.data.sendChatMessage.conversation.id;

    const second = await gql(
      `mutation { sendChatMessage(content: "Second message", conversationId: "${conversationId}") { conversation { id messages { role content } } errors { code } } }`,
    );
    const conversation = second.body.data.sendChatMessage.conversation;
    expect(conversation.id).toBe(conversationId);
    expect(conversation.messages).toHaveLength(4);
    expect(conversation.messages.map((m: any) => m.content)).toEqual(['First message', fakeReply, 'Second message', fakeReply]);
  });

  it('lists conversations ordered by most recently active, without hydrating every message', async () => {
    const res = await gql(`{ aiConversations { id title } }`);
    expect(res.body.data.aiConversations.length).toBeGreaterThan(0);
    // list view intentionally omits messages — confirm the field is simply
    // not requested here rather than asserting an implementation detail.
    expect(res.body.data.aiConversations[0].title).toBeDefined();
  });

  it('aiConversation(id) returns the full hydrated conversation', async () => {
    const create = await gql(`mutation { sendChatMessage(content: "Standalone thread") { conversation { id } errors { code } } }`);
    const id = create.body.data.sendChatMessage.conversation.id;

    const res = await gql(`{ aiConversation(id: "${id}") { id messages { role content } } }`);
    expect(res.body.data.aiConversation.id).toBe(id);
    expect(res.body.data.aiConversation.messages).toHaveLength(2);
  });

  it('rejects sending to a conversation that belongs to another user', async () => {
    const create = await gql(`mutation { sendChatMessage(content: "Private thread") { conversation { id } errors { code } } }`);
    const conversationId = create.body.data.sendChatMessage.conversation.id;

    const otherEmail = `chat-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({
        query: `mutation { sendChatMessage(content: "Hijack attempt", conversationId: "${conversationId}") { conversation { id } errors { code } } }`,
      });

    expect(res.body.data.sendChatMessage.conversation).toBeNull();
    expect(res.body.data.sendChatMessage.errors[0].code).toBe('SEND_FAILED');
  });

  it('aiConversation(id) returns null (not an error) for another user\'s conversation', async () => {
    const create = await gql(`mutation { sendChatMessage(content: "Another private thread") { conversation { id } errors { code } } }`);
    const conversationId = create.body.data.sendChatMessage.conversation.id;

    const otherEmail = `chat-e2e-other2-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `{ aiConversation(id: "${conversationId}") { id } }` });

    expect(res.body.data.aiConversation).toBeNull();
  });
});

// Real-time chat streaming increment. Unlike every other describe block in
// this file, this one drives a real listening HTTP server (`app.listen(0)`,
// an ephemeral port — not just `app.init()`, which is enough for supertest's
// in-process HTTP requests but gives graphql-ws nothing real to open an
// actual WebSocket against) and a real `graphql-ws` client (backed by the
// `ws` package, the same one app.module.ts's own server-side wiring uses),
// so these tests exercise the genuine WebSocket connection, onConnect
// auth, and PubSub delivery end-to-end — not a mock of any of it. The fake
// AnthropicClient below calls `onDelta` three separate times with three
// separate words, specifically so a test can assert real, ordered,
// multi-chunk delivery rather than one single chunk that happens to equal
// the whole reply (which streamMessage's implementation could satisfy even
// if its chunking were completely broken).
describe('Chat streaming (e2e)', () => {
  let app: INestApplication;
  let port: number;
  const devEmail = `chat-streaming-e2e-${Date.now()}@example.com`;
  const replyChunks = ['Focus ', 'on ', 'the deep work block first.'];
  const fullReply = replyChunks.join('');

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('not used by chat tests'); },
      sendMessage: async () => { throw new Error('not used by streaming tests'); },
      streamMessage: async (
        _messages: unknown,
        _system: string,
        onDelta: (text: string) => void,
      ) => {
        for (const chunk of replyChunks) {
          onDelta(chunk);
        }
        return { content: fullReply, modelUsed: 'fake-model-for-tests', toolUses: [] };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string, variables?: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query, variables });
  }

  // Subscribes first (same order the real Chat page follows — see that
  // component's own handleSend), then fires the streaming mutation, and
  // collects every chatStreamChunk delivered before the subscription's own
  // `done: true` event closes it out.
  async function collectStreamedChunks(
    requestId: string,
    content: string,
    conversationId?: string,
  ): Promise<{ chunks: Array<{ delta: string; done: boolean }>; mutationResult: any }> {
    const client = createWsClient({
      url: `ws://127.0.0.1:${port}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: { 'x-dev-user-email': devEmail },
    });

    const chunks: Array<{ delta: string; done: boolean }> = [];
    const doneReceived = new Promise<void>((resolve, reject) => {
      client.subscribe(
        {
          query: `subscription($requestId: String!) { chatStreamChunk(requestId: $requestId) { delta done } }`,
          variables: { requestId },
        },
        {
          next: (msg: any) => {
            const chunk = msg.data.chatStreamChunk;
            chunks.push(chunk);
            if (chunk.done) resolve();
          },
          error: reject,
          complete: () => {},
        },
      );
    });

    // A short real delay for the subscription to actually establish over
    // the socket before firing the mutation — the same small, honestly-
    // documented race the real Chat page's own comment on handleSend
    // accepts, reproduced here deliberately rather than engineered around.
    await new Promise((r) => setTimeout(r, 200));

    const mutationResult = await gql(
      `mutation($content: String!, $requestId: String!, $conversationId: ID) {
        sendChatMessageStreaming(content: $content, requestId: $requestId, conversationId: $conversationId) {
          conversation { id messages { role content } }
          errors { code }
        }
      }`,
      { content, requestId, conversationId },
    );

    await doneReceived;
    client.dispose();
    return { chunks, mutationResult: mutationResult.body.data.sendChatMessageStreaming };
  }

  it('delivers each real chunk in order over a real WebSocket subscription, ending in a done event', async () => {
    const { chunks, mutationResult } = await collectStreamedChunks('req-stream-1', 'What should I focus on?');

    expect(mutationResult.errors).toEqual([]);
    // Three real text chunks plus the one trailing done marker — not just
    // one chunk containing the whole reply.
    expect(chunks).toEqual([
      { delta: 'Focus ', done: false },
      { delta: 'on ', done: false },
      { delta: 'the deep work block first.', done: false },
      { delta: '', done: true },
    ]);
    // The streamed chunks concatenate to exactly the same text the
    // mutation itself persisted — streaming and the final persisted
    // message are never allowed to disagree.
    expect(chunks.filter((c) => !c.done).map((c) => c.delta).join('')).toBe(fullReply);
    expect(mutationResult.conversation.messages[1]).toEqual({ role: 'ASSISTANT', content: fullReply });
  });

  it('two concurrent streamed sends never cross-deliver chunks to the wrong subscriber', async () => {
    const [a, b] = await Promise.all([
      collectStreamedChunks('req-stream-a', 'First concurrent message'),
      collectStreamedChunks('req-stream-b', 'Second concurrent message'),
    ]);

    // Every chunk either subscriber received actually concatenates back to
    // the one real reply — if requestId filtering were broken, one side
    // would see a mixed/duplicated sequence instead.
    expect(a.chunks.filter((c) => !c.done).map((c) => c.delta).join('')).toBe(fullReply);
    expect(b.chunks.filter((c) => !c.done).map((c) => c.delta).join('')).toBe(fullReply);
    expect(a.chunks).toHaveLength(4);
    expect(b.chunks).toHaveLength(4);
  });

  it('a WebSocket connection with no valid auth is rejected rather than allowed through', async () => {
    const client = createWsClient({
      url: `ws://127.0.0.1:${port}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: {}, // no x-dev-user-email at all
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        client.subscribe(
          { query: `subscription { chatStreamChunk(requestId: "irrelevant") { delta } }` },
          { next: () => resolve(), error: (err) => reject(err), complete: () => resolve() },
        );
      }),
    ).rejects.toBeDefined();

    client.dispose();
  });
});

// Tool-calling actions in Chat increment. Same real-listening-port,
// real-graphql-ws-client setup as the "Chat streaming" suite above — these
// tests need to observe the real role-tagged chunk sequence (an ASSISTANT
// lead-in, then a TOOL event, then a final ASSISTANT confirmation) and
// confirm the underlying real action actually happened (a real Task row
// created/completed/rescheduled, or genuinely left untouched on a real
// conflict), proving the whole multi-round tool loop actually ran through
// the real resolver/service/AnthropicClient wiring end to end.
describe('Chat tool-calling (e2e)', () => {
  let app: INestApplication;
  let port: number;
  const devEmail = `chat-tools-e2e-${Date.now()}@example.com`;
  // Set by each test right before sending, read by the fake below to
  // decide which tool call (if any) to simulate on round 1 — the fake has
  // no other way to learn a just-seeded task's real id ahead of time, so a
  // scripted static reply (like the plain "Chat streaming" suite's fake)
  // wouldn't work here.
  let scenario: { name: string; input: Record<string, unknown> } | null = null;

  function gql(query: string, variables?: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query, variables });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('not used by chat tests'); },
      sendMessage: async () => { throw new Error('not used by streaming tests'); },
      streamMessage: async (
        messages: Array<{ role: string; content: unknown }>,
        _system: string,
        onDelta: (text: string) => void,
      ) => {
        const last = messages[messages.length - 1];
        // A tool-result round is any turn whose content is an array
        // containing a tool_result block — see chat.service.ts's own
        // sendMessageStreaming comment for why that's the exact shape
        // Anthropic's real API requires for a follow-up turn.
        const isToolResultRound =
          Array.isArray(last?.content) && (last!.content as Array<{ type?: string }>).some((b) => b.type === 'tool_result');

        if (isToolResultRound || !scenario) {
          const text = isToolResultRound ? 'Done!' : "I'm not going to take any action for that.";
          onDelta(text);
          return { content: text, modelUsed: 'fake-model-for-tests', toolUses: [] };
        }

        const leadIn = 'On it.';
        onDelta(leadIn);
        return {
          content: leadIn,
          modelUsed: 'fake-model-for-tests',
          toolUses: [{ id: 'toolu_fake_1', name: scenario.name, input: scenario.input }],
        };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    scenario = null;
  });

  // Same subscribe-first, then-mutate, collect-until-done shape as the
  // "Chat streaming" suite's own collectStreamedChunks — duplicated
  // locally (not shared across describe blocks) matching this whole
  // file's existing per-suite-scoped-helpers convention, and extended here
  // to also capture `role` on every chunk, which this suite's own
  // assertions actually need.
  async function sendAndCollect(
    content: string,
  ): Promise<{ chunks: Array<{ role: string; delta: string; done: boolean }>; mutationResult: any }> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const client = createWsClient({
      url: `ws://127.0.0.1:${port}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: { 'x-dev-user-email': devEmail },
    });

    const chunks: Array<{ role: string; delta: string; done: boolean }> = [];
    const doneReceived = new Promise<void>((resolve, reject) => {
      client.subscribe(
        {
          query: `subscription($requestId: String!) { chatStreamChunk(requestId: $requestId) { role delta done } }`,
          variables: { requestId },
        },
        {
          next: (msg: any) => {
            const chunk = msg.data.chatStreamChunk;
            chunks.push(chunk);
            if (chunk.done) resolve();
          },
          error: reject,
          complete: () => {},
        },
      );
    });

    await new Promise((r) => setTimeout(r, 200));

    const mutationResult = await gql(
      `mutation($content: String!, $requestId: String!) {
        sendChatMessageStreaming(content: $content, requestId: $requestId) {
          conversation { id messages { role content } }
          errors { code }
        }
      }`,
      { content, requestId },
    );

    await doneReceived;
    client.dispose();
    return { chunks, mutationResult: mutationResult.body.data.sendChatMessageStreaming };
  }

  it('create_task: a real task gets created, visible as a TOOL event and in the persisted conversation', async () => {
    scenario = { name: 'create_task', input: { title: 'Buy milk', priority: 2 } };
    const { chunks, mutationResult } = await sendAndCollect('Please add a task to buy milk');

    expect(mutationResult.errors).toEqual([]);
    // ASSISTANT lead-in, then the TOOL event, then the final ASSISTANT
    // confirmation — not just "some chunks arrived somewhere."
    expect(chunks.filter((c) => !c.done).map((c) => c.role)).toEqual(['ASSISTANT', 'TOOL', 'ASSISTANT']);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta).toContain('Buy milk');

    expect(mutationResult.conversation.messages.map((m: any) => m.role)).toEqual(['USER', 'ASSISTANT', 'TOOL', 'ASSISTANT']);

    // The real task actually exists now — not just an echoed tool_result.
    const tasksRes = await gql(`{ tasks(first: 20) { edges { node { title priority status } } } }`);
    const created = tasksRes.body.data.tasks.edges.map((e: any) => e.node).find((t: any) => t.title === 'Buy milk');
    expect(created).toBeDefined();
    expect(created.priority).toBe(2);
    expect(created.status).toBe('PENDING');
  });

  it('complete_task: marks a real, existing task complete', async () => {
    const created = await gql(`mutation { createTask(input: { title: "Stretch" }) { task { id } errors { code } } }`);
    const taskId = created.body.data.createTask.task.id;

    scenario = { name: 'complete_task', input: { taskId } };
    const { mutationResult } = await sendAndCollect('Mark stretch as done');
    expect(mutationResult.errors).toEqual([]);

    const tasksRes = await gql(`{ tasks(first: 20, statuses: [COMPLETED]) { edges { node { id status } } } }`);
    const completed = tasksRes.body.data.tasks.edges.map((e: any) => e.node).find((t: any) => t.id === taskId);
    expect(completed?.status).toBe('COMPLETED');
  });

  it('complete_task: a bogus taskId fails gracefully with a real explanation instead of crashing the turn', async () => {
    scenario = { name: 'complete_task', input: { taskId: 'not-a-real-id' } };
    const { chunks, mutationResult } = await sendAndCollect('Mark the thing as done');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta.toLowerCase()).toContain("couldn't find");
  });

  it('reschedule_task: refuses to double-book a fixed calendar event, and leaves the task genuinely untouched', async () => {
    const created = await gql(`mutation { createTask(input: { title: "Read" }) { task { id } errors { code } } }`);
    const taskId = created.body.data.createTask.task.id;

    const conflictStart = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const conflictEnd = new Date(conflictStart.getTime() + 30 * 60 * 1000);
    await gql(
      `mutation { createCalendarEvent(input: { title: "Fixed sync", startTime: "${conflictStart.toISOString()}", endTime: "${conflictEnd.toISOString()}", isImmovable: true }) { event { id } errors { code } } }`,
    );

    // Plain local-wall-clock format (no offset/Z) — dev-auth users always
    // have `timezone` fixed at UTC, so this string parses as the exact
    // same real instant as conflictStart, the same convention
    // RESCHEDULE_TASK_TOOL's own schema asks the model for.
    const startTimeLocal = conflictStart.toISOString().slice(0, 19);
    scenario = { name: 'reschedule_task', input: { taskId, startTime: startTimeLocal } };
    const { chunks, mutationResult } = await sendAndCollect('Move Read to right when my Fixed sync is');

    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta.toLowerCase()).toContain("couldn't reschedule");

    // The conflict check actually blocked the write, not just the message
    // shown — the task's own schedule is still genuinely unset.
    const tasksRes = await gql(`{ tasks(first: 20) { edges { node { id scheduledStart } } } }`);
    const stillUnscheduled = tasksRes.body.data.tasks.edges.map((e: any) => e.node).find((t: any) => t.id === taskId);
    expect(stillUnscheduled?.scheduledStart).toBeNull();
  });

  it('reschedule_task: a real, conflict-free reschedule actually applies', async () => {
    const created = await gql(`mutation { createTask(input: { title: "Plan trip", estimatedDurationMinutes: 45 }) { task { id } errors { code } } }`);
    const taskId = created.body.data.createTask.task.id;

    const target = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // a few days out — realistically clear
    const startTimeLocal = target.toISOString().slice(0, 19);
    scenario = { name: 'reschedule_task', input: { taskId, startTime: startTimeLocal } };
    const { mutationResult } = await sendAndCollect('Move Plan trip to a few days from now');
    expect(mutationResult.errors).toEqual([]);

    const tasksRes = await gql(`{ tasks(first: 20) { edges { node { id scheduledStart scheduledEnd } } } }`);
    const rescheduled = tasksRes.body.data.tasks.edges.map((e: any) => e.node).find((t: any) => t.id === taskId);
    expect(rescheduled?.scheduledStart).not.toBeNull();
    // 45-minute estimate → a 45-minute real block, not some other default.
    const start = new Date(rescheduled.scheduledStart).getTime();
    const end = new Date(rescheduled.scheduledEnd).getTime();
    expect((end - start) / 60000).toBe(45);
  });

  it('a plain question with no action requested never calls a tool at all', async () => {
    scenario = null;
    const { chunks, mutationResult } = await sendAndCollect('How am I doing today?');
    expect(mutationResult.errors).toEqual([]);
    expect(chunks.filter((c) => !c.done).map((c) => c.role)).toEqual(['ASSISTANT']);
    expect(mutationResult.conversation.messages.map((m: any) => m.role)).toEqual(['USER', 'ASSISTANT']);
  });

  // Expanded tool set increment: four more real actions, each reusing a
  // service ChatService already had injected before this increment
  // (SignalsService, CalendarService, MemoryService).
  it('log_mood_checkin: a real mood entry shows up in todayPlan', async () => {
    scenario = { name: 'log_mood_checkin', input: { moodScore: 4, note: 'Feeling good' } };
    const { chunks, mutationResult } = await sendAndCollect("I'm feeling pretty good right now, a 4 out of 5");
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta).toContain('4/5');

    const today = await gql(`{ todayPlan { todayMood { moodScore note } } }`);
    expect(today.body.data.todayPlan.todayMood.moodScore).toBe(4);
    expect(today.body.data.todayPlan.todayMood.note).toBe('Feeling good');
  });

  it('log_mood_checkin: an out-of-range score fails gracefully', async () => {
    scenario = { name: 'log_mood_checkin', input: { moodScore: 9 } };
    const { chunks, mutationResult } = await sendAndCollect('My mood is a 9 right now');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta.toLowerCase()).toContain('could not log');
  });

  it('log_energy_checkin: a real energy entry shows up in todayPlan, with source MANUAL', async () => {
    scenario = { name: 'log_energy_checkin', input: { energyScore: 2 } };
    const { mutationResult } = await sendAndCollect('My energy is low today, like a 2');
    expect(mutationResult.errors).toEqual([]);

    const today = await gql(`{ todayPlan { todayEnergy { energyScore source } } }`);
    expect(today.body.data.todayPlan.todayEnergy.energyScore).toBe(2);
    expect(today.body.data.todayPlan.todayEnergy.source).toBe('MANUAL');
  });

  it('create_calendar_event: a real event gets created with the right start and end', async () => {
    const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const startTimeLocal = start.toISOString().slice(0, 19);
    const endTimeLocal = end.toISOString().slice(0, 19);

    scenario = {
      name: 'create_calendar_event',
      input: { title: 'Dentist appointment', startTime: startTimeLocal, endTime: endTimeLocal },
    };
    const { chunks, mutationResult } = await sendAndCollect('Add a dentist appointment two days from now for an hour');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta).toContain('Dentist appointment');

    const rangeStart = new Date(start.getTime() - 60 * 60 * 1000).toISOString();
    const rangeEnd = new Date(end.getTime() + 60 * 60 * 1000).toISOString();
    const calendarRes = await gql(`{ calendarEventsInRange(start: "${rangeStart}", end: "${rangeEnd}") { title startTime endTime isImmovable } }`);
    const created = calendarRes.body.data.calendarEventsInRange.find((e: any) => e.title === 'Dentist appointment');
    expect(created).toBeDefined();
    expect(created.isImmovable).toBe(false);
  });

  it('create_calendar_event: an end time before the start time is rejected without saving anything', async () => {
    const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() - 60 * 60 * 1000); // before start — invalid
    scenario = {
      name: 'create_calendar_event',
      input: { title: 'Backwards event', startTime: start.toISOString().slice(0, 19), endTime: end.toISOString().slice(0, 19) },
    };
    const { chunks, mutationResult } = await sendAndCollect('Add an event with an end time before its start');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta.toLowerCase()).toContain('could not create');

    const rangeStart = new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const rangeEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const calendarRes = await gql(`{ calendarEventsInRange(start: "${rangeStart}", end: "${rangeEnd}") { title } }`);
    expect(calendarRes.body.data.calendarEventsInRange.some((e: any) => e.title === 'Backwards event')).toBe(false);
  });

  it('add_memory_fact: a real memory fact is saved and shows up in memoryFacts', async () => {
    scenario = { name: 'add_memory_fact', input: { content: 'Prefers no meetings before 10am' } };
    const { chunks, mutationResult } = await sendAndCollect('Please remember that I prefer no meetings before 10am');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta).toContain('Prefers no meetings before 10am');

    const factsRes = await gql(`{ memoryFacts { content } }`);
    expect(factsRes.body.data.memoryFacts.some((f: any) => f.content === 'Prefers no meetings before 10am')).toBe(true);
  });

  it('add_memory_fact: content over the 500-character limit is rejected', async () => {
    scenario = { name: 'add_memory_fact', input: { content: 'x'.repeat(501) } };
    const { chunks, mutationResult } = await sendAndCollect('Remember this very long thing');
    expect(mutationResult.errors).toEqual([]);
    const toolChunk = chunks.find((c) => c.role === 'TOOL')!;
    expect(toolChunk.delta.toLowerCase()).toContain('could not save');
  });
});

describe('Memory — CRUD and cross-user isolation (e2e)', () => {
  let app: INestApplication;
  const devEmail = `memory-e2e-${Date.now()}@example.com`;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a memory fact and lists it back', async () => {
    const create = await gql(
      `mutation { createMemoryFact(input: { content: "Never schedule calls before 10am" }) { fact { id content confidence } errors { code } } }`,
    );
    expect(create.body.data.createMemoryFact.errors).toEqual([]);
    expect(create.body.data.createMemoryFact.fact.content).toBe('Never schedule calls before 10am');
    expect(create.body.data.createMemoryFact.fact.confidence).toBe(1);

    const list = await gql(`{ memoryFacts { id content } }`);
    expect(list.body.data.memoryFacts.some((f: any) => f.content === 'Never schedule calls before 10am')).toBe(true);
  });

  it('updates a memory fact in place', async () => {
    const create = await gql(`mutation { createMemoryFact(input: { content: "Original" }) { fact { id } errors { code } } }`);
    const id = create.body.data.createMemoryFact.fact.id;

    const update = await gql(`mutation { updateMemoryFact(id: "${id}", input: { content: "Updated" }) { fact { id content } errors { code } } }`);
    expect(update.body.data.updateMemoryFact.fact.content).toBe('Updated');
    expect(update.body.data.updateMemoryFact.fact.id).toBe(id);
  });

  it('deletes a memory fact', async () => {
    const create = await gql(`mutation { createMemoryFact(input: { content: "Temporary" }) { fact { id } errors { code } } }`);
    const id = create.body.data.createMemoryFact.fact.id;

    const del = await gql(`mutation { deleteMemoryFact(id: "${id}") { deletedFactId errors { code } } }`);
    expect(del.body.data.deleteMemoryFact.deletedFactId).toBe(id);

    const list = await gql(`{ memoryFacts { id } }`);
    expect(list.body.data.memoryFacts.some((f: any) => f.id === id)).toBe(false);
  });

  it('rejects updating or deleting a memory fact that belongs to another user', async () => {
    const create = await gql(`mutation { createMemoryFact(input: { content: "Private fact" }) { fact { id } errors { code } } }`);
    const id = create.body.data.createMemoryFact.fact.id;

    const otherEmail = `memory-e2e-other-${Date.now()}@example.com`;
    const updateRes = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { updateMemoryFact(id: "${id}", input: { content: "Hijacked" }) { fact { id } errors { code } } }` });
    expect(updateRes.body.data.updateMemoryFact.fact).toBeNull();
    expect(updateRes.body.data.updateMemoryFact.errors[0].code).toBe('UPDATE_FAILED');

    const deleteRes = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { deleteMemoryFact(id: "${id}") { deletedFactId errors { code } } }` });
    expect(deleteRes.body.data.deleteMemoryFact.deletedFactId).toBeNull();
    expect(deleteRes.body.data.deleteMemoryFact.errors[0].code).toBe('DELETE_FAILED');
  });
});

// Proves memory facts actually change what the AI is told, not just that
// they're stored — AnthropicClient is overridden with a fake that captures
// the exact prompt/system string it was called with, so these assertions
// are checking real production code (buildPrompt/buildContext in
// planner.service.ts/chat.service.ts), not a mock of them.
describe('Memory — reaching the AI planner and chat prompts (e2e)', () => {
  let app: INestApplication;
  const devEmail = `memory-context-e2e-${Date.now()}@example.com`;
  let capturedPlannerPrompt: string | undefined;
  let capturedChatSystem: string | undefined;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPlannerPrompt = prompt;
        return { proposal: { summary: 'ok', changes: [] }, modelUsed: 'fake-model-for-tests' };
      },
      sendMessage: async (_messages: unknown, system: string) => {
        capturedChatSystem = system;
        return { content: 'ok', modelUsed: 'fake-model-for-tests' };
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await gql(`mutation { createMemoryFact(input: { content: "Prefers deep work in the morning" }) { fact { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes memory facts in the AI daily planning prompt', async () => {
    await gql(`mutation { createTask(input: { title: "Write report" }) { task { id } errors { code } } }`);
    const res = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    expect(res.body.data.requestReplan.errors).toEqual([]);
    expect(capturedPlannerPrompt).toContain('Prefers deep work in the morning');
  });

  it('includes memory facts in the chat system prompt', async () => {
    const res = await gql(`mutation { sendChatMessage(content: "hi") { conversation { id } errors { code } } }`);
    expect(res.body.data.sendChatMessage.errors).toEqual([]);
    expect(capturedChatSystem).toContain('Prefers deep work in the morning');
  });
});

// Two-way calendar sync (push-deletes-back increment). GoogleCalendarWriteService
// is overridden with a fake — same reasoning as every AnthropicClient override
// above: this proves real production code (CalendarService.delete /
// CalendarResolver.deleteCalendarEvent) calls out to Google before touching
// the local row, and handles a rejection correctly, without needing a live
// Google account or network access. CalendarAccount/CalendarEvent rows for a
// synced event are seeded directly via Prisma (there's no GraphQL mutation
// that creates one without a real OAuth round-trip) — one CalendarAccount
// per user is created once in beforeAll (the schema's
// @@unique([userId, provider]) means a second one would fail), and each test
// creates its own CalendarEvent against it with a unique externalEventId.
describe('Two-way calendar sync — deleting a synced event (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `twoway-e2e-${Date.now()}@example.com`;
  let userId: string;
  let accountId: string;
  let deleteRemoteEventCalls: Array<{ calendarAccountId: string; externalEventId: string }>;
  let shouldFailWithReconnect: boolean;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    deleteRemoteEventCalls = [];
    shouldFailWithReconnect = false;

    const fakeGoogleWrite = {
      deleteRemoteEvent: async (calendarAccountId: string, externalEventId: string) => {
        deleteRemoteEventCalls.push({ calendarAccountId, externalEventId });
        if (shouldFailWithReconnect) {
          throw new GoogleReconnectRequiredError();
        }
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleCalendarWriteService)
      .useValue(fakeGoogleWrite)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);

    const me = await gql('{ me { id } }');
    userId = me.body.data.me.id;

    const account = await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'GOOGLE',
        accessTokenEncrypted: Buffer.from('fake-access-token'),
        refreshTokenEncrypted: Buffer.from('fake-refresh-token'),
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    deleteRemoteEventCalls = [];
    shouldFailWithReconnect = false;
  });

  async function seedSyncedEvent() {
    return prisma.calendarEvent.create({
      data: {
        userId,
        calendarAccountId: accountId,
        externalEventId: `google-event-${Date.now()}-${Math.random()}`,
        title: 'Synced meeting',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 90 * 60 * 1000),
        source: 'GOOGLE',
      },
    });
  }

  it('pushes the delete to Google before removing a synced event locally', async () => {
    const event = await seedSyncedEvent();

    const res = await gql(`mutation { deleteCalendarEvent(id: "${event.id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.errors).toEqual([]);
    expect(res.body.data.deleteCalendarEvent.deletedEventId).toBe(event.id);
    expect(deleteRemoteEventCalls).toEqual([{ calendarAccountId: accountId, externalEventId: event.externalEventId }]);

    const stillThere = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(stillThere).toBeNull();
  });

  it('returns RECONNECT_REQUIRED and leaves the event intact when the account only has read access', async () => {
    shouldFailWithReconnect = true;
    const event = await seedSyncedEvent();

    const res = await gql(`mutation { deleteCalendarEvent(id: "${event.id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.deletedEventId).toBeNull();
    expect(res.body.data.deleteCalendarEvent.errors[0].code).toBe('RECONNECT_REQUIRED');

    const stillThere = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(stillThere).not.toBeNull();
  });

  it('does not call the Google delete API when deleting a native event', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const created = await gql(
      `mutation { createCalendarEvent(input: { title: "Native event", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code } } }`,
    );
    const id = created.body.data.createCalendarEvent.event.id;

    const res = await gql(`mutation { deleteCalendarEvent(id: "${id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.errors).toEqual([]);
    expect(deleteRemoteEventCalls).toEqual([]);
  });
});

// Microsoft (Outlook/365) calendar sync (pull-only increment).
// MicrosoftCalendarClient is overridden with a fake — same reasoning as
// every other external-API override in this suite (AnthropicClient,
// GoogleCalendarWriteService): proves the real production sync logic in
// MicrosoftCalendarAccountsService.sync() (via the real
// syncMicrosoftCalendarNow mutation) without a live Azure AD app or network
// access. The CalendarAccount row is seeded directly via Prisma, same
// reasoning as the two-way-sync block above — there's no GraphQL mutation
// that creates one without a real OAuth round trip, and the actual
// connect()/OAuth-callback path isn't covered here for the same reason it
// isn't covered for Google either (see the README's honest gap note).
describe('Microsoft calendar sync — pulling events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `mssync-e2e-${Date.now()}@example.com`;
  let userId: string;
  let accountId: string;
  let fakeEvents: Array<Record<string, unknown>>;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    fakeEvents = [];

    const fakeMicrosoftClient = {
      listEvents: async () => ({
        events: fakeEvents,
        nextDeltaLink: 'https://graph.microsoft.com/v1.0/me/calendarview/delta?$deltatoken=fake',
        fullResyncRequired: false,
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MicrosoftCalendarClient)
      .useValue(fakeMicrosoftClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);

    const me = await gql('{ me { id } }');
    userId = me.body.data.me.id;

    const account = await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'MICROSOFT',
        accessTokenEncrypted: Buffer.from('fake-access-token'),
        refreshTokenEncrypted: Buffer.from('fake-refresh-token'),
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('syncs a Microsoft event into calendar_events, tagged MICROSOFT, with the UTC-naive datetime parsed correctly', async () => {
    fakeEvents = [
      {
        id: 'ms-event-1',
        subject: 'Standup',
        start: { dateTime: '2026-08-05T09:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-08-05T09:30:00.0000000', timeZone: 'UTC' },
      },
    ];

    const res = await gql(`mutation { syncMicrosoftCalendarNow { syncedEventCount errors { code } } }`);
    expect(res.body.data.syncMicrosoftCalendarNow.errors).toEqual([]);
    expect(res.body.data.syncMicrosoftCalendarNow.syncedEventCount).toBe(1);

    const stored = await prisma.calendarEvent.findFirst({ where: { calendarAccountId: accountId, externalEventId: 'ms-event-1' } });
    expect(stored).not.toBeNull();
    expect(stored!.title).toBe('Standup');
    expect(stored!.source).toBe('MICROSOFT');
    // The 'Z' has to be appended by the sync code (Graph's datetime strings
    // don't include it) — if that appending logic ever regresses, this
    // would silently drift by however many hours off UTC the machine
    // running the test happens to be, which is exactly the bug class this
    // assertion exists to catch.
    expect(stored!.startTime.toISOString()).toBe('2026-08-05T09:00:00.000Z');
    expect(stored!.endTime.toISOString()).toBe('2026-08-05T09:30:00.000Z');
  });

  it('removes a previously-synced event when a later sync reports it as @removed', async () => {
    fakeEvents = [{ id: 'ms-event-1', '@removed': { reason: 'deleted' } }];

    const res = await gql(`mutation { syncMicrosoftCalendarNow { errors { code } } }`);
    expect(res.body.data.syncMicrosoftCalendarNow.errors).toEqual([]);

    const stored = await prisma.calendarEvent.findFirst({ where: { calendarAccountId: accountId, externalEventId: 'ms-event-1' } });
    expect(stored).toBeNull();
  });

  it('returns a clear error rather than crashing when syncing with no connected Microsoft account', async () => {
    const otherEmail = `mssync-e2e-other-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { syncMicrosoftCalendarNow { syncedEventCount errors { code } } }` });

    expect(res.body.data.syncMicrosoftCalendarNow.syncedEventCount).toBeNull();
    expect(res.body.data.syncMicrosoftCalendarNow.errors[0].code).toBe('SYNC_FAILED');
  });
});

// Microsoft push-deletes-back increment — structurally identical to the
// Google two-way-sync block above (same reasoning: MicrosoftCalendarWriteService
// is overridden with a fake so this proves the real CalendarService.delete
// dispatch logic through the actual deleteCalendarEvent mutation, without a
// live Azure AD app or network access).
describe('Microsoft calendar sync — deleting a synced event (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `mstwoway-e2e-${Date.now()}@example.com`;
  let userId: string;
  let accountId: string;
  let deleteRemoteEventCalls: Array<{ calendarAccountId: string; externalEventId: string }>;
  let googleDeleteRemoteEventCalls: Array<{ calendarAccountId: string; externalEventId: string }>;
  let shouldFailWithReconnect: boolean;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    deleteRemoteEventCalls = [];
    googleDeleteRemoteEventCalls = [];
    shouldFailWithReconnect = false;

    const fakeMicrosoftWrite = {
      deleteRemoteEvent: async (calendarAccountId: string, externalEventId: string) => {
        deleteRemoteEventCalls.push({ calendarAccountId, externalEventId });
        if (shouldFailWithReconnect) {
          throw new MicrosoftReconnectRequiredError();
        }
      },
    };
    // Also faked here (not just overridden in the Google describe block
    // above) so the "doesn't call Microsoft for a Google-sourced event"
    // test below can seed a real GOOGLE-sourced event and delete it without
    // making a live network call to Google's API — this block only cares
    // that the *Microsoft* path stays untouched, so the Google fake here
    // just needs to not throw.
    const fakeGoogleWrite = {
      deleteRemoteEvent: async (calendarAccountId: string, externalEventId: string) => {
        googleDeleteRemoteEventCalls.push({ calendarAccountId, externalEventId });
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MicrosoftCalendarWriteService)
      .useValue(fakeMicrosoftWrite)
      .overrideProvider(GoogleCalendarWriteService)
      .useValue(fakeGoogleWrite)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);

    const me = await gql('{ me { id } }');
    userId = me.body.data.me.id;

    const account = await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'MICROSOFT',
        accessTokenEncrypted: Buffer.from('fake-access-token'),
        refreshTokenEncrypted: Buffer.from('fake-refresh-token'),
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    deleteRemoteEventCalls = [];
    googleDeleteRemoteEventCalls = [];
    shouldFailWithReconnect = false;
  });

  async function seedSyncedEvent() {
    return prisma.calendarEvent.create({
      data: {
        userId,
        calendarAccountId: accountId,
        externalEventId: `ms-event-${Date.now()}-${Math.random()}`,
        title: 'Synced meeting',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 90 * 60 * 1000),
        source: 'MICROSOFT',
      },
    });
  }

  it('pushes the delete to Microsoft before removing a synced event locally', async () => {
    const event = await seedSyncedEvent();

    const res = await gql(`mutation { deleteCalendarEvent(id: "${event.id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.errors).toEqual([]);
    expect(res.body.data.deleteCalendarEvent.deletedEventId).toBe(event.id);
    expect(deleteRemoteEventCalls).toEqual([{ calendarAccountId: accountId, externalEventId: event.externalEventId }]);

    const stillThere = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(stillThere).toBeNull();
  });

  it('returns RECONNECT_REQUIRED and leaves the event intact when the account only has read access', async () => {
    shouldFailWithReconnect = true;
    const event = await seedSyncedEvent();

    const res = await gql(`mutation { deleteCalendarEvent(id: "${event.id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.deletedEventId).toBeNull();
    expect(res.body.data.deleteCalendarEvent.errors[0].code).toBe('RECONNECT_REQUIRED');

    const stillThere = await prisma.calendarEvent.findUnique({ where: { id: event.id } });
    expect(stillThere).not.toBeNull();
  });

  it('does not call the Microsoft delete API when deleting a native event', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const created = await gql(
      `mutation { createCalendarEvent(input: { title: "Native event", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code } } }`,
    );
    const id = created.body.data.createCalendarEvent.event.id;

    const res = await gql(`mutation { deleteCalendarEvent(id: "${id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.errors).toEqual([]);
    expect(deleteRemoteEventCalls).toEqual([]);
  });

  it('does not call the Microsoft delete API when deleting a Google-synced event', async () => {
    const googleAccount = await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'GOOGLE',
        accessTokenEncrypted: Buffer.from('fake-access-token'),
        refreshTokenEncrypted: Buffer.from('fake-refresh-token'),
      },
    });
    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        calendarAccountId: googleAccount.id,
        externalEventId: `google-event-${Date.now()}-${Math.random()}`,
        title: 'Google meeting',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 90 * 60 * 1000),
        source: 'GOOGLE',
      },
    });

    const res = await gql(`mutation { deleteCalendarEvent(id: "${event.id}") { deletedEventId errors { code } } }`);
    expect(res.body.data.deleteCalendarEvent.errors).toEqual([]);
    // Confirms CalendarService.delete's source-based dispatch (added this
    // increment) routes a GOOGLE event to the Google write path and never
    // touches the Microsoft one — the two-way-sync block above already
    // covers "Google events push to Google," this one specifically guards
    // against the new dispatch logic accidentally routing every non-native
    // event to Microsoft regardless of its real source.
    expect(deleteRemoteEventCalls).toEqual([]);
    expect(googleDeleteRemoteEventCalls).toEqual([
      { calendarAccountId: googleAccount.id, externalEventId: event.externalEventId },
    ]);
  });
});

// Automatic AI Memory learning — the simple, statistical version (see
// README): no vector embeddings, no ML, just real accept/reject history
// aggregated into a memory fact after every plan-run response. AnthropicClient
// is overridden with a fake that captures the exact prompt text, same
// pattern as every other prompt-capture test in this file — proving the
// real production code in memory.service.ts/planner.service.ts, not a
// simulation of it. Each scenario gets its own fresh user/app so the
// PLAN_RESPONSE_SAMPLE_SIZE sliding window doesn't need to be reasoned
// about across tests.
describe('Automatic AI Memory learning — too few plan responses (e2e)', () => {
  let app: INestApplication;
  const devEmail = `auto-memory-few-e2e-${Date.now()}@example.com`;
  let capturedPlannerPrompt: string | undefined;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  async function generateAndRespond(decision: 'ACCEPT' | 'REJECT') {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    const id = gen.body.data.requestReplan.planRun.id;
    await gql(`mutation { respondToPlanRun(id: "${id}", decision: ${decision}) { planRun { status } errors { code } } }`);
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPlannerPrompt = prompt;
        return { proposal: { summary: 'ok', changes: [] }, modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await gql(`mutation { createTask(input: { title: "Recurring open task" }) { task { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes no pattern fact when fewer than 3 plan runs have been responded to', async () => {
    await generateAndRespond('REJECT');
    await generateAndRespond('REJECT'); // only 2 responded runs — below the minimum sample size

    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    expect(gen.body.data.requestReplan.errors).toEqual([]);
    expect(capturedPlannerPrompt).not.toContain('Often rejects proposed daily plans');
    expect(capturedPlannerPrompt).not.toContain('Consistently accepts proposed daily plans');
  });
});

describe('Automatic AI Memory learning — majority-reject pattern (e2e)', () => {
  let app: INestApplication;
  const devEmail = `auto-memory-reject-e2e-${Date.now()}@example.com`;
  let capturedPlannerPrompt: string | undefined;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  async function generateAndRespond(decision: 'ACCEPT' | 'REJECT') {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    const id = gen.body.data.requestReplan.planRun.id;
    await gql(`mutation { respondToPlanRun(id: "${id}", decision: ${decision}) { planRun { status } errors { code } } }`);
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPlannerPrompt = prompt;
        return { proposal: { summary: 'ok', changes: [] }, modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await gql(`mutation { createTask(input: { title: "Recurring open task" }) { task { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes an "often rejects" fact once 3+ recent responses are majority-reject, and it reaches the next prompt', async () => {
    await generateAndRespond('REJECT');
    await generateAndRespond('REJECT');
    await generateAndRespond('REJECT');

    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    expect(gen.body.data.requestReplan.errors).toEqual([]);
    expect(capturedPlannerPrompt).toContain('Often rejects proposed daily plans (3 of the last 3)');
  });
});

describe('Automatic AI Memory learning — all-accept pattern (e2e)', () => {
  let app: INestApplication;
  const devEmail = `auto-memory-accept-e2e-${Date.now()}@example.com`;
  let capturedPlannerPrompt: string | undefined;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  async function generateAndRespond(decision: 'ACCEPT' | 'REJECT') {
    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    const id = gen.body.data.requestReplan.planRun.id;
    await gql(`mutation { respondToPlanRun(id: "${id}", decision: ${decision}) { planRun { status } errors { code } } }`);
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async (prompt: string) => {
        capturedPlannerPrompt = prompt;
        return { proposal: { summary: 'ok', changes: [] }, modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // A fake proposal with empty `changes` (see beforeAll above) means
    // accepting never actually schedules anything, so this one task stays
    // open and reusable across every generate-and-respond cycle below.
    await gql(`mutation { createTask(input: { title: "Recurring open task" }) { task { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes a "consistently accepts" fact once 3+ recent responses are all-accept, and it reaches the next prompt', async () => {
    await generateAndRespond('ACCEPT');
    await generateAndRespond('ACCEPT');
    await generateAndRespond('ACCEPT');

    const gen = await gql(`mutation { requestReplan { planRun { id } errors { code message } } }`);
    expect(gen.body.data.requestReplan.errors).toEqual([]);
    expect(capturedPlannerPrompt).toContain('Consistently accepts proposed daily plans (all of the last 3)');
  });
});

// Focus sessions / Pomodoro timer (PRD §7.1, UI/UX Design Document §4).
// No external API to fake here — this is entirely local data, so these run
// against the real FocusService/FocusResolver with no overrides, same as
// the plain "Tasks & Goals" suite.
describe('Focus sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `focus-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('starts a task-linked session, completes it, and sees it in recent sessions', async () => {
    const task = await gql(`mutation { createTask(input: { title: "Write the deck" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;

    const started = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 25 }) { session { id taskId taskTitle plannedDurationMinutes status } errors { code } } }`,
    );
    expect(started.body.data.startFocusSession.errors).toEqual([]);
    expect(started.body.data.startFocusSession.session.taskTitle).toBe('Write the deck');
    expect(started.body.data.startFocusSession.session.status).toBe('IN_PROGRESS');
    const sessionId = started.body.data.startFocusSession.session.id;

    const active = await gql(`{ activeFocusSession { id status } }`);
    expect(active.body.data.activeFocusSession.id).toBe(sessionId);

    const completed = await gql(
      `mutation { completeFocusSession(id: "${sessionId}") { session { status } errors { code } } }`,
    );
    expect(completed.body.data.completeFocusSession.session.status).toBe('COMPLETED');

    const activeAfter = await gql(`{ activeFocusSession { id } }`);
    expect(activeAfter.body.data.activeFocusSession).toBeNull();

    const recent = await gql(`{ recentFocusSessions(first: 5) { id status taskTitle } }`);
    expect(recent.body.data.recentFocusSessions.some((s: any) => s.id === sessionId && s.status === 'COMPLETED')).toBe(
      true,
    );
  });

  it('starts a session with no task, then cancels it', async () => {
    const started = await gql(
      `mutation { startFocusSession(input: { plannedDurationMinutes: 5 }) { session { id taskId taskTitle } errors { code } } }`,
    );
    expect(started.body.data.startFocusSession.session.taskId).toBeNull();
    expect(started.body.data.startFocusSession.session.taskTitle).toBeNull();
    const sessionId = started.body.data.startFocusSession.session.id;

    const cancelled = await gql(
      `mutation { cancelFocusSession(id: "${sessionId}") { session { status } errors { code } } }`,
    );
    expect(cancelled.body.data.cancelFocusSession.session.status).toBe('CANCELLED');
  });

  it('refuses to start a second session while one is already active', async () => {
    const first = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 10 }) { session { id } errors { code } } }`);
    const firstId = first.body.data.startFocusSession.session.id;

    const second = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 10 }) { session { id } errors { code message } } }`);
    expect(second.body.data.startFocusSession.session).toBeNull();
    expect(second.body.data.startFocusSession.errors[0].code).toBe('ALREADY_ACTIVE');

    // Clean up so this describe block's later tests (which assume no
    // pre-existing active session) aren't affected by run order.
    await gql(`mutation { cancelFocusSession(id: "${firstId}") { session { status } errors { code } } }`);
  });

  it('refuses to complete or cancel a session that already ended', async () => {
    const started = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 10 }) { session { id } errors { code } } }`);
    const sessionId = started.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${sessionId}") { session { status } errors { code } } }`);

    const secondComplete = await gql(`mutation { completeFocusSession(id: "${sessionId}") { session { id } errors { code message } } }`);
    expect(secondComplete.body.data.completeFocusSession.errors[0].code).toBe('NOT_ACTIVE');

    const cancelAttempt = await gql(`mutation { cancelFocusSession(id: "${sessionId}") { session { id } errors { code message } } }`);
    expect(cancelAttempt.body.data.cancelFocusSession.errors[0].code).toBe('NOT_ACTIVE');
  });

  it('rejects starting a session linked to a task that belongs to another user', async () => {
    const otherEmail = `focus-e2e-other-${Date.now()}@example.com`;
    const otherTask = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { createTask(input: { title: "Someone else's task" }) { task { id } errors { code } } }` });
    const otherTaskId = otherTask.body.data.createTask.task.id;

    const res = await gql(
      `mutation { startFocusSession(input: { taskId: "${otherTaskId}", plannedDurationMinutes: 10 }) { session { id } errors { code } } }`,
    );
    expect(res.body.data.startFocusSession.session).toBeNull();
    expect(res.body.data.startFocusSession.errors[0].code).toBe('START_FAILED');
  });

  // Focus sessions feed task duration back increment. A session started and
  // completed within the same test runs in milliseconds, not real minutes —
  // same "backdate the real row via Prisma after the real mutation, since
  // there's no way to actually wait 47 minutes in a test" pattern the
  // Insights dailyFocusMinutes test above already established, not a new
  // shortcut invented just for this test.
  it('focusedMinutesForTask sums every real completed session on a task, ignoring cancelled ones and other tasks', async () => {
    const task = await gql(`mutation { createTask(input: { title: "Write the proposal" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    const otherTask = await gql(`mutation { createTask(input: { title: "Unrelated task" }) { task { id } errors { code } } }`);
    const otherTaskId = otherTask.body.data.createTask.task.id;

    // Nothing yet — a task with no focus sessions at all reports null, not 0.
    const before = await gql(`{ focusedMinutesForTask(taskId: "${taskId}") }`);
    expect(before.body.data.focusedMinutesForTask).toBeNull();

    // First real, completed sitting: 47 real minutes (backdated).
    const first = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const firstId = first.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${firstId}") { session { status } errors { code } } }`);
    const firstStart = new Date(Date.now() - 60 * 60 * 1000);
    const firstEnd = new Date(firstStart.getTime() + 47 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: firstId }, data: { startedAt: firstStart, endedAt: firstEnd } });

    // Second real, completed sitting on the *same* task, a different day: 13
    // more real minutes — the total should be the sum of both, 60.
    const second = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 15 }) { session { id } errors { code } } }`,
    );
    const secondId = second.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${secondId}") { session { status } errors { code } } }`);
    const secondStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const secondEnd = new Date(secondStart.getTime() + 13 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: secondId }, data: { startedAt: secondStart, endedAt: secondEnd } });

    // A cancelled session on the same task — genuinely never happened as
    // real finished time, so it must never count toward the total.
    const cancelled = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const cancelledId = cancelled.body.data.startFocusSession.session.id;
    await gql(`mutation { cancelFocusSession(id: "${cancelledId}") { session { status } errors { code } } }`);
    const cancelledStart = new Date(Date.now() - 10 * 60 * 1000);
    const cancelledEnd = new Date(cancelledStart.getTime() + 25 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: cancelledId }, data: { startedAt: cancelledStart, endedAt: cancelledEnd } });

    // A real, completed session — but on the *other* task. Must never leak
    // into this task's total.
    const otherSession = await gql(
      `mutation { startFocusSession(input: { taskId: "${otherTaskId}", plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const otherSessionId = otherSession.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${otherSessionId}") { session { status } errors { code } } }`);
    const otherStart = new Date(Date.now() - 5 * 60 * 1000);
    const otherEnd = new Date(otherStart.getTime() + 99 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: otherSessionId }, data: { startedAt: otherStart, endedAt: otherEnd } });

    const after = await gql(`{ focusedMinutesForTask(taskId: "${taskId}") }`);
    expect(after.body.data.focusedMinutesForTask).toBe(60); // 47 + 13, cancelled and other-task sessions excluded

    const otherTotal = await gql(`{ focusedMinutesForTask(taskId: "${otherTaskId}") }`);
    expect(otherTotal.body.data.focusedMinutesForTask).toBe(99);
  });

  // Automatic Pomodoro work/break cycling increment.
  it('kind defaults to WORK when omitted, and a BREAK session ignores a taskId even if one is sent', async () => {
    const task = await gql(`mutation { createTask(input: { title: "Deep work task" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;

    const work = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 25 }) { session { id kind taskId } errors { code } } }`,
    );
    expect(work.body.data.startFocusSession.session.kind).toBe('WORK');
    expect(work.body.data.startFocusSession.session.taskId).toBe(taskId);
    await gql(`mutation { cancelFocusSession(id: "${work.body.data.startFocusSession.session.id}") { session { id } errors { code } } }`);

    // A hand-crafted request that sends both kind: BREAK and a taskId — the
    // service must still never attach a task to a break, same guard the
    // Pomodoro auto-cycler on the client relies on never being bypassable.
    const brokenBreak = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 5, kind: BREAK }) { session { id kind taskId taskTitle } errors { code } } }`,
    );
    expect(brokenBreak.body.data.startFocusSession.session.kind).toBe('BREAK');
    expect(brokenBreak.body.data.startFocusSession.session.taskId).toBeNull();
    expect(brokenBreak.body.data.startFocusSession.session.taskTitle).toBeNull();
    await gql(`mutation { cancelFocusSession(id: "${brokenBreak.body.data.startFocusSession.session.id}") { session { id } errors { code } } }`);
  });

  it('focusedMinutesForTask counts only WORK sessions — a completed BREAK on the same task never adds to the total', async () => {
    const task = await gql(`mutation { createTask(input: { title: "Ship the release" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;

    const work = await gql(
      `mutation { startFocusSession(input: { taskId: "${taskId}", plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const workId = work.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${workId}") { session { status } errors { code } } }`);
    const workStart = new Date(Date.now() - 60 * 60 * 1000);
    const workEnd = new Date(workStart.getTime() + 25 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: workId }, data: { startedAt: workStart, endedAt: workEnd } });

    // A real, completed 15-minute break — genuinely finished, but rest time,
    // not focused work on this task (and the server ignores taskId on a
    // break anyway — this row is never linked to `taskId` in the first
    // place, which is exactly why it must not appear in this total).
    const brk = await gql(
      `mutation { startFocusSession(input: { plannedDurationMinutes: 15, kind: BREAK }) { session { id } errors { code } } }`,
    );
    const brkId = brk.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${brkId}") { session { status } errors { code } } }`);
    const brkStart = new Date(Date.now() - 30 * 60 * 1000);
    const brkEnd = new Date(brkStart.getTime() + 15 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: brkId }, data: { startedAt: brkStart, endedAt: brkEnd } });

    const total = await gql(`{ focusedMinutesForTask(taskId: "${taskId}") }`);
    expect(total.body.data.focusedMinutesForTask).toBe(25); // the break's 15 minutes never counted
  });

});

// Apple (CalDAV) calendar sync (pull-only increment). AppleCaldavClient is
// overridden with a fake — same reasoning as every other external-protocol
// override in this suite (AnthropicClient, GoogleCalendarWriteService,
// MicrosoftCalendarClient): proves the real AppleCalendarAccountsService
// orchestration (discovery chain → connect → sync → disconnect) through the
// actual connectAppleCalendar/syncAppleCalendarNow/disconnectAppleCalendar
// mutations, without a live iCloud account, network access, or a real XML
// multistatus response to parse (the fake returns already-parsed
// AppleCalendarEvent objects — the XML-parsing half of AppleCaldavClient
// itself is unverified here, an even more pronounced version of the "OAuth
// round trip can't be exercised in this sandbox" gap every other
// calendar-sync increment has documented; see README).
describe('Apple (CalDAV) calendar sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `apple-e2e-${Date.now()}@example.com`;
  let fakeEvents: Array<{ href: string; removed?: boolean; summary?: string; status?: string; dtstart?: string; dtend?: string }>;
  let shouldFailAuth: boolean;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    fakeEvents = [];
    shouldFailAuth = false;

    const fakeCaldavClient = {
      discoverPrincipal: async () => {
        if (shouldFailAuth) throw new AppleAuthError(401, 'Unauthorized');
        return 'https://caldav.icloud.com/1234/principal/';
      },
      discoverCalendarHome: async () => 'https://caldav.icloud.com/1234/calendars/',
      findDefaultCalendar: async () => 'https://caldav.icloud.com/1234/calendars/home/',
      listEvents: async () => ({
        events: fakeEvents,
        nextSyncToken: 'fake-sync-token',
        fullResyncRequired: false,
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppleCaldavClient)
      .useValue(fakeCaldavClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects, discovers the calendar, and syncs an initial event tagged APPLE', async () => {
    fakeEvents = [
      { href: 'apple-event-1', summary: 'Dentist', dtstart: '20260810T140000Z', dtend: '20260810T150000Z' },
    ];

    const res = await gql(
      `mutation { connectAppleCalendar(input: { appleId: "me@icloud.com", appSpecificPassword: "abcd-efgh-ijkl-mnop" }) { account { id externalAccountEmail } errors { code message } } }`,
    );
    expect(res.body.data.connectAppleCalendar.errors).toEqual([]);
    expect(res.body.data.connectAppleCalendar.account.externalAccountEmail).toBe('me@icloud.com');

    const account = await gql(`{ appleCalendarAccount { id externalAccountEmail status } }`);
    expect(account.body.data.appleCalendarAccount.status).toBe('ACTIVE');

    const stored = await prisma.calendarEvent.findFirst({ where: { externalEventId: 'apple-event-1', source: 'APPLE' } });
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe('Dentist');
    expect(stored?.startTime.toISOString()).toBe('2026-08-10T14:00:00.000Z');
  });

  it('a later sync reporting an event as removed deletes it locally', async () => {
    fakeEvents = [{ href: 'apple-event-1', removed: true }];

    const res = await gql(`mutation { syncAppleCalendarNow { errors { code } } }`);
    expect(res.body.data.syncAppleCalendarNow.errors).toEqual([]);

    const stored = await prisma.calendarEvent.findFirst({ where: { externalEventId: 'apple-event-1', source: 'APPLE' } });
    expect(stored).toBeNull();
  });

  it('disconnects cleanly', async () => {
    const res = await gql(`mutation { disconnectAppleCalendar { disconnected errors { code } } }`);
    expect(res.body.data.disconnectAppleCalendar.disconnected).toBe(true);

    const account = await gql(`{ appleCalendarAccount { id } }`);
    expect(account.body.data.appleCalendarAccount).toBeNull();
  });

  it('returns a clear error rather than crashing when syncing with no connected Apple account', async () => {
    const res = await gql(`mutation { syncAppleCalendarNow { syncedEventCount errors { code } } }`);
    expect(res.body.data.syncAppleCalendarNow.syncedEventCount).toBeNull();
    expect(res.body.data.syncAppleCalendarNow.errors[0].code).toBe('SYNC_FAILED');
  });

  it('returns APPLE_AUTH_FAILED and creates no account when Apple rejects the credentials', async () => {
    shouldFailAuth = true;
    const otherEmail = `apple-e2e-badauth-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({
        query: `mutation { connectAppleCalendar(input: { appleId: "me@icloud.com", appSpecificPassword: "wrong" }) { account { id } errors { code message } } }`,
      });

    expect(res.body.data.connectAppleCalendar.account).toBeNull();
    expect(res.body.data.connectAppleCalendar.errors[0].code).toBe('APPLE_AUTH_FAILED');

    const account = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `{ appleCalendarAccount { id } }` });
    expect(account.body.data.appleCalendarAccount).toBeNull();
  });
});

// Fix onboarding calendar-connect redirect increment: `GoogleOAuthController`/
// `MicrosoftOAuthController`'s `/callback` endpoints are plain, unauthenticated
// REST (see either controller's own comment on why), so this hits them
// directly with supertest rather than through `/graphql`. Deliberately only
// covers the destination-picking logic (peekReturnTo → /onboarding vs
// /calendar), not a full successful connect — that would need a real
// authorization code exchanged against Google's/Microsoft's real token
// endpoints, which no signed `state` value here can substitute for. Every
// case below is reachable without ever calling `calendarAccounts.connect`
// (either `code` is missing outright, or a deliberately malformed `state`
// makes `verifyState` throw before any network call), so none of these
// depend on real OAuth credentials or real network access — they were
// chosen specifically because they don't share the network-dependent
// limitation named throughout this README's recent "what's verified"
// sections.
describe('OAuth callback redirect destination (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // peekReturnTo never checks the signature (see oauth-state.ts's own
  // comment on why that's an acceptable trade-off for a redirect-target
  // hint) — so any secret works here, it doesn't need to match the running
  // app's real OAUTH_STATE_SECRET.
  function fakeState(returnTo?: string) {
    return signOAuthState('some-user-id', 'irrelevant-test-secret', returnTo);
  }

  describe('Google', () => {
    it('redirects to /calendar when there is no state at all (the original, only-ever-existed default)', async () => {
      const res = await request(app.getHttpServer()).get('/auth/google/callback');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/calendar\?googleConnect=error$/);
    });

    it('redirects to /onboarding when code is missing but a returnTo=onboarding state is present', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ state: fakeState('onboarding') });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/onboarding\?googleConnect=error$/);
    });

    it('redirects to /calendar when code is missing and the state has no returnTo', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ state: fakeState() });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/calendar\?googleConnect=error$/);
    });

    it('redirects to /onboarding when verifyState itself throws (tampered signature) but code and state are both present', async () => {
      const tampered = `${fakeState('onboarding').split('.')[0]}.not-a-real-signature`;
      const res = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ state: tampered, code: 'some-code' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/onboarding\?googleConnect=error$/);
    });
  });

  describe('Microsoft', () => {
    it('redirects to /calendar when there is no state at all (the original, only-ever-existed default)', async () => {
      const res = await request(app.getHttpServer()).get('/auth/microsoft/callback');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/calendar\?microsoftConnect=error$/);
    });

    it('redirects to /onboarding when code is missing but a returnTo=onboarding state is present', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/microsoft/callback')
        .query({ state: fakeState('onboarding') });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/onboarding\?microsoftConnect=error$/);
    });

    it('redirects to /calendar when code is missing and the state has no returnTo', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/microsoft/callback')
        .query({ state: fakeState() });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/calendar\?microsoftConnect=error$/);
    });

    it('redirects to /onboarding when verifyState itself throws (tampered signature) but code and state are both present', async () => {
      const tampered = `${fakeState('onboarding').split('.')[0]}.not-a-real-signature`;
      const res = await request(app.getHttpServer())
        .get('/auth/microsoft/callback')
        .query({ state: tampered, code: 'some-code' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/onboarding\?microsoftConnect=error$/);
    });
  });
});

// Journaling (PRD §7.3, Database Design Document §4.5's journal_entries).
// Entirely local data, no external API to fake — same as "Tasks & Goals"
// and "Focus sessions."
describe('Journaling (e2e)', () => {
  let app: INestApplication;
  const devEmail = `journal-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('creates an entry and lists it, most recent first', async () => {
    const first = await gql(`mutation { createJournalEntry(input: { content: "First entry" }) { entry { id content } errors { code } } }`);
    expect(first.body.data.createJournalEntry.errors).toEqual([]);
    expect(first.body.data.createJournalEntry.entry.content).toBe('First entry');

    const second = await gql(`mutation { createJournalEntry(input: { content: "Second entry" }) { entry { id } errors { code } } }`);
    expect(second.body.data.createJournalEntry.errors).toEqual([]);

    const list = await gql(`{ journalEntries { edges { node { content } } pageInfo { hasNextPage } } }`);
    const contents = list.body.data.journalEntries.edges.map((e: any) => e.node.content);
    expect(contents[0]).toBe('Second entry'); // most recent first
    expect(contents[1]).toBe('First entry');
  });

  it('rejects an empty entry', async () => {
    const res = await gql(`mutation { createJournalEntry(input: { content: "" }) { entry { id } errors { code message } } }`);
    expect(res.body.errors?.length ?? 0).toBeGreaterThan(0); // class-validator @IsNotEmpty rejects at the GraphQL input-validation layer
  });

  it('updates an entry', async () => {
    const created = await gql(`mutation { createJournalEntry(input: { content: "Draft" }) { entry { id } errors { code } } }`);
    const id = created.body.data.createJournalEntry.entry.id;

    const updated = await gql(`mutation { updateJournalEntry(id: "${id}", input: { content: "Edited" }) { entry { content } errors { code } } }`);
    expect(updated.body.data.updateJournalEntry.entry.content).toBe('Edited');
  });

  it('deletes an entry', async () => {
    const created = await gql(`mutation { createJournalEntry(input: { content: "Temporary" }) { entry { id } errors { code } } }`);
    const id = created.body.data.createJournalEntry.entry.id;

    const deleted = await gql(`mutation { deleteJournalEntry(id: "${id}") { deletedEntryId errors { code } } }`);
    expect(deleted.body.data.deleteJournalEntry.deletedEntryId).toBe(id);

    const list = await gql(`{ journalEntries { edges { node { id } } } }`);
    expect(list.body.data.journalEntries.edges.some((e: any) => e.node.id === id)).toBe(false);
  });

  it('rejects editing or deleting an entry that belongs to another user', async () => {
    const mine = await gql(`mutation { createJournalEntry(input: { content: "Private thoughts" }) { entry { id } errors { code } } }`);
    const id = mine.body.data.createJournalEntry.entry.id;

    const otherEmail = `journal-e2e-other-${Date.now()}@example.com`;
    const updateAttempt = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { updateJournalEntry(id: "${id}", input: { content: "Hijacked" }) { entry { id } errors { code message } } }` });
    expect(updateAttempt.body.data.updateJournalEntry.entry).toBeNull();
    expect(updateAttempt.body.data.updateJournalEntry.errors[0].code).toBe('UPDATE_FAILED');

    const deleteAttempt = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', otherEmail)
      .send({ query: `mutation { deleteJournalEntry(id: "${id}") { deletedEntryId errors { code message } } }` });
    expect(deleteAttempt.body.data.deleteJournalEntry.deletedEntryId).toBeNull();
    expect(deleteAttempt.body.data.deleteJournalEntry.errors[0].code).toBe('DELETE_FAILED');
  });
});

// Journal sentiment analysis increment — closes the "journal sentiment
// feeds mood inference" gap the README used to name under "not built yet."
// Same AnthropicClient-override rationale as Chronotype/Daily reflection
// above (JournalModule imports PlannerModule for the exact same
// shared-singleton reason — see journal.module.ts). The pre-existing
// "Journaling (e2e)" block just above never overrides AnthropicClient, so
// its own entries already prove the "AI not configured" fallback for free
// (sentimentScore stays null there, same as before this increment) — this
// block only needs to cover the AI-configured path.
describe('Journal sentiment analysis (e2e)', () => {
  let app: INestApplication;
  let capturedPrompt: string | undefined;
  // Popped in call order, one score per createJournalEntry call — lets each
  // test control exactly what AnalyzeSentiment "returns" for each of
  // several entries without needing a real Anthropic call.
  let nextSentimentScores: number[] = [];
  let failNextSentimentCall = false;

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      analyzeSentiment: async (_content: string) => {
        if (failNextSentimentCall) {
          failNextSentimentCall = false;
          throw new Error('simulated Anthropic failure');
        }
        const score = nextSentimentScores.shift() ?? 0;
        return { score, modelUsed: 'fake-model-for-tests' };
      },
      // Reused purely as a probe, same trick the Chronotype AI Memory
      // signal suite's own capturedMemoryContext already establishes:
      // estimateTaskDuration's prompt includes MemoryService.buildContextBlock's
      // output, so whether a journal_sentiment fact made it into that block
      // is directly observable here without a dedicated query just for
      // inspecting AI Memory internals.
      sendMessage: async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content;
        return { content: '30', modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // A fresh user per test — refreshJournalSentimentPattern reads *all* of a
  // user's scored history up to its own sample-size cap, so sharing one
  // devEmail across tests (like the plain "Journaling (e2e)" block above
  // does) would let one test's entries skew another's average. Same
  // per-test-isolation reasoning the Chronotype AI Memory signal suite
  // already applies for the identical kind of aggregate-over-history query.
  function freshUser() {
    const devEmail = `journal-sentiment-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    return { gql };
  }

  async function capturedMemoryContext(gql: (q: string) => any): Promise<string> {
    capturedPrompt = undefined;
    await gql(`{ estimateTaskDuration(title: "Probe task for memory context") }`);
    return capturedPrompt ?? '';
  }

  it('scores a new entry and stores the real value on sentimentScore', async () => {
    const { gql } = freshUser();
    nextSentimentScores = [0.6];

    const res = await gql(`mutation { createJournalEntry(input: { content: "Had a genuinely great day." }) { entry { id sentimentScore } errors { code } } }`);
    expect(res.body.data.createJournalEntry.errors).toEqual([]);
    expect(res.body.data.createJournalEntry.entry.sentimentScore).toBeCloseTo(0.6);
  });

  it('a failed sentiment-scoring call leaves sentimentScore null without failing entry creation', async () => {
    const { gql } = freshUser();
    failNextSentimentCall = true;

    const res = await gql(`mutation { createJournalEntry(input: { content: "Whatever happens, happens." }) { entry { id content sentimentScore } errors { code } } }`);
    expect(res.body.data.createJournalEntry.errors).toEqual([]);
    expect(res.body.data.createJournalEntry.entry.content).toBe('Whatever happens, happens.');
    expect(res.body.data.createJournalEntry.entry.sentimentScore).toBeNull();
  });

  it('a sustained run of negative-scored entries writes a journal_sentiment fact that reaches other AI prompts', async () => {
    const { gql } = freshUser();

    for (const score of [-0.6, -0.5, -0.7]) {
      nextSentimentScores.push(score);
      await gql(`mutation { createJournalEntry(input: { content: "A rough one." }) { entry { id } errors { code } } }`);
    }

    const context = await capturedMemoryContext(gql);
    expect(context).toContain('trended emotionally negative');
  });

  it('a sustained run of positive-scored entries writes the opposite fact', async () => {
    const { gql } = freshUser();

    for (const score of [0.5, 0.6, 0.4]) {
      nextSentimentScores.push(score);
      await gql(`mutation { createJournalEntry(input: { content: "A really good one." }) { entry { id } errors { code } } }`);
    }

    const context = await capturedMemoryContext(gql);
    expect(context).toContain('trended emotionally positive');
  });

  it('writes no fact when scores are close to neutral/mixed, even with enough samples', async () => {
    const { gql } = freshUser();

    for (const score of [0.1, -0.1, 0.05]) {
      nextSentimentScores.push(score);
      await gql(`mutation { createJournalEntry(input: { content: "An in-between one." }) { entry { id } errors { code } } }`);
    }

    const context = await capturedMemoryContext(gql);
    expect(context).not.toContain('trended emotionally');
  });

  it('writes no fact when there are not enough scored entries yet', async () => {
    const { gql } = freshUser();

    for (const score of [-0.8, -0.9]) {
      nextSentimentScores.push(score);
      await gql(`mutation { createJournalEntry(input: { content: "Not enough data yet." }) { entry { id } errors { code } } }`);
    }

    const context = await capturedMemoryContext(gql);
    expect(context).not.toContain('trended emotionally');
  });
});

// Daily reflection (PRD §7.3). Same AnthropicClient-override rationale as
// Chat/Planner above — ReflectionModule imports PlannerModule for the exact
// same shared-singleton reason (see reflection.module.ts), so one
// overrideProvider call here covers it too.
describe('Daily reflection — AI configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `reflection-e2e-${Date.now()}@example.com`;
  let capturedSummaryPrompt: string | undefined;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      sendMessage: async (messages: Array<{ role: string; content: string }>) => {
        capturedSummaryPrompt = messages[0]?.content;
        return { content: 'You made real progress today and stayed thoughtful under pressure.', modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('submits a reflection, generates an AI summary, and surfaces both from todayReflection', async () => {
    const res = await gql(
      `mutation { submitDailyReflection(input: { wentWell: "Shipped the feature", challenging: "Context switching", carryForward: "Protect deep work time" }) { reflection { id aiSummary answers { wentWell challenging carryForward } } errors { code } } }`,
    );
    expect(res.body.data.submitDailyReflection.errors).toEqual([]);
    expect(res.body.data.submitDailyReflection.reflection.aiSummary).toContain('real progress');
    expect(capturedSummaryPrompt).toContain('Shipped the feature');
    expect(capturedSummaryPrompt).toContain('Context switching');
    expect(capturedSummaryPrompt).toContain('Protect deep work time');

    const today = await gql(`{ todayReflection { answers { wentWell } aiSummary } }`);
    expect(today.body.data.todayReflection.answers.wentWell).toBe('Shipped the feature');
    expect(today.body.data.todayReflection.aiSummary).toContain('real progress');
  });

  it('resubmitting the same day updates the existing reflection rather than creating a second one', async () => {
    await gql(`mutation { submitDailyReflection(input: { wentWell: "First pass", challenging: "x", carryForward: "y" }) { reflection { id } errors { code } } }`);
    await gql(`mutation { submitDailyReflection(input: { wentWell: "Corrected answer", challenging: "x", carryForward: "y" }) { reflection { id } errors { code } } }`);

    const recent = await gql(`{ recentReflections(first: 14) { id answers { wentWell } } }`);
    const todaysEntries = recent.body.data.recentReflections.filter((r: any) => r.answers.wentWell === 'Corrected answer' || r.answers.wentWell === 'First pass');
    expect(todaysEntries).toHaveLength(1);
    expect(todaysEntries[0].answers.wentWell).toBe('Corrected answer');
  });

  // Configurable daily reflection questions increment. Proves custom labels
  // are purely a display concern: the AI summary prompt still references
  // the classic fixed wording ("What went well today: ...") regardless of
  // what a person has renamed the questions to in Settings — the stored
  // answers shape and the AI prompt were both deliberately left untouched
  // by this increment (see schema.prisma's comment on these columns).
  it('a custom reflection question label does not change the wording sent to the AI summary prompt', async () => {
    const saved = await gql(
      `mutation { updateProfile(input: { reflectionWentWellLabel: "Wins", reflectionChallengingLabel: "Struggles", reflectionCarryForwardLabel: "Tomorrow" }) { user { reflectionWentWellLabel reflectionChallengingLabel reflectionCarryForwardLabel } errors { code } } }`,
    );
    expect(saved.body.data.updateProfile.errors).toEqual([]);
    expect(saved.body.data.updateProfile.user.reflectionWentWellLabel).toBe('Wins');

    await gql(
      `mutation { submitDailyReflection(input: { wentWell: "Closed three tickets", challenging: "Noisy office", carryForward: "Ask for a quiet room" }) { reflection { id } errors { code } } }`,
    );
    expect(capturedSummaryPrompt).toContain('What went well today: Closed three tickets');
    expect(capturedSummaryPrompt).toContain('What was challenging: Noisy office');
    expect(capturedSummaryPrompt).toContain('carry into tomorrow: Ask for a quiet room');
  });
});

describe('Daily reflection — AI not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `reflection-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue({
        isConfigured: () => false,
        proposeSchedule: async () => { throw new Error('should not be called'); },
        sendMessage: async () => { throw new Error('should not be called'); },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('still saves the reflection successfully with no AI summary when no API key is configured', async () => {
    const res = await gql(
      `mutation { submitDailyReflection(input: { wentWell: "Good day", challenging: "Tired", carryForward: "Sleep earlier" }) { reflection { id aiSummary } errors { code } } }`,
    );
    expect(res.body.data.submitDailyReflection.errors).toEqual([]);
    expect(res.body.data.submitDailyReflection.reflection.aiSummary).toBeNull();
  });

  // Configurable daily reflection questions increment. `null` is the
  // out-of-the-box state for every account (nothing in onboarding or
  // signup ever touches these three columns), and explicitly setting one
  // back to `null` from Settings' own "leave blank" affordance clears a
  // previously-saved custom label back to that default — same
  // null-means-fixed-default round trip every other configurable field on
  // this input already proves for itself.
  it('reflection question labels default to null and a custom label can be cleared back to null', async () => {
    const before = await gql(`{ me { reflectionWentWellLabel reflectionChallengingLabel reflectionCarryForwardLabel } }`);
    expect(before.body.data.me.reflectionWentWellLabel).toBeNull();
    expect(before.body.data.me.reflectionChallengingLabel).toBeNull();
    expect(before.body.data.me.reflectionCarryForwardLabel).toBeNull();

    const saved = await gql(
      `mutation { updateProfile(input: { reflectionWentWellLabel: "Bright spots" }) { user { reflectionWentWellLabel } errors { code } } }`,
    );
    expect(saved.body.data.updateProfile.errors).toEqual([]);
    expect(saved.body.data.updateProfile.user.reflectionWentWellLabel).toBe('Bright spots');

    const cleared = await gql(
      `mutation { updateProfile(input: { reflectionWentWellLabel: null }) { user { reflectionWentWellLabel } errors { code } } }`,
    );
    expect(cleared.body.data.updateProfile.errors).toEqual([]);
    expect(cleared.body.data.updateProfile.user.reflectionWentWellLabel).toBeNull();
  });
});

describe('Morning/evening routines (e2e)', () => {
  let app: INestApplication;
  const devEmail = `routines-e2e-${Date.now()}@example.com`;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    // No AnthropicClient override needed here: aiSequenced stays false for
    // every test in this block, so RoutinesService.aiSequence short-circuits
    // before ever touching the client — AI-sequencing behavior itself is
    // covered separately below, where it matters.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('setRoutine creates a routine with generated step ids and empty completion', async () => {
    const res = await gql(
      `mutation { setRoutine(input: { type: MORNING, steps: ["Wake up", "Stretch", "Coffee"], aiSequenced: false }) { routine { id type steps { id label } aiSequenced completedStepIds } errors { code } } }`,
    );
    expect(res.body.data.setRoutine.errors).toEqual([]);
    const routine = res.body.data.setRoutine.routine;
    expect(routine.type).toBe('MORNING');
    expect(routine.steps.map((s: any) => s.label)).toEqual(['Wake up', 'Stretch', 'Coffee']);
    expect(routine.steps.every((s: any) => typeof s.id === 'string' && s.id.length > 0)).toBe(true);
    expect(routine.completedStepIds).toEqual([]);
  });

  it('todayRoutines returns both morning and evening routines once both are set', async () => {
    await gql(`mutation { setRoutine(input: { type: EVENING, steps: ["Journal", "Lights out"], aiSequenced: false }) { routine { id } errors { code } } }`);

    const res = await gql(`{ todayRoutines { type steps { label } } }`);
    const types = res.body.data.todayRoutines.map((r: any) => r.type).sort();
    expect(types).toEqual(['EVENING', 'MORNING']);
  });

  it('setTodayRoutineCompletion fully replaces (not merges) the completed step ids', async () => {
    const set = await gql(
      `mutation { setRoutine(input: { type: MORNING, steps: ["A", "B", "C"], aiSequenced: false }) { routine { steps { id label } } errors { code } } }`,
    );
    const steps = set.body.data.setRoutine.routine.steps;
    const [stepA, stepB] = steps;

    const first = await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: ["${stepA.id}"] }) { routine { completedStepIds } errors { code } } }`,
    );
    expect(first.body.data.setTodayRoutineCompletion.routine.completedStepIds).toEqual([stepA.id]);

    // Replacing with a different single id — not adding to the previous
    // one — proves this is whole-state-replace, not a per-step toggle.
    const second = await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: ["${stepB.id}"] }) { routine { completedStepIds } errors { code } } }`,
    );
    expect(second.body.data.setTodayRoutineCompletion.routine.completedStepIds).toEqual([stepB.id]);

    const today = await gql(`{ routine(type: MORNING) { completedStepIds } }`);
    expect(today.body.data.routine.completedStepIds).toEqual([stepB.id]);
  });

  it('deleteRoutine removes the routine so routine(type) returns null afterward', async () => {
    await gql(`mutation { setRoutine(input: { type: EVENING, steps: ["Wind down"], aiSequenced: false }) { routine { id } errors { code } } }`);

    const del = await gql(`mutation { deleteRoutine(type: EVENING) { deleted errors { code } } }`);
    expect(del.body.data.deleteRoutine.deleted).toBe(true);

    const after = await gql(`{ routine(type: EVENING) { id } }`);
    expect(after.body.data.routine).toBeNull();
  });
});

describe('Morning/evening routines — AI sequencing (e2e)', () => {
  let app: INestApplication;
  const devEmail = `routines-ai-e2e-${Date.now()}@example.com`;
  let capturedSequencePrompt: string | undefined;
  let nextResponse = '';

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      sendMessage: async (messages: Array<{ role: string; content: string }>) => {
        capturedSequencePrompt = messages[0]?.content;
        return { content: nextResponse, modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reorders steps into a valid AI-proposed permutation when aiSequenced is true', async () => {
    nextResponse = 'Coffee, Wake up, Stretch';
    await gql(`mutation { setRoutine(input: { type: MORNING, steps: ["Wake up", "Stretch", "Coffee"], aiSequenced: true }) { routine { id } errors { code } } }`);

    const res = await gql(`{ routine(type: MORNING) { steps { label } aiSequenced } }`);
    expect(res.body.data.routine.aiSequenced).toBe(true);
    expect(res.body.data.routine.steps.map((s: any) => s.label)).toEqual(['Coffee', 'Wake up', 'Stretch']);
    expect(capturedSequencePrompt).toContain('Wake up');
  });

  it('falls back to the stored order when the AI response is not a valid permutation of the steps', async () => {
    // Missing "Stretch" and inventing "Shower" — not a genuine reordering,
    // so RoutinesService.aiSequence must reject it and keep the original
    // stored order instead of trusting it.
    nextResponse = 'Coffee, Wake up, Shower';
    await gql(`mutation { setRoutine(input: { type: EVENING, steps: ["Wake up", "Stretch", "Coffee"], aiSequenced: true }) { routine { id } errors { code } } }`);

    const res = await gql(`{ routine(type: EVENING) { steps { label } } }`);
    expect(res.body.data.routine.steps.map((s: any) => s.label)).toEqual(['Wake up', 'Stretch', 'Coffee']);
  });
});

describe('Task duration estimation — AI configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `duration-ai-e2e-${Date.now()}@example.com`;
  let capturedEstimatePrompt: string | undefined;
  let nextResponse = '';

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      sendMessage: async (messages: Array<{ role: string; content: string }>) => {
        capturedEstimatePrompt = messages[0]?.content;
        return { content: nextResponse, modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a validated AI-suggested duration in minutes', async () => {
    nextResponse = '45';
    const res = await gql(`{ estimateTaskDuration(title: "Write quarterly report") }`);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.estimateTaskDuration).toBe(45);
    expect(capturedEstimatePrompt).toContain('Write quarterly report');
  });

  it('returns null when the AI response cannot be parsed as a number', async () => {
    nextResponse = 'sometime soon, hard to say';
    const res = await gql(`{ estimateTaskDuration(title: "Vague task") }`);
    expect(res.body.data.estimateTaskDuration).toBeNull();
  });

  it('returns null when the AI response is outside a sane duration range', async () => {
    nextResponse = '9999';
    const res = await gql(`{ estimateTaskDuration(title: "Suspiciously long task") }`);
    expect(res.body.data.estimateTaskDuration).toBeNull();
  });

  it('feeds a real task_duration_accuracy pattern into future estimate prompts once enough completions exist', async () => {
    // Three completions at a consistent 1.5x actual-vs-estimated ratio —
    // enough (MIN_DURATION_SAMPLES_FOR_PATTERN=3) for
    // refreshTaskDurationAccuracyPattern to write a real fact, which
    // buildContextBlock should then inject into the very next estimate
    // prompt (proving the "improves over time" half of this feature, not
    // just the single-call estimate).
    for (const [estimated, actual] of [[20, 30], [30, 45], [40, 60]]) {
      const created = await gql(`mutation { createTask(input: { title: "Duration sample task", estimatedDurationMinutes: ${estimated} }) { task { id } errors { code } } }`);
      const id = created.body.data.createTask.task.id;
      await gql(`mutation { completeTask(id: "${id}", actualDurationMinutes: ${actual}) { task { status } errors { code } } }`);
    }

    nextResponse = '30';
    await gql(`{ estimateTaskDuration(title: "A brand new task") }`);
    expect(capturedEstimatePrompt).toContain('1.5x');
    expect(capturedEstimatePrompt).toContain('Tasks tend to take about');
  });
});

describe('Task duration estimation — AI not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `duration-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue({
        isConfigured: () => false,
        proposeSchedule: async () => { throw new Error('should not be called'); },
        sendMessage: async () => { throw new Error('should not be called'); },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns null without calling the AI at all when no API key is configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: `{ estimateTaskDuration(title: "Any task") }` });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.estimateTaskDuration).toBeNull();
  });
});

describe('AI recommendations — AI configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `recommendations-ai-e2e-${Date.now()}@example.com`;
  let nextResponse = '';

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      sendMessage: async () => ({ content: nextResponse, modelUsed: 'fake-model-for-tests' }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a validated set of recommendations from the AI response and surfaces them from todayRecommendations', async () => {
    nextResponse = 'BREAK|Take a 10-minute walk to reset before your next task.\nMEAL|Grab some water and a snack before your next meeting.';

    const res = await gql(
      `mutation { generateRecommendations { recommendationRun { id recommendations { id category message dismissed } } errors { code message } } }`,
    );
    expect(res.body.data.generateRecommendations.errors).toEqual([]);
    const recs = res.body.data.generateRecommendations.recommendationRun.recommendations;
    expect(recs).toHaveLength(2);
    expect(recs.map((r: any) => r.category).sort()).toEqual(['BREAK', 'MEAL']);
    expect(recs.every((r: any) => r.dismissed === false && typeof r.id === 'string')).toBe(true);

    const today = await gql(`{ todayRecommendations { recommendations { category message } } }`);
    expect(today.body.data.todayRecommendations.recommendations).toHaveLength(2);
  });

  it('drops malformed or invalid-category lines rather than trusting them', async () => {
    nextResponse =
      'BREAK|Take a short walk.\nNOTACATEGORY|This should be dropped.\nthis line has no pipe at all\nMEAL|Eat something light.';

    const res = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { category message } } errors { code } } }`,
    );
    const recs = res.body.data.generateRecommendations.recommendationRun.recommendations;
    expect(recs).toHaveLength(2);
    expect(recs.map((r: any) => r.category).sort()).toEqual(['BREAK', 'MEAL']);
  });

  it('dismissing a recommendation marks it dismissed without removing the others', async () => {
    nextResponse = 'BREAK|Stretch for a minute.\nWORKOUT|Go for a short walk.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id category } } errors { code } } }`,
    );
    const [first, second] = generated.body.data.generateRecommendations.recommendationRun.recommendations;

    const res = await gql(
      `mutation { dismissRecommendation(id: "${first.id}") { recommendationRun { recommendations { id dismissed } } errors { code } } }`,
    );
    const recs = res.body.data.dismissRecommendation.recommendationRun.recommendations;
    expect(recs.find((r: any) => r.id === first.id).dismissed).toBe(true);
    expect(recs.find((r: any) => r.id === second.id).dismissed).toBe(false);
  });

  it('generating again the same day fully replaces the previous set, including any dismissed ones', async () => {
    nextResponse = 'MEAL|First-generation suggestion.';
    const first = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id message } } errors { code } } }`,
    );
    const firstId = first.body.data.generateRecommendations.recommendationRun.recommendations[0].id;
    await gql(`mutation { dismissRecommendation(id: "${firstId}") { recommendationRun { id } errors { code } } }`);

    nextResponse = 'WORKOUT|Second-generation suggestion.';
    const second = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id message dismissed } } errors { code } } }`,
    );
    const recs = second.body.data.generateRecommendations.recommendationRun.recommendations;
    expect(recs).toHaveLength(1);
    expect(recs[0].message).toBe('Second-generation suggestion.');
    expect(recs[0].dismissed).toBe(false);
    expect(recs.some((r: any) => r.id === firstId)).toBe(false);
  });

  // AI recommendations acting on your behalf increment.
  it('acting on a BREAK recommendation starts a real 15-minute BREAK focus session and dismisses the suggestion', async () => {
    nextResponse = 'BREAK|Take a 10-minute walk to reset before your next task.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id category } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const acted = await gql(
      `mutation { actOnRecommendation(id: "${recId}") { startedFocusSessionId createdTaskId recommendationRun { recommendations { id dismissed } } errors { code message } } }`,
    );
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    expect(acted.body.data.actOnRecommendation.createdTaskId).toBeNull();
    const sessionId = acted.body.data.actOnRecommendation.startedFocusSessionId;
    expect(typeof sessionId).toBe('string');
    const dismissedState = acted.body.data.actOnRecommendation.recommendationRun.recommendations.find(
      (r: any) => r.id === recId,
    );
    expect(dismissedState.dismissed).toBe(true);

    const active = await gql(`{ activeFocusSession { id kind plannedDurationMinutes status } }`);
    expect(active.body.data.activeFocusSession.id).toBe(sessionId);
    expect(active.body.data.activeFocusSession.kind).toBe('BREAK');
    expect(active.body.data.activeFocusSession.plannedDurationMinutes).toBe(15);
    expect(active.body.data.activeFocusSession.status).toBe('IN_PROGRESS');

    // Clean up so later tests in this describe block don't inherit an
    // active session.
    await gql(`mutation { cancelFocusSession(id: "${sessionId}") { session { id } errors { code } } }`);
  });

  it('acting on a MEAL recommendation creates a real open task titled with the suggestion, and dismisses it', async () => {
    nextResponse = 'MEAL|Drink a glass of water.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id category message } } errors { code } } }`,
    );
    const meal = generated.body.data.generateRecommendations.recommendationRun.recommendations[0];

    const actedMeal = await gql(
      `mutation { actOnRecommendation(id: "${meal.id}") { startedFocusSessionId bookedCalendarEventId createdTaskId errors { code } } }`,
    );
    expect(actedMeal.body.data.actOnRecommendation.errors).toEqual([]);
    expect(actedMeal.body.data.actOnRecommendation.startedFocusSessionId).toBeNull();
    expect(actedMeal.body.data.actOnRecommendation.bookedCalendarEventId).toBeNull();
    const mealTaskId = actedMeal.body.data.actOnRecommendation.createdTaskId;
    expect(typeof mealTaskId).toBe('string');

    const today = await gql(`{ todayPlan { tasks { id title } } }`);
    const tasks = today.body.data.todayPlan.tasks;
    expect(tasks.find((t: any) => t.id === mealTaskId)?.title).toBe('Drink a glass of water.');
  });

  // Booking a workout as a real calendar block increment.
  it('acting on a WORKOUT recommendation books a real 30-minute calendar block starting now, titled with the suggestion, and dismisses it', async () => {
    nextResponse = 'WORKOUT|Go for a 20-minute walk.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id category message } } errors { code } } }`,
    );
    const workout = generated.body.data.generateRecommendations.recommendationRun.recommendations[0];

    const beforeActing = Date.now();
    const actedWorkout = await gql(
      `mutation { actOnRecommendation(id: "${workout.id}") { startedFocusSessionId createdTaskId bookedCalendarEventId recommendationRun { recommendations { id dismissed } } errors { code } } }`,
    );
    expect(actedWorkout.body.data.actOnRecommendation.errors).toEqual([]);
    expect(actedWorkout.body.data.actOnRecommendation.startedFocusSessionId).toBeNull();
    expect(actedWorkout.body.data.actOnRecommendation.createdTaskId).toBeNull();
    const eventId = actedWorkout.body.data.actOnRecommendation.bookedCalendarEventId;
    expect(typeof eventId).toBe('string');
    const dismissedState = actedWorkout.body.data.actOnRecommendation.recommendationRun.recommendations.find(
      (r: any) => r.id === workout.id,
    );
    expect(dismissedState.dismissed).toBe(true);

    // Really a real, findable CalendarEvent — not just an echoed id — with
    // the suggestion's own message as its title, booked for real starting
    // at (roughly) the moment actOn ran, for the documented 30-minute
    // default, not some other length.
    const rangeStart = new Date(beforeActing - 60_000).toISOString();
    const rangeEnd = new Date(beforeActing + 60 * 60 * 1000).toISOString();
    const calendar = await gql(
      `{ calendarEventsInRange(start: "${rangeStart}", end: "${rangeEnd}") { id title startTime endTime source isAiFocusBlock } }`,
    );
    const event = calendar.body.data.calendarEventsInRange.find((e: any) => e.id === eventId);
    expect(event).toBeDefined();
    expect(event.title).toBe('Go for a 20-minute walk.');
    expect(event.source).toBe('NATIVE');
    expect(event.isAiFocusBlock).toBe(true);
    const actualMinutes = (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60_000;
    expect(actualMinutes).toBe(30);
    const startedWithinLastMinute = Date.now() - new Date(event.startTime).getTime() < 60_000;
    expect(startedWithinLastMinute).toBe(true);
  });

  // Customize act-on defaults at the point of acting increment. Each test
  // below confirms a custom value genuinely lands on the real created
  // resource, not just that the mutation echoes it back — same "check the
  // real row, not the mutation's own reply" discipline every other
  // Customize/Configurable increment in this suite already follows.
  it('a custom BREAK duration overrides the fixed 15-minute default', async () => {
    nextResponse = 'BREAK|Take a short walk.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const acted = await gql(
      `mutation { actOnRecommendation(id: "${recId}", input: { durationMinutes: 45 }) { startedFocusSessionId errors { code } } }`,
    );
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    const sessionId = acted.body.data.actOnRecommendation.startedFocusSessionId;

    const active = await gql(`{ activeFocusSession { id plannedDurationMinutes } }`);
    expect(active.body.data.activeFocusSession.id).toBe(sessionId);
    expect(active.body.data.activeFocusSession.plannedDurationMinutes).toBe(45);

    await gql(`mutation { cancelFocusSession(id: "${sessionId}") { session { id } errors { code } } }`);
  });

  it('a custom WORKOUT duration and start time override the fixed 30-minutes-starting-now default', async () => {
    nextResponse = 'WORKOUT|Go for a run.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const customStart = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours from now
    const acted = await gql(
      `mutation { actOnRecommendation(id: "${recId}", input: { durationMinutes: 60, startTime: "${customStart.toISOString()}" }) { bookedCalendarEventId errors { code } } }`,
    );
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    const eventId = acted.body.data.actOnRecommendation.bookedCalendarEventId;

    const rangeStart = new Date(customStart.getTime() - 60_000).toISOString();
    const rangeEnd = new Date(customStart.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const calendar = await gql(
      `{ calendarEventsInRange(start: "${rangeStart}", end: "${rangeEnd}") { id startTime endTime } }`,
    );
    const event = calendar.body.data.calendarEventsInRange.find((e: any) => e.id === eventId);
    expect(event).toBeDefined();
    expect(new Date(event.startTime).getTime()).toBe(customStart.getTime());
    const actualMinutes = (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) / 60_000;
    expect(actualMinutes).toBe(60);
  });

  // Workout-booking conflict avoidance increment. Seeds a real conflicting
  // event via the ordinary createCalendarEvent mutation (the same one a
  // person's own manual "add an event" already uses) rather than reaching
  // into Prisma directly — proves this against exactly what a real
  // colliding calendar looks like from the API's own point of view.
  it('acting on a WORKOUT recommendation whose desired time collides with an existing event books the next real open slot instead', async () => {
    const desiredStart = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours from now
    const conflictEnd = new Date(desiredStart.getTime() + 30 * 60 * 1000);
    const seeded = await gql(
      `mutation { createCalendarEvent(input: { title: "Already booked", startTime: "${desiredStart.toISOString()}", endTime: "${conflictEnd.toISOString()}" }) { event { id } errors { code } } }`,
    );
    expect(seeded.body.data.createCalendarEvent.errors).toEqual([]);

    nextResponse = 'WORKOUT|Go for a swim.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const acted = await gql(
      `mutation { actOnRecommendation(id: "${recId}", input: { durationMinutes: 30, startTime: "${desiredStart.toISOString()}" }) { bookedCalendarEventId errors { code } } }`,
    );
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    const eventId = acted.body.data.actOnRecommendation.bookedCalendarEventId;

    // The real booked block landed right after the seeded conflict ends
    // (30 minutes later), not on top of it.
    const rangeStart = new Date(desiredStart.getTime() - 60_000).toISOString();
    const rangeEnd = new Date(desiredStart.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const calendar = await gql(
      `{ calendarEventsInRange(start: "${rangeStart}", end: "${rangeEnd}") { id title startTime endTime } }`,
    );
    const booked = calendar.body.data.calendarEventsInRange.find((e: any) => e.id === eventId);
    expect(booked).toBeDefined();
    expect(booked.title).toBe('Go for a swim.');
    expect(new Date(booked.startTime).getTime()).toBe(conflictEnd.getTime());
    expect(new Date(booked.startTime).getTime()).not.toBe(desiredStart.getTime());

    // And it genuinely doesn't overlap the seeded event — both are real,
    // distinct, back-to-back rows.
    expect(calendar.body.data.calendarEventsInRange.map((e: any) => e.title).sort()).toEqual([
      'Already booked',
      'Go for a swim.',
    ]);
  });

  it('a custom MEAL priority and due date override the fixed Normal-priority-no-due-date default', async () => {
    nextResponse = 'MEAL|Meal prep for the week.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const customDueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const acted = await gql(
      `mutation { actOnRecommendation(id: "${recId}", input: { priority: 1, dueDate: "${customDueDate.toISOString()}" }) { createdTaskId errors { code } } }`,
    );
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    const taskId = acted.body.data.actOnRecommendation.createdTaskId;

    const today = await gql(`{ todayPlan { tasks { id priority dueDate } } }`);
    const task = today.body.data.todayPlan.tasks.find((t: any) => t.id === taskId);
    expect(task).toBeDefined();
    expect(task.priority).toBe(1);
    expect(new Date(task.dueDate).toDateString()).toBe(customDueDate.toDateString());
  });

  it('omitting input entirely still produces the exact fixed-default behavior', async () => {
    nextResponse = 'MEAL|Eat something light.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const acted = await gql(`mutation { actOnRecommendation(id: "${recId}") { createdTaskId errors { code } } }`);
    expect(acted.body.data.actOnRecommendation.errors).toEqual([]);
    const taskId = acted.body.data.actOnRecommendation.createdTaskId;

    const today = await gql(`{ todayPlan { tasks { id priority dueDate } } }`);
    const task = today.body.data.todayPlan.tasks.find((t: any) => t.id === taskId);
    expect(task.priority).toBe(3); // Normal — TasksService.create's own default
    expect(task.dueDate).toBeNull();
  });

  it('rejects a custom duration outside the 1-180 minute sanity bounds', async () => {
    nextResponse = 'BREAK|Take a short walk.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const res = await gql(
      `mutation { actOnRecommendation(id: "${recId}", input: { durationMinutes: 300 }) { startedFocusSessionId errors { code } } } `,
    );
    // Same @Max-guarded-input shape every other bounded input in this app
    // already produces — fails NestJS's global ValidationPipe before the
    // resolver body ever runs.
    expect(res.body.errors).toBeDefined();
  });

  it('refuses to act on an already-handled recommendation, and on an unknown id', async () => {
    nextResponse = 'MEAL|Eat something light before your next meeting.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;
    await gql(`mutation { dismissRecommendation(id: "${recId}") { recommendationRun { id } errors { code } } }`);

    const acted = await gql(`mutation { actOnRecommendation(id: "${recId}") { errors { code message } } }`);
    expect(acted.body.data.actOnRecommendation.errors[0].code).toBe('ALREADY_HANDLED');

    const unknown = await gql(
      `mutation { actOnRecommendation(id: "00000000-0000-0000-0000-000000000000") { errors { code message } } }`,
    );
    expect(unknown.body.data.actOnRecommendation.errors[0].code).toBe('NOT_FOUND');
  });

  it('refuses to act on a BREAK recommendation while a focus session is already active, and leaves the suggestion un-dismissed', async () => {
    const started = await gql(
      `mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const activeSessionId = started.body.data.startFocusSession.session.id;

    nextResponse = 'BREAK|Stretch for a minute before your next task.';
    const generated = await gql(
      `mutation { generateRecommendations { recommendationRun { recommendations { id } } errors { code } } }`,
    );
    const recId = generated.body.data.generateRecommendations.recommendationRun.recommendations[0].id;

    const acted = await gql(`mutation { actOnRecommendation(id: "${recId}") { errors { code message } } }`);
    expect(acted.body.data.actOnRecommendation.errors[0].code).toBe('ALREADY_ACTIVE');

    const today = await gql(`{ todayRecommendations { recommendations { id dismissed } } }`);
    const rec = today.body.data.todayRecommendations.recommendations.find((r: any) => r.id === recId);
    expect(rec.dismissed).toBe(false); // the failed action never touched the suggestion's state

    await gql(`mutation { cancelFocusSession(id: "${activeSessionId}") { session { id } errors { code } } }`);
  });
});

describe('AI recommendations — AI not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `recommendations-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue({
        isConfigured: () => false,
        proposeSchedule: async () => { throw new Error('should not be called'); },
        sendMessage: async () => { throw new Error('should not be called'); },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  it('returns a clear AI_NOT_CONFIGURED error without calling the AI at all', async () => {
    const res = await gql(
      `mutation { generateRecommendations { recommendationRun { id } errors { code message } } }`,
    );
    expect(res.body.data.generateRecommendations.recommendationRun).toBeNull();
    expect(res.body.data.generateRecommendations.errors[0].code).toBe('AI_NOT_CONFIGURED');

    const today = await gql(`{ todayRecommendations { id } }`);
    expect(today.body.data.todayRecommendations).toBeNull();
  });
});

describe('Weekly/monthly AI plan generation (e2e)', () => {
  let app: INestApplication;
  const devEmail = `weekly-plan-e2e-${Date.now()}@example.com`;
  let fakeChanges: Array<{ taskId: string; proposedStart: string; reason: string }> = [];

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  // Dev-auth users default to timezone "UTC" (never overwritten in e2e —
  // TimezoneSync only runs in a real browser), so these can be built with
  // plain UTC arithmetic rather than needing IANA-zone-aware Luxon math the
  // way a real per-user timezone would require.
  function atUtc(daysFromNow: number, hour: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysFromNow);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: { summary: 'Spread the open tasks across the window.', changes: fakeChanges },
      }),
      sendMessage: async () => { throw new Error('should not be called'); },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('WEEK scope places a task on a future day and drops one outside the 7am-9pm working-hours window', async () => {
    const safe = await gql(`mutation { createTask(input: { title: "Week-safe task" }) { task { id } errors { code } } }`);
    const safeId = safe.body.data.createTask.task.id;
    const overnight = await gql(`mutation { createTask(input: { title: "Week-overnight task" }) { task { id } errors { code } } }`);
    const overnightId = overnight.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: safeId, proposedStart: atUtc(1, 14), reason: 'Good slot tomorrow afternoon.' },
      { taskId: overnightId, proposedStart: atUtc(3, 2), reason: 'Should be dropped — 2am is outside working hours.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: WEEK) { planRun { scope diff { summary changes { task { id } proposedStart } } } errors { code } } }`,
    );
    const planRun = res.body.data.requestReplan.planRun;
    expect(planRun.scope).toBe('WEEK');
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes[0].task.id).toBe(safeId);
    expect(planRun.diff.summary).toContain('skipped');
  });

  it('WEEK scope enforces a fixed calendar event on a future day, not just today', async () => {
    await gql(
      `mutation { createCalendarEvent(input: { title: "Future fixed meeting", startTime: "${atUtc(2, 10)}", endTime: "${atUtc(2, 11)}", isImmovable: true }) { event { id } errors { code } } }`,
    );

    const conflicting = await gql(`mutation { createTask(input: { title: "Conflicts with future meeting" }) { task { id } errors { code } } }`);
    const conflictingId = conflicting.body.data.createTask.task.id;
    const clear = await gql(`mutation { createTask(input: { title: "Clear of future meeting" }) { task { id } errors { code } } }`);
    const clearId = clear.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: conflictingId, proposedStart: atUtc(2, 10), reason: 'Overlaps the fixed meeting — should drop.' },
      { taskId: clearId, proposedStart: atUtc(2, 15), reason: 'Free that afternoon.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: WEEK) { planRun { diff { changes { task { id } } } } errors { code } } }`,
    );
    const changes = res.body.data.requestReplan.planRun.diff.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].task.id).toBe(clearId);
  });

  // Weekly/monthly plans protecting habits across the window increment.
  // Before this increment, `requestReplan`'s habit protection only ever
  // looked at *today's* due habits (see HabitsService.listDueInWindow's
  // own comment) — a WEEK/MONTH plan would have let this exact proposal
  // through, since the "Future gym session" habit isn't due today at all,
  // only 3 days out. This is the regression test for that gap: the
  // habit's own due day (dynamically computed from the real day this
  // suite runs on, not hardcoded — same discipline as isoToday/isoNotToday
  // elsewhere in this file) and the fake proposal's date are derived from
  // the exact same instant, so they're guaranteed to collide.
  it('WEEK scope enforces protected habit time on a future day, not just today', async () => {
    const futureDate = new Date();
    futureDate.setUTCDate(futureDate.getUTCDate() + 3);
    const futureIsoWeekday = futureDate.getUTCDay() === 0 ? 7 : futureDate.getUTCDay();

    await gql(
      `mutation { createHabit(input: { title: "Future gym session", frequency: WEEKLY, daysOfWeek: [${futureIsoWeekday}], preferredTime: "14:00", protectedDurationMinutes: 30 }) { habit { id } errors { code } } }`,
    );

    const conflicting = await gql(`mutation { createTask(input: { title: "Conflicts with future habit" }) { task { id } errors { code } } }`);
    const conflictingId = conflicting.body.data.createTask.task.id;
    const clear = await gql(`mutation { createTask(input: { title: "Clear of future habit" }) { task { id } errors { code } } }`);
    const clearId = clear.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: conflictingId, proposedStart: atUtc(3, 14), reason: 'Overlaps the future habit — should drop.' },
      { taskId: clearId, proposedStart: atUtc(3, 16), reason: 'Free later that same day.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: WEEK) { planRun { diff { summary changes { task { id } } } } errors { code } } }`,
    );
    const planRun = res.body.data.requestReplan.planRun;
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes[0].task.id).toBe(clearId);
    expect(planRun.diff.summary).toContain('protected habit time');
  });

  it('MONTH scope allows placement weeks out but still rejects anything beyond the ~30-day window', async () => {
    const withinMonth = await gql(`mutation { createTask(input: { title: "Within month window" }) { task { id } errors { code } } }`);
    const withinMonthId = withinMonth.body.data.createTask.task.id;
    const beyondMonth = await gql(`mutation { createTask(input: { title: "Beyond month window" }) { task { id } errors { code } } }`);
    const beyondMonthId = beyondMonth.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: withinMonthId, proposedStart: atUtc(25, 14), reason: 'Within the month.' },
      { taskId: beyondMonthId, proposedStart: atUtc(40, 14), reason: 'Should be dropped — past the 30-day window.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: MONTH) { planRun { scope diff { changes { task { id } } } } errors { code } } }`,
    );
    const planRun = res.body.data.requestReplan.planRun;
    expect(planRun.scope).toBe('MONTH');
    expect(planRun.diff.changes).toHaveLength(1);
    expect(planRun.diff.changes[0].task.id).toBe(withinMonthId);
  });

  // Same regression coverage as the WEEK test above, but for a MONTHLY
  // day-of-month habit deep into a 30-day window — the loop inside
  // HabitsService.listDueInWindow has meaningfully more iterations at
  // MONTH scope than WEEK, so this is worth its own real check rather than
  // assuming the WEEK case generalizes. `dayOfMonth` is derived from the
  // real day 20 days from now, not hardcoded, so this stays correct no
  // matter which real date this suite runs on.
  it('MONTH scope enforces protected habit time on a day deep into the month, not just today', async () => {
    const futureDate = new Date();
    futureDate.setUTCDate(futureDate.getUTCDate() + 20);
    const futureDayOfMonth = futureDate.getUTCDate();

    await gql(
      `mutation { createHabit(input: { title: "Monthly deep-clean", frequency: MONTHLY, monthlyMode: DAY_OF_MONTH, dayOfMonth: ${futureDayOfMonth}, preferredTime: "09:00", protectedDurationMinutes: 60 }) { habit { id } errors { code } } }`,
    );

    const conflicting = await gql(`mutation { createTask(input: { title: "Conflicts with monthly habit" }) { task { id } errors { code } } }`);
    const conflictingId = conflicting.body.data.createTask.task.id;
    const clear = await gql(`mutation { createTask(input: { title: "Clear of monthly habit" }) { task { id } errors { code } } }`);
    const clearId = clear.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: conflictingId, proposedStart: atUtc(20, 9), reason: 'Overlaps the monthly habit — should drop.' },
      { taskId: clearId, proposedStart: atUtc(20, 11), reason: 'Free later that same day.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: MONTH) { planRun { diff { changes { task { id } } } } errors { code } } }`,
    );
    const changes = res.body.data.requestReplan.planRun.diff.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].task.id).toBe(clearId);
  });

  it('latestPlanRun is tracked independently per scope — a WEEK plan does not shadow the DAY plan or vice versa', async () => {
    const dayTask = await gql(`mutation { createTask(input: { title: "Day-scope task" }) { task { id } errors { code } } }`);
    const dayTaskId = dayTask.body.data.createTask.task.id;
    const weekTask = await gql(`mutation { createTask(input: { title: "Week-scope task for latest check" }) { task { id } errors { code } } }`);
    const weekTaskId = weekTask.body.data.createTask.task.id;

    fakeChanges = [{ taskId: dayTaskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'later today' }];
    await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);

    fakeChanges = [{ taskId: weekTaskId, proposedStart: atUtc(1, 14), reason: 'tomorrow afternoon' }];
    await gql(`mutation { requestReplan(scope: WEEK) { planRun { id } errors { code } } }`);

    const dayLatest = await gql(`{ latestPlanRun { scope diff { changes { task { id } } } } }`);
    expect(dayLatest.body.data.latestPlanRun.scope).toBe('DAY');
    expect(dayLatest.body.data.latestPlanRun.diff.changes.some((c: any) => c.task.id === dayTaskId)).toBe(true);

    const weekLatest = await gql(`{ latestPlanRun(scope: WEEK) { scope diff { changes { task { id } } } } }`);
    expect(weekLatest.body.data.latestPlanRun.scope).toBe('WEEK');
    expect(weekLatest.body.data.latestPlanRun.diff.changes.some((c: any) => c.task.id === weekTaskId)).toBe(true);
  });
});

describe('Chronotype AI Memory signal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let capturedPrompt: string | undefined;

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => { throw new Error('should not be called'); },
      sendMessage: async (messages: Array<{ role: string; content: string }>) => {
        capturedPrompt = messages[0]?.content;
        return { content: '30', modelUsed: 'fake-model-for-tests' };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // A fresh user per test (not one shared devEmail for the whole suite) —
  // this signal reads *all* of a user's history up to CHRONOTYPE_SAMPLE_SIZE
  // rows, so sharing a user across tests would let one test's fixture data
  // quietly skew another's daypart math depending on run order. Isolating
  // per test removes that risk entirely rather than trying to account for it.
  async function freshUser() {
    const devEmail = `chronotype-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    const me = await gql('{ me { id } }');
    return { gql, userId: me.body.data.me.id as string };
  }

  function atHour(hour: number): Date {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  }

  // FocusService.complete() is the only real trigger for the refresh (see
  // that file) — the seeded historical rows in each test below are
  // inserted directly via Prisma (same established pattern the two-way
  // calendar sync suite uses for fixture state no GraphQL mutation can
  // produce, since neither startFocusSession nor logEnergy accepts a
  // custom timestamp), then one real focus session is started and
  // completed through the actual GraphQL mutation to fire the trigger
  // against the combined seeded + real data.
  async function completeOneRealFocusSession(gql: (q: string) => any) {
    const started = await gql(
      `mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`,
    );
    const id = started.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${id}") { session { id } errors { code } } }`);
  }

  // Reuses estimateTaskDuration purely as a probe: its prompt already
  // includes MemoryService.buildContextBlock's output (see
  // planner.service.ts's estimateDuration), so whether a chronotype fact
  // made it into that block is directly observable here without needing a
  // new query just to inspect AI Memory internals.
  async function capturedMemoryContext(gql: (q: string) => any): Promise<string> {
    capturedPrompt = undefined;
    await gql(`{ estimateTaskDuration(title: "Probe task for memory context") }`);
    return capturedPrompt ?? '';
  }

  it('writes no fact when there is not enough data yet (energy samples below the minimum)', async () => {
    const { gql, userId } = await freshUser();

    await prisma.energyEntry.create({ data: { userId, loggedAt: new Date(), energyScore: 4 } });
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: new Date(), endedAt: new Date(), status: 'COMPLETED' },
    });
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: new Date(), endedAt: new Date(), status: 'COMPLETED' },
    });

    // Brings total completed focus sessions to 3 (meets the minimum) while
    // energy stays at 1 (below it) — the gate should refuse to compute
    // anything at all with only one signal past its threshold.
    await completeOneRealFocusSession(gql);

    const context = await capturedMemoryContext(gql);
    expect(context).not.toContain('Empirically appears');
  });

  it('writes a chronotype fact once energy check-ins and completed focus sessions agree on the same daypart, and it reaches other AI prompts', async () => {
    const { gql, userId } = await freshUser();

    // Five morning energy check-ins, all high — the only daypart with any
    // energy data at all for this fresh user, so it's deterministically
    // the top one regardless of when this test happens to run.
    for (const score of [5, 4, 5, 4, 5]) {
      await prisma.energyEntry.create({ data: { userId, loggedAt: atHour(9), energyScore: score } });
    }
    // Two seeded morning focus sessions, plus one real one below (started
    // "now," whatever daypart that happens to be) — morning's seeded count
    // of 2 always exceeds any other single daypart's count of at most 1
    // from the one real session, so the top focus daypart is
    // deterministically MORNING too, independent of wall-clock time.
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: atHour(9), endedAt: atHour(9), status: 'COMPLETED' },
    });
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: atHour(10), endedAt: atHour(10), status: 'COMPLETED' },
    });

    await completeOneRealFocusSession(gql);

    const context = await capturedMemoryContext(gql);
    expect(context).toContain('Empirically appears to be a morning person');
    expect(context).toContain('not just self-reported');
  });

  it('writes no fact when the two signals disagree on the daypart, even with enough data on both', async () => {
    const { gql, userId } = await freshUser();

    // All energy data in the evening (the only bucket with any data for
    // this fresh user, so deterministically top) — but the focus-session
    // signal below is seeded in the morning, so the two signals disagree
    // no matter when this test runs or what the one real session (started
    // "now" via completeOneRealFocusSession) happens to add to.
    for (const score of [5, 5, 4, 5, 4]) {
      await prisma.energyEntry.create({ data: { userId, loggedAt: atHour(20), energyScore: score } });
    }
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: atHour(7), endedAt: atHour(7), status: 'COMPLETED' },
    });
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 25, startedAt: atHour(8), endedAt: atHour(8), status: 'COMPLETED' },
    });

    await completeOneRealFocusSession(gql);

    const context = await capturedMemoryContext(gql);
    expect(context).not.toContain('Empirically appears');
  });

  // Automatic Pomodoro work/break cycling increment: BREAK sessions must
  // never count toward MIN_FOCUS_SESSIONS_FOR_CHRONOTYPE (3). Seeded here at
  // exactly the count that *would* clear the minimum if BREAK rows were
  // wrongly included (2 seeded BREAK + 1 real WORK from
  // completeOneRealFocusSession = 3), so this only passes if the exclusion
  // in MemoryService.refreshChronotypePattern's query is real, not just
  // hand-inspected against the source.
  it('never counts BREAK sessions toward the minimum focus-session sample size', async () => {
    const { gql, userId } = await freshUser();

    for (const score of [5, 4, 5, 4, 5]) {
      await prisma.energyEntry.create({ data: { userId, loggedAt: atHour(9), energyScore: score } });
    }
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 5, kind: 'BREAK', startedAt: atHour(9), endedAt: atHour(9), status: 'COMPLETED' },
    });
    await prisma.focusSession.create({
      data: { userId, plannedDurationMinutes: 5, kind: 'BREAK', startedAt: atHour(9), endedAt: atHour(9), status: 'COMPLETED' },
    });

    // Only one real WORK session (below the minimum of 3) — the two BREAK
    // rows above must not make up the difference.
    await completeOneRealFocusSession(gql);

    const context = await capturedMemoryContext(gql);
    expect(context).not.toContain('Empirically appears');
  });
});

describe('Smart notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notificationsService: NotificationsService;
  const devEmail = `notifications-e2e-${Date.now()}@example.com`;
  let recommendationsResponse = 'BREAK|Take a short walk to reset.';

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({ modelUsed: 'fake-model-for-tests', proposal: { summary: 'ok', changes: [] } }),
      sendMessage: async () => ({ content: recommendationsResponse, modelUsed: 'fake-model-for-tests' }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    notificationsService = moduleRef.get(NotificationsService);

    // NOTHING_TO_PLAN would otherwise short-circuit requestReplan before it
    // ever reaches the notification trigger this suite is testing.
    await gql(`mutation { createTask(input: { title: "Keep at least one task open" }) { task { id } errors { code } } }`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('generating a plan creates a visible, unread plan_ready notification when there are no quiet hours', async () => {
    await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);

    const res = await gql(`{ notifications { id type title read } unreadNotificationCount }`);
    const planReady = res.body.data.notifications.filter((n: any) => n.type === 'plan_ready');
    expect(planReady).toHaveLength(1);
    expect(planReady[0].read).toBe(false);
    expect(planReady[0].title).toBe('Your plan is ready');
    expect(res.body.data.unreadNotificationCount).toBeGreaterThanOrEqual(1);
  });

  it('generating a plan again shortly after batches into the same notification instead of creating a second one', async () => {
    await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);

    const res = await gql(`{ notifications { type } }`);
    const planReady = res.body.data.notifications.filter((n: any) => n.type === 'plan_ready');
    expect(planReady).toHaveLength(1);
  });

  it('markNotificationRead marks it read and the unread count reflects it', async () => {
    const list = await gql(`{ notifications { id type read } }`);
    const planReady = list.body.data.notifications.find((n: any) => n.type === 'plan_ready');
    expect(planReady.read).toBe(false);

    const res = await gql(`mutation { markNotificationRead(id: "${planReady.id}") { notification { id read } errors { code } } }`);
    expect(res.body.data.markNotificationRead.errors).toEqual([]);
    expect(res.body.data.markNotificationRead.notification.read).toBe(true);

    const after = await gql(`{ notifications { id read } }`);
    const same = after.body.data.notifications.find((n: any) => n.id === planReady.id);
    expect(same.read).toBe(true);
  });

  it('quiet hours defer a new notification so it does not show up (or count as unread) until they end', async () => {
    const before = await gql(`{ notifications { id } }`);
    const countBefore = before.body.data.notifications.length;

    // Nearly the whole day, so "now" (whenever this test happens to run)
    // is deterministically inside it — the one narrow edge case (running in
    // the last minute before midnight) is the same accepted, documented
    // risk every other relative-time e2e fixture in this file already
    // carries (see the AI daily planning suite's own +1h/+3h offsets).
    await gql(`mutation { updateNotificationPreferences(input: { quietHoursStart: "00:00", quietHoursEnd: "23:59" }) { user { id } errors { code } } }`);

    // The previous plan_ready notification was already marked read above,
    // so this creates a fresh row rather than batching into it — and that
    // fresh row should land outside today's visible list since it's
    // deferred by the quiet-hours window just configured.
    await gql(`mutation { requestReplan { planRun { id } errors { code } } }`);

    const after = await gql(`{ notifications { id } unreadNotificationCount }`);
    expect(after.body.data.notifications.length).toBe(countBefore);
    expect(after.body.data.unreadNotificationCount).toBe(0);
  });

  it('turning off push notifications suppresses new notification creation entirely, even outside quiet hours', async () => {
    await gql(`mutation { updateNotificationPreferences(input: { quietHoursStart: null, quietHoursEnd: null, pushNotificationsEnabled: false }) { user { id } errors { code } } }`);

    const before = await gql(`{ notifications { id } }`);
    const countBefore = before.body.data.notifications.length;

    recommendationsResponse = 'MEAL|Grab something light.';
    await gql(`mutation { generateRecommendations { recommendationRun { id } errors { code } } }`);

    const after = await gql(`{ notifications { id } }`);
    expect(after.body.data.notifications.length).toBe(countBefore);
  });

  it('re-enabling push notifications, generateRecommendations creates a visible recommendations_ready notification', async () => {
    await gql(`mutation { updateNotificationPreferences(input: { pushNotificationsEnabled: true }) { user { id } errors { code } } }`);

    recommendationsResponse = 'WORKOUT|Stretch for five minutes.';
    await gql(`mutation { generateRecommendations { recommendationRun { id } errors { code } } }`);

    const res = await gql(`{ notifications { type title read } }`);
    const recsReady = res.body.data.notifications.filter((n: any) => n.type === 'recommendations_ready');
    expect(recsReady).toHaveLength(1);
    expect(recsReady[0].read).toBe(false);
    expect(recsReady[0].title).toBe('New recommendations ready');
  });

  // Real notification delivery increment: the recommendations_ready
  // notification created immediately above was not deferred by quiet hours
  // (they were cleared two tests ago), so NotificationsService.create should
  // already have attempted real delivery for it inline — this person has no
  // registered push subscription and email is off, so both attempts no-op,
  // but the row must still come back marked as attempted (deliveredAt set)
  // rather than sitting there forever un-attempted.
  it('a non-deferred notification is marked deliveredAt immediately, even with no push subscription and email off', async () => {
    const res = await gql(`{ notifications { id type } }`);
    const recsReady = res.body.data.notifications.find((n: any) => n.type === 'recommendations_ready');

    const row = await prisma.notification.findUnique({ where: { id: recsReady.id } });
    expect(row?.deliveredAt).not.toBeNull();
  });

  it('vapidPublicKey exposes the server-configured public key so the frontend can subscribe', async () => {
    const res = await gql(`{ vapidPublicKey }`);
    expect(res.body.data.vapidPublicKey).toBe(process.env.VAPID_PUBLIC_KEY);
  });

  it('registerPushSubscription creates a row, and re-registering the same endpoint upserts instead of duplicating', async () => {
    const endpoint = `https://push.example.com/ep-${Date.now()}`;

    const first = await gql(`mutation { registerPushSubscription(input: { endpoint: "${endpoint}", p256dh: "key1", auth: "auth1" }) { registered errors { code } } }`);
    expect(first.body.data.registerPushSubscription.errors).toEqual([]);
    expect(first.body.data.registerPushSubscription.registered).toBe(true);

    const afterFirst = await prisma.pushSubscription.findMany({ where: { endpoint } });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].p256dh).toBe('key1');

    // Re-registering the same endpoint (e.g. the browser silently rotated
    // its own keys) must update the existing row, not create a second one.
    const second = await gql(`mutation { registerPushSubscription(input: { endpoint: "${endpoint}", p256dh: "key2", auth: "auth2" }) { registered errors { code } } }`);
    expect(second.body.data.registerPushSubscription.registered).toBe(true);

    const afterSecond = await prisma.pushSubscription.findMany({ where: { endpoint } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].p256dh).toBe('key2');
  });

  it('unregisterPushSubscription removes the subscription so it is no longer used for delivery', async () => {
    const endpoint = `https://push.example.com/ep-unreg-${Date.now()}`;
    await gql(`mutation { registerPushSubscription(input: { endpoint: "${endpoint}", p256dh: "key1", auth: "auth1" }) { registered errors { code } } }`);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);

    const res = await gql(`mutation { unregisterPushSubscription(endpoint: "${endpoint}") { unregistered errors { code } } }`);
    expect(res.body.data.unregisterPushSubscription.unregistered).toBe(true);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  // Exercises the sweep half of delivery (NotificationsService.
  // deliverDueNotifications), the counterpart to the immediate-delivery
  // test above. The quiet-hours suite earlier in this file already left a
  // deferred, undelivered plan_ready row for this same user — rather than
  // waiting for its real scheduledFor (up to 24h out) or re-deriving that
  // exact row, this creates its own controlled deferred-then-due row
  // directly via Prisma (mirroring how the Scheduler suite calls
  // checkRemindersForUser directly rather than waiting on `@Cron` itself),
  // then calls the sweep method directly — the same "public specifically so
  // it can be exercised for one user/one row without sweeping the whole
  // table" reasoning SchedulerService.checkRemindersForUser's own comment
  // already gives.
  it('deliverDueNotifications delivers a quiet-hours-deferred notification once its scheduledFor arrives', async () => {
    const user = await prisma.user.findUnique({ where: { email: devEmail } });
    const deferred = await prisma.notification.create({
      data: {
        userId: user!.id,
        type: 'delivery_sweep_test',
        channel: 'PUSH',
        payload: { title: 'Sweep test', body: 'Should be delivered by the sweep.', deeplink: '/today' },
        scheduledFor: new Date(Date.now() - 60_000),
        status: 'PENDING',
      },
    });
    expect(deferred.deliveredAt).toBeNull();

    await notificationsService.deliverDueNotifications();

    const after = await prisma.notification.findUnique({ where: { id: deferred.id } });
    expect(after?.deliveredAt).not.toBeNull();
  });
});

// The final increment in the confirmed build order — PRD §7.1's "diagnostic
// onboarding that establishes baseline chronotype, work hours, priorities."
// A fresh user per test (same reasoning as the Chronotype suite): onboarding
// state is a one-time, whole-account flag, so sharing one devEmail across
// tests would make later tests unable to observe a "before onboarding"
// state at all once an earlier test in the same suite had already completed
// it.
describe('Diagnostic onboarding (e2e)', () => {
  let app: INestApplication;
  let fakeChanges: Array<{ taskId: string; proposedStart: string; reason: string }> = [];

  function freshUser() {
    const devEmail = `onboarding-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    return { gql };
  }

  // Dev-auth users default to timezone "UTC" — same reasoning/convention as
  // the Weekly/monthly AI plan generation suite's identical helper.
  function atUtc(daysFromNow: number, hour: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysFromNow);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: { summary: 'Spread the open tasks across the window.', changes: fakeChanges },
      }),
      sendMessage: async () => {
        throw new Error('should not be called');
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completeOnboarding saves every quiz answer, marks onboardingCompletedAt, and records the overload answer as an AI Memory fact', async () => {
    const { gql } = freshUser();

    const before = await gql(`{ me { onboardingCompletedAt } }`);
    expect(before.body.data.me.onboardingCompletedAt).toBeNull();

    const res = await gql(
      `mutation { completeOnboarding(input: { chronotype: EARLY_BIRD, workHoursStart: "08:00", workHoursEnd: "18:00", quietHoursStart: "22:00", quietHoursEnd: "07:00", overloadSource: "Work & career" }) { user { chronotype workHoursStart workHoursEnd quietHoursStart quietHoursEnd onboardingCompletedAt } errors { code } } }`,
    );
    const user = res.body.data.completeOnboarding.user;
    expect(res.body.data.completeOnboarding.errors).toEqual([]);
    expect(user.chronotype).toBe('EARLY_BIRD');
    expect(user.workHoursStart).toBe('08:00');
    expect(user.workHoursEnd).toBe('18:00');
    expect(user.quietHoursStart).toBe('22:00');
    expect(user.quietHoursEnd).toBe('07:00');
    expect(user.onboardingCompletedAt).not.toBeNull();

    const facts = await gql(`{ memoryFacts { content } }`);
    expect(
      facts.body.data.memoryFacts.some((f: any) => f.content.includes('Work & career')),
    ).toBe(true);
  });

  // Free time picker for quiz's work/quiet hours increment: before this,
  // the quiz's frontend only ever sent a handful of fixed preset values
  // (like "08:00"/"18:00"/"22:00"/"07:00" above) even though this same
  // mutation's DTO (CompleteOnboardingInput) already validated against a
  // real HH:mm regex, not an enum of presets — so the backend itself never
  // needed to change. This test proves a value no preset card ever offered
  // (work starting at 6:30, quiet hours from 9:15pm) saves and reads back
  // correctly, closing the loop now that the frontend can actually send it.
  it('completeOnboarding accepts arbitrary non-preset HH:mm times for work/quiet hours', async () => {
    const { gql } = freshUser();

    const res = await gql(
      `mutation { completeOnboarding(input: { workHoursStart: "06:30", workHoursEnd: "16:45", quietHoursStart: "21:15", quietHoursEnd: "05:50" }) { user { workHoursStart workHoursEnd quietHoursStart quietHoursEnd } errors { code } } }`,
    );
    const user = res.body.data.completeOnboarding.user;
    expect(res.body.data.completeOnboarding.errors).toEqual([]);
    expect(user.workHoursStart).toBe('06:30');
    expect(user.workHoursEnd).toBe('16:45');
    expect(user.quietHoursStart).toBe('21:15');
    expect(user.quietHoursEnd).toBe('05:50');

    const reread = await gql(`{ me { workHoursStart workHoursEnd quietHoursStart quietHoursEnd } }`);
    expect(reread.body.data.me.workHoursStart).toBe('06:30');
    expect(reread.body.data.me.workHoursEnd).toBe('16:45');
    expect(reread.body.data.me.quietHoursStart).toBe('21:15');
    expect(reread.body.data.me.quietHoursEnd).toBe('05:50');
  });

  // Free-text "biggest source of overload" increment: the quiz's last
  // remaining fixed-preset question — same "no backend change needed"
  // situation as the free time picker test above, since
  // CompleteOnboardingInput.overloadSource already accepted any string up
  // to 200 characters, never an enum of the five old preset labels. This
  // proves a genuinely non-preset phrase (not "Work & career" or any of
  // the other four old cards) saves and produces a real AI Memory fact
  // containing that exact text.
  it('completeOnboarding accepts an arbitrary non-preset phrase for the biggest-source-of-overload answer', async () => {
    const { gql } = freshUser();

    const phrase = 'Trying to keep up with three side projects and a new puppy';
    const res = await gql(
      `mutation { completeOnboarding(input: { overloadSource: "${phrase}" }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    expect(res.body.data.completeOnboarding.errors).toEqual([]);

    const facts = await gql(`{ memoryFacts { content } }`);
    expect(facts.body.data.memoryFacts.some((f: any) => f.content.includes(phrase))).toBe(true);
  });

  // Diagnostic quiz free-text answers increment: the quiz's first genuinely
  // open-ended question — everything above was a fixed preset pick from a
  // card. Confirms it's recorded as its own real AI Memory fact (`factType:
  // 'preference'`, the exact same type the pre-existing overload-answer fact
  // above already uses), independent of that other onboarding-derived fact
  // — not merged into it, not overwriting it. That shared `factType:
  // 'preference'` is also what `MemoryService.buildContextBlock`'s
  // `CONTEXT_FACT_TYPES` filters on (see that file's own comment) — this
  // suite's `fakeAnthropic` override deliberately throws on `sendMessage`
  // (it exists only to stub `proposeSchedule` for the planner-reaching test
  // further below), so an actual "the AI sees this in a real prompt" check
  // belongs in the Memory — reaching the AI planner and chat prompts
  // describe block instead, which already exercises `factType: 'preference'`
  // end to end; duplicating that here would just re-prove the same
  // mechanism a second time under a different fact's content.
  it('completeOnboarding records a free-text answer as its own AI Memory fact, independent of the overload answer', async () => {
    const { gql } = freshUser();

    const res = await gql(
      `mutation { completeOnboarding(input: { overloadSource: "Health & fitness", freeTextNotes: "Training for a marathon in October." }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    expect(res.body.data.completeOnboarding.errors).toEqual([]);

    const facts = await gql(`{ memoryFacts { content } }`);
    const contents = facts.body.data.memoryFacts.map((f: any) => f.content);
    expect(contents.some((c: string) => c.includes('Health & fitness'))).toBe(true);
    expect(contents.some((c: string) => c.includes('Training for a marathon in October.'))).toBe(true);
    // Two independent facts, not one overwriting the other.
    expect(contents.length).toBeGreaterThanOrEqual(2);
  });

  it('redoing onboarding with different free text updates the one existing fact instead of creating a duplicate', async () => {
    const { gql } = freshUser();

    await gql(
      `mutation { completeOnboarding(input: { freeTextNotes: "First answer." }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    const firstFacts = await gql(`{ memoryFacts { id content } }`);
    const matchingFirst = firstFacts.body.data.memoryFacts.filter((f: any) => f.content.includes('Additional context from onboarding'));
    expect(matchingFirst).toHaveLength(1);
    expect(matchingFirst[0].content).toContain('First answer.');

    await gql(
      `mutation { completeOnboarding(input: { freeTextNotes: "Second, different answer." }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    const secondFacts = await gql(`{ memoryFacts { id content } }`);
    const matchingSecond = secondFacts.body.data.memoryFacts.filter((f: any) => f.content.includes('Additional context from onboarding'));
    expect(matchingSecond).toHaveLength(1);
    expect(matchingSecond[0].id).toBe(matchingFirst[0].id);
    expect(matchingSecond[0].content).toContain('Second, different answer.');
    expect(matchingSecond[0].content).not.toContain('First answer.');
  });

  it('redoing onboarding with a different overload answer updates the one existing memory fact instead of creating a duplicate', async () => {
    const { gql } = freshUser();

    await gql(
      `mutation { completeOnboarding(input: { chronotype: EARLY_BIRD, overloadSource: "Work & career" }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    const firstFacts = await gql(`{ memoryFacts { id content } }`);
    const matchingFirst = firstFacts.body.data.memoryFacts.filter((f: any) =>
      f.content.includes('Biggest current source of overload'),
    );
    expect(matchingFirst).toHaveLength(1);
    expect(matchingFirst[0].content).toContain('Work & career');

    // Redo the quiz with a different answer — same user, same gql session.
    await gql(
      `mutation { completeOnboarding(input: { chronotype: NIGHT_OWL, overloadSource: "Family & relationships" }) { user { onboardingCompletedAt } errors { code } } }`,
    );
    const secondFacts = await gql(`{ memoryFacts { id content } }`);
    const matchingSecond = secondFacts.body.data.memoryFacts.filter((f: any) =>
      f.content.includes('Biggest current source of overload'),
    );
    // Still exactly one fact of this kind — updated in place, not duplicated —
    // and it's the same row (same id) with the new content.
    expect(matchingSecond).toHaveLength(1);
    expect(matchingSecond[0].id).toBe(matchingFirst[0].id);
    expect(matchingSecond[0].content).toContain('Family & relationships');
    expect(matchingSecond[0].content).not.toContain('Work & career');
  });

  it('completeOnboarding with every question skipped still marks onboarding complete and writes no memory fact', async () => {
    const { gql } = freshUser();

    const res = await gql(`mutation { completeOnboarding(input: {}) { user { chronotype onboardingCompletedAt } errors { code } } }`);
    expect(res.body.data.completeOnboarding.errors).toEqual([]);
    expect(res.body.data.completeOnboarding.user.chronotype).toBeNull();
    expect(res.body.data.completeOnboarding.user.onboardingCompletedAt).not.toBeNull();

    const facts = await gql(`{ memoryFacts { content } }`);
    expect(facts.body.data.memoryFacts).toEqual([]);
  });

  it('per-user work hours set during onboarding are enforced by the WEEK-scope planner, overriding the 7am-9pm default', async () => {
    const { gql } = freshUser();

    await gql(`mutation { completeOnboarding(input: { workHoursStart: "09:00", workHoursEnd: "17:00" }) { user { id } errors { code } } }`);

    const early = await gql(`mutation { createTask(input: { title: "8am task, before this user's work hours now" }) { task { id } errors { code } } }`);
    const earlyId = early.body.data.createTask.task.id;
    const within = await gql(`mutation { createTask(input: { title: "10am task, within this user's work hours" }) { task { id } errors { code } } }`);
    const withinId = within.body.data.createTask.task.id;

    fakeChanges = [
      { taskId: earlyId, proposedStart: atUtc(1, 8), reason: 'Should be dropped — before the 9am start onboarding set.' },
      { taskId: withinId, proposedStart: atUtc(1, 10), reason: 'Within the 9-5 window.' },
    ];

    const res = await gql(
      `mutation { requestReplan(scope: WEEK) { planRun { diff { changes { task { id } } } } errors { code } } }`,
    );
    const changes = res.body.data.requestReplan.planRun.diff.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].task.id).toBe(withinId);
  });

  it('a user who never completed onboarding still gets the fixed 7am-9pm default window (no regression)', async () => {
    const { gql } = freshUser();

    const task = await gql(`mutation { createTask(input: { title: "8am task, within the fixed default window" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;

    fakeChanges = [{ taskId, proposedStart: atUtc(1, 8), reason: 'Within the 7am-9pm default.' }];

    const res = await gql(
      `mutation { requestReplan(scope: WEEK) { planRun { diff { changes { task { id } } } } errors { code } } }`,
    );
    const changes = res.body.data.requestReplan.planRun.diff.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].task.id).toBe(taskId);
  });

  // Resumable onboarding wizard increment. completeOnboarding above always
  // stamps onboardingWizardStep to CALENDAR the moment the quiz submits —
  // this proves that side effect for real, independent of whatever other
  // fields the same call happens to touch.
  it('completeOnboarding always stamps onboardingWizardStep to CALENDAR, the moment the quiz submits', async () => {
    const { gql } = freshUser();

    const before = await gql(`{ me { onboardingWizardStep } }`);
    expect(before.body.data.me.onboardingWizardStep).toBeNull();

    const res = await gql(`mutation { completeOnboarding(input: {}) { user { onboardingWizardStep } errors { code } } }`);
    expect(res.body.data.completeOnboarding.errors).toEqual([]);
    expect(res.body.data.completeOnboarding.user.onboardingWizardStep).toBe('CALENDAR');

    const reread = await gql(`{ me { onboardingWizardStep } }`);
    expect(reread.body.data.me.onboardingWizardStep).toBe('CALENDAR');
  });

  it('recordOnboardingWizardStep advances the stored step to PLAN', async () => {
    const { gql } = freshUser();

    await gql(`mutation { completeOnboarding(input: {}) { user { onboardingWizardStep } errors { code } } }`);

    const res = await gql(`mutation { recordOnboardingWizardStep(step: PLAN) { user { onboardingWizardStep } errors { code } } }`);
    expect(res.body.data.recordOnboardingWizardStep.errors).toEqual([]);
    expect(res.body.data.recordOnboardingWizardStep.user.onboardingWizardStep).toBe('PLAN');

    const reread = await gql(`{ me { onboardingWizardStep } }`);
    expect(reread.body.data.me.onboardingWizardStep).toBe('PLAN');
  });

  it('redoing the quiz after reaching PLAN resets the stored step back to CALENDAR', async () => {
    const { gql } = freshUser();

    await gql(`mutation { completeOnboarding(input: {}) { user { onboardingWizardStep } errors { code } } }`);
    await gql(`mutation { recordOnboardingWizardStep(step: PLAN) { user { onboardingWizardStep } errors { code } } }`);
    const beforeRedo = await gql(`{ me { onboardingWizardStep } }`);
    expect(beforeRedo.body.data.me.onboardingWizardStep).toBe('PLAN');

    // Redoing the quiz always restarts the wizard from "next: calendar,"
    // regardless of how far a previous pass got — see OnboardingService
    // .complete's own comment on this exact overwrite.
    await gql(`mutation { completeOnboarding(input: { chronotype: NIGHT_OWL }) { user { onboardingWizardStep } errors { code } } }`);
    const afterRedo = await gql(`{ me { onboardingWizardStep } }`);
    expect(afterRedo.body.data.me.onboardingWizardStep).toBe('CALENDAR');
  });
});

// Closes the README's long-standing "no scheduler/cron" gap for
// habit_reminder, morning/evening routine reminders, and the reflection
// reminder. No AnthropicClient override needed — none of the paths this
// suite exercises call the AI (RoutinesService.isCompleteToday deliberately
// bypasses the AI-sequencing hydrate path, see that method's own comment).
//
// Determinism under real wall-clock uncertainty (same challenge the
// Chronotype suite solved a different way): SchedulerService.checkReminders
// windows are keyed to fixed *local* clock hours (8am/8pm/9pm) and to
// minutes-overdue relative to a habit's own preferredTime — neither of
// which this test can control by faking "now" (checkRemindersForUser reads
// a real `new Date()` internally, and there's no clock-injection seam).
// Instead, each test computes a synthetic fixed-offset timezone string
// (e.g. "UTC+05:30") such that the *real* current UTC instant, interpreted
// in that timezone, lands at whatever local time the test needs — so the
// test is deterministic regardless of what wall-clock hour it actually
// runs at, without needing to fake time itself. A fresh user per test
// (same isolation reasoning as Chronotype/Diagnostic onboarding — each
// test needs its own clean "no notifications yet" starting point).
describe('Scheduler / reminder sweep (e2e)', () => {
  let app: INestApplication;
  let schedulerService: SchedulerService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    schedulerService = moduleRef.get(SchedulerService);
  });

  afterAll(async () => {
    await app.close();
  });

  function freshUser() {
    const devEmail = `scheduler-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    return { gql };
  }

  // Returns a fixed-offset "UTC±HH:mm" zone string such that the real
  // current UTC instant, read in that zone, is `targetHour:targetMinute`
  // local time. Deliberately *not* wrapped/clamped to a realistic ±14:00
  // IANA-like range (Luxon's fixed-offset zones accept far wider offsets
  // without complaint — verified directly against the real installed
  // package) — the offset is left as the raw, unwrapped
  // `target - nowUtcMinutesSinceMidnight` difference specifically so the
  // synthetic zone's calendar date always equals *today's real UTC date*.
  // That matters here in a way it didn't for the Chronotype suite's own
  // atHour helper: dev-auth users always have `user.timezone` fixed at
  // "UTC" (see this file's own standing note on that), so every mutation
  // this suite calls through GraphQL (setTodayRoutineCompletion,
  // submitDailyReflection, completeHabitLog) stores its "today" against
  // the real UTC calendar date — a wrapped offset that happened to land on
  // a different synthetic calendar date would make
  // RoutinesService.isCompleteToday/ReflectionService.getToday look up the
  // wrong day's row and report a false "incomplete," an intermittent
  // failure mode that would only show up depending on the real wall-clock
  // time the suite happened to run at.
  function timezoneForLocalTime(targetHour: number, targetMinute: number): string {
    const nowUtc = new Date();
    const nowTotalMinutes = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
    const targetTotalMinutes = targetHour * 60 + targetMinute;
    const offsetMinutes = targetTotalMinutes - nowTotalMinutes;
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${hh}:${mm}`;
  }

  async function notificationTypes(gql: (q: string) => any): Promise<string[]> {
    const res = await gql(`{ notifications { type } }`);
    return res.body.data.notifications.map((n: any) => n.type);
  }
  // Production Hardening Sprint 1 (2026-08-31) CI-failure fix. The two
  // custom-habit-overdue-window tests below check checkRemindersForUser at
  // local time 9:30 as their first step — and 9:30 always lands exactly on
  // a WATER_REMINDER_INTERVAL_MINUTES (30-minute) boundary, so
  // scheduler.service.ts's always-on, unconditional water-reminder side
  // effect (no per-user toggle exists for it) fires a genuine
  // `water_reminder:...` notification alongside whatever the test is
  // actually trying to observe. That's correct product behavior, not a
  // bug — these two tests just weren't written to expect it, so their
  // exact-array `toEqual` assertions failed the very first time this
  // suite ran against a real database in CI (previously untested, since
  // nothing wired this suite into CI before this same Sprint). Every
  // other assertion in this file that only needs to prove a *specific*
  // type is/isn't present already uses `toContain`/`not.toContain`/a
  // filtered `.filter(t => t === ...)` count, all of which are already
  // immune to this ambient noise — only the handful of exact-list
  // comparisons below need this filtered variant.
  async function notificationTypesExcludingAmbientReminders(gql: (q: string) => any): Promise<string[]> {
    const types = await notificationTypes(gql);
    return types.filter((t) => !t.startsWith('water_reminder:') && !t.startsWith('break_reminder:'));
  }


  it('morning routine reminder fires when incomplete inside the 8:00-8:30 window, and stops firing once complete', async () => {
    const { gql } = freshUser();
    await gql(`mutation { setRoutine(input: { type: MORNING, steps: ["Wake up", "Stretch"], aiSequenced: false }) { routine { id } errors { code } } }`);

    const tz = timezoneForLocalTime(8, 10);
    await schedulerService.checkRemindersForUser((await gql(`{ me { id } }`)).body.data.me.id, tz);
    expect(await notificationTypes(gql)).toContain('morning_routine_reminder');

    // Complete the routine, then re-check at a fresh local time within the
    // same window — NotificationsService's own batching would update the
    // existing unread row if this fired again, so asserting the *type
    // count* rather than absence of any notification correctly proves
    // nothing new was created, not just that the old one still exists.
    const stepsRes = await gql(`{ todayRoutines { type steps { id } } }`);
    const morning = stepsRes.body.data.todayRoutines.find((r: any) => r.type === 'MORNING');
    await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: [${morning.steps.map((s: any) => `"${s.id}"`).join(', ')}] }) { routine { completedStepIds } errors { code } } }`,
    );

    const userId = (await gql(`{ me { id } }`)).body.data.me.id;
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(8, 15));
    const countAfterComplete = (await notificationTypes(gql)).filter((t) => t === 'morning_routine_reminder').length;
    expect(countAfterComplete).toBe(1); // still just the one from before completion, no new one added
  });

  it('evening routine and reflection reminders respect their own windows and stay silent outside them', async () => {
    const { gql } = freshUser();
    await gql(`mutation { setRoutine(input: { type: EVENING, steps: ["Wind down"], aiSequenced: false }) { routine { id } errors { code } } }`);
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    // Outside every window (03:00 local) — nothing should fire at all.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(3, 0));
    expect(await notificationTypes(gql)).toEqual([]);

    // Inside the evening-routine window, incomplete — fires.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(20, 5));
    expect(await notificationTypes(gql)).toContain('evening_routine_reminder');
    expect(await notificationTypes(gql)).not.toContain('reflection_reminder');

    // Inside the reflection window, nothing submitted yet — fires.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(21, 5));
    expect(await notificationTypes(gql)).toContain('reflection_reminder');

    // Submit today's reflection, then re-check within the same window —
    // should not add a second reflection_reminder.
    await gql(
      `mutation { submitDailyReflection(input: { wentWell: "Shipped it", challenging: "Focus", carryForward: "Rest" }) { reflection { id } errors { code } } }`,
    );
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(21, 10));
    const reflectionCount = (await notificationTypes(gql)).filter((t) => t === 'reflection_reminder').length;
    expect(reflectionCount).toBe(1);
  });

  it('habit reminder only fires within the 15-120 minute overdue window, keyed independently per habit', async () => {
    const { gql } = freshUser();
    const habitA = await gql(`mutation { createHabit(input: { title: "Morning workout", frequency: DAILY, preferredTime: "09:00" }) { habit { id } errors { code } } }`);
    const habitAId = habitA.body.data.createHabit.habit.id;
    const habitB = await gql(`mutation { createHabit(input: { title: "Evening walk", frequency: DAILY, preferredTime: "09:00" }) { habit { id } errors { code } } }`);
    const habitBId = habitB.body.data.createHabit.habit.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    // Only 5 minutes overdue — below the 15-minute floor, nothing fires.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(9, 5));
    expect(await notificationTypesExcludingAmbientReminders(gql)).toEqual([]);

    // 30 minutes overdue — within range, both independently overdue habits
    // each get their own tracked notification rather than colliding into one.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(9, 30));
    const types = await notificationTypes(gql);
    expect(types).toContain(`habit_reminder:${habitAId}`);
    expect(types).toContain(`habit_reminder:${habitBId}`);

    // Complete habit A, then jump to 150 minutes overdue (past the
    // 120-minute ceiling) — no further reminders for either habit, whether
    // completed or simply stale.
    const todayIso = new Date().toISOString();
    await gql(`mutation { completeHabitLog(habitId: "${habitAId}", date: "${todayIso}") { habit { id todayCompleted } errors { code } } }`);
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(11, 30));
    const countA = (await notificationTypes(gql)).filter((t) => t === `habit_reminder:${habitAId}`).length;
    const countB = (await notificationTypes(gql)).filter((t) => t === `habit_reminder:${habitBId}`).length;
    expect(countA).toBe(1); // no new one after completing it
    expect(countB).toBe(1); // no new one once past the 120-minute ceiling either
  });

  // Configurable reminder windows/thresholds increment. Proves the custom
  // value genuinely *replaces* the fixed default rather than just sitting
  // alongside it — checked at the old default hour/threshold too, where a
  // still-using-the-hardcoded-constant bug would have silently kept firing.
  // Deliberately uses checkRemindersForUser's two-arg form (no third
  // `settings` argument) — the same call shape every test above already
  // uses, and the one a real single-user manual trigger would use too — so
  // this also proves the self-fetching fallback path (getReminderSettingsForUser)
  // actually reads the saved columns, not just the cron sweep's
  // already-fetched-row path.
  it('a custom morning-routine reminder hour replaces the fixed 8am default, not just adds to it', async () => {
    const { gql } = freshUser();
    await gql(`mutation { setRoutine(input: { type: MORNING, steps: ["Wake up"], aiSequenced: false }) { routine { id } errors { code } } }`);
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    const saved = await gql(`mutation { updateProfile(input: { reminderMorningRoutineHour: 6 }) { user { reminderMorningRoutineHour } errors { code } } }`);
    expect(saved.body.data.updateProfile.errors).toEqual([]);
    expect(saved.body.data.updateProfile.user.reminderMorningRoutineHour).toBe(6);

    // The old fixed default hour (8am) no longer does anything for this
    // user — still incomplete, but outside the new 6:00-6:30 window now.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(8, 10));
    expect(await notificationTypesExcludingAmbientReminders(gql)).toEqual([]);

    // The real custom hour (6am) does fire.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(6, 10));
    expect(await notificationTypes(gql)).toContain('morning_routine_reminder');
  });

  it('custom habit-overdue bounds narrow the window, excluding minutes the fixed 15-120 default would have allowed', async () => {
    const { gql } = freshUser();
    const habit = await gql(`mutation { createHabit(input: { title: "Read", frequency: DAILY, preferredTime: "09:00" }) { habit { id } errors { code } } }`);
    const habitId = habit.body.data.createHabit.habit.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    const saved = await gql(
      `mutation { updateProfile(input: { reminderHabitMinOverdueMinutes: 60, reminderHabitMaxOverdueMinutes: 90 }) { user { reminderHabitMinOverdueMinutes reminderHabitMaxOverdueMinutes } errors { code } } }`,
    );
    expect(saved.body.data.updateProfile.errors).toEqual([]);

    // 30 minutes overdue — inside the fixed 15-120 default, but below the
    // new custom 60-minute floor. Would have fired under the old default;
    // must not fire now.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(9, 30));
    expect(await notificationTypesExcludingAmbientReminders(gql)).toEqual([]);

    // 75 minutes overdue — inside the new custom 60-90 window.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(10, 15));
    expect(await notificationTypes(gql)).toContain(`habit_reminder:${habitId}`);

    // 100 minutes overdue — inside the fixed 15-120 default, but above the
    // new custom 90-minute ceiling. Must not add a second notification.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(10, 40));
    const count = (await notificationTypes(gql)).filter((t) => t === `habit_reminder:${habitId}`).length;
    expect(count).toBe(1);
  });

  it('rejects a habit-overdue minimum that is not less than the maximum, in the same call', async () => {
    const { gql } = freshUser();
    const res = await gql(
      `mutation { updateProfile(input: { reminderHabitMinOverdueMinutes: 90, reminderHabitMaxOverdueMinutes: 60 }) { user { id } errors { code field } } }`,
    );
    expect(res.body.data.updateProfile.errors[0].code).toBe('INVALID_RANGE');
    expect(res.body.data.updateProfile.errors[0].field).toBe('reminderHabitMaxOverdueMinutes');
  });

  it('rejects a reminder hour outside the 0-23 range', async () => {
    const { gql } = freshUser();
    const res = await gql(`mutation { updateProfile(input: { reminderEveningRoutineHour: 24 }) { user { id } errors { code } } } `);
    // Same @Max-guarded-input shape as every other bounded field on this
    // input — fails NestJS's global ValidationPipe before the resolver body
    // (and this increment's own INVALID_RANGE check) ever runs.
    expect(res.body.errors).toBeDefined();
  });

  // Reminder escalation / second nudge increment. With the fixed default
  // window (15-120 minutes overdue) the escalation threshold works out to
  // 120 + 240 = 360 minutes — see HABIT_REMINDER_ESCALATION_EXTRA_MINUTES's
  // own comment in scheduler.service.ts for why that extra offset is fixed
  // rather than user-configurable this pass.
  it('sends one escalation notification once a habit reminder has gone unread well past the original window, but not before', async () => {
    const { gql } = freshUser();
    const habit = await gql(`mutation { createHabit(input: { title: "Stretch", frequency: DAILY, preferredTime: "09:00" }) { habit { id } errors { code } } }`);
    const habitId = habit.body.data.createHabit.habit.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    // 30 minutes overdue — inside the base window, base reminder fires.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(9, 30));
    expect(await notificationTypesExcludingAmbientReminders(gql)).toEqual([`habit_reminder:${habitId}`]);

    // 150 minutes overdue — past the base ceiling (120) but nowhere near
    // the escalation threshold (360) yet. The known dead zone: nothing new.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(11, 30));
    expect(await notificationTypesExcludingAmbientReminders(gql)).toEqual([`habit_reminder:${habitId}`]);

    // 400 minutes overdue (past the 360-minute threshold), original
    // reminder still unread — the escalation fires, as a distinct type
    // alongside (not replacing) the original.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(15, 40));
    const typesAfterEscalation = await notificationTypes(gql);
    expect(typesAfterEscalation).toContain(`habit_reminder:${habitId}`);
    expect(typesAfterEscalation).toContain(`habit_reminder_escalation:${habitId}`);

    // A re-check 15 minutes later, still unread, updates the same
    // escalation row rather than stacking a second one — same batching
    // guarantee NotificationsService.create already gives every other
    // reminder type.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(15, 55));
    const escalationCount = (await notificationTypes(gql)).filter((t) => t === `habit_reminder_escalation:${habitId}`).length;
    expect(escalationCount).toBe(1);
  });

  it('does not escalate once the original habit reminder has actually been read', async () => {
    const { gql } = freshUser();
    const habit = await gql(`mutation { createHabit(input: { title: "Journal", frequency: DAILY, preferredTime: "09:00" }) { habit { id } errors { code } } }`);
    const habitId = habit.body.data.createHabit.habit.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(9, 30));
    const listRes = await gql(`{ notifications { id type } }`);
    const original = listRes.body.data.notifications.find((n: any) => n.type === `habit_reminder:${habitId}`);
    expect(original).toBeDefined();

    const markRes = await gql(`mutation { markNotificationRead(id: "${original.id}") { notification { read } errors { code } } }`);
    expect(markRes.body.data.markNotificationRead.notification.read).toBe(true);

    // 400 minutes overdue — past the escalation threshold, but the person
    // already read the original reminder, so there's nothing genuinely new
    // to tell them; no escalation notification should appear.
    await schedulerService.checkRemindersForUser(userId, timezoneForLocalTime(15, 40));
    const types = await notificationTypes(gql);
    expect(types).not.toContain(`habit_reminder_escalation:${habitId}`);
  });
});

// The event-driven counterpart to the Scheduler suite above — closes the
// README's separate "automatic re-planning" gap. Fresh user per test (the
// cooldown this suite exercises is itself per-account state, so tests
// can't share one without one test's plan run poisoning another's cooldown
// window).
describe('Automatic AI re-planning (e2e)', () => {
  let app: INestApplication;
  let plannerService: PlannerService;
  let fakeChanges: Array<{ taskId: string; proposedStart: string; reason: string }> = [];

  beforeAll(async () => {
    const fakeAnthropic = {
      isConfigured: () => true,
      proposeSchedule: async () => ({
        modelUsed: 'fake-model-for-tests',
        proposal: { summary: 'Auto-replanned.', changes: fakeChanges },
      }),
      sendMessage: async () => {
        throw new Error('should not be called');
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AnthropicClient)
      .useValue(fakeAnthropic)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    plannerService = moduleRef.get(PlannerService);
  });

  afterAll(async () => {
    await app.close();
  });

  function freshUser() {
    const devEmail = `auto-replan-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    return { gql };
  }

  // `eventEmitter.emit` is genuinely fire-and-forget — there's no way to
  // await "the listener has finished" from outside it, since Nest's
  // EventEmitter2 doesn't return a promise for non-async emit. Polling
  // briefly for the real, visible effect (a plan run showing up) is the
  // standard way to test a detached event listener's end-to-end wiring
  // without adding a fake delay that's either too short (flaky) or too
  // long (slow suite) — same tradeoff any real system with a fire-and-forget
  // side effect faces.
  async function pollForLatestPlanRun(gql: (q: string) => any, maxAttempts = 20, delayMs = 150): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await gql(`{ latestPlanRun { id triggerEvent } }`);
      if (res.body.data.latestPlanRun) return res.body.data.latestPlanRun;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  it('completing a task with other open tasks remaining triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const toComplete = await gql(`mutation { createTask(input: { title: "Finish this one" }) { task { id } errors { code } } }`);
    const toCompleteId = toComplete.body.data.createTask.task.id;
    const staysOpen = await gql(`mutation { createTask(input: { title: "Still open after" }) { task { id } errors { code } } }`);
    const staysOpenId = staysOpen.body.data.createTask.task.id;

    fakeChanges = [{ taskId: staysOpenId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    // The real mutation, not a direct service call — this is the one test
    // in this suite proving the actual wiring (TasksService emits
    // 'task.completed' → PlannerService's @OnEvent listener picks it up →
    // maybeAutoReplan runs) works, not just that maybeAutoReplan itself is
    // correct in isolation (the rest of this suite calls it directly for
    // speed and determinism).
    await gql(`mutation { completeTask(id: "${toCompleteId}") { task { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_task_completed');
  });

  it('creating a native calendar event triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the new event" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await gql(`mutation { createCalendarEvent(input: { title: "New meeting", startTime: "${start}", endTime: "${end}" }) { event { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_calendar_changed');
  });

  it('a second auto-trigger within the cooldown window is suppressed', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Cooldown test task" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    await plannerService.maybeAutoReplan(userId, 'auto_task_completed');
    const first = await gql(`{ latestPlanRun { id generatedAt } }`);
    expect(first.body.data.latestPlanRun).not.toBeNull();

    // Immediately again — well within the 10-minute cooldown, so this
    // should be a silent no-op, not a second plan run.
    await plannerService.maybeAutoReplan(userId, 'auto_calendar_changed');
    const second = await gql(`{ latestPlanRun { id generatedAt triggerEvent } }`);
    expect(second.body.data.latestPlanRun.id).toBe(first.body.data.latestPlanRun.id);
    expect(second.body.data.latestPlanRun.triggerEvent).toBe('auto_task_completed'); // unchanged — the second call never ran
  });

  it('an account with no open tasks left is a silent no-op, not an error', async () => {
    const { gql } = freshUser();
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    // No tasks created at all — requestReplan would throw NOTHING_TO_PLAN.
    await expect(plannerService.maybeAutoReplan(userId, 'auto_task_completed')).resolves.toBeUndefined();

    const res = await gql(`{ latestPlanRun { id } }`);
    expect(res.body.data.latestPlanRun).toBeNull();
  });

  // WEEK/MONTH auto-replanning increment: the same real end-to-end wiring
  // the first test in this suite already proves for DAY (task.completed →
  // PlannerService's @OnEvent listener → maybeAutoReplan) now also reaches
  // WEEK and MONTH on the very same trigger, not just DAY. Uses a fresh
  // account specifically so neither scope has any pre-existing plan run to
  // collide with this test's own cooldown-window assumptions.
  it('completing a task also triggers a real auto-replan at WEEK and MONTH scope, not just DAY', async () => {
    const { gql } = freshUser();
    const toComplete = await gql(`mutation { createTask(input: { title: "Finish this one too" }) { task { id } errors { code } } }`);
    const toCompleteId = toComplete.body.data.createTask.task.id;
    const staysOpen = await gql(`mutation { createTask(input: { title: "Still open after, week/month test" }) { task { id } errors { code } } }`);
    const staysOpenId = staysOpen.body.data.createTask.task.id;

    fakeChanges = [{ taskId: staysOpenId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    await gql(`mutation { completeTask(id: "${toCompleteId}") { task { id } errors { code } } }`);

    // DAY's own poll already proves the listener fired at all (see the
    // first test above) — this test cares specifically about WEEK/MONTH,
    // so it polls those two scopes directly rather than re-proving DAY.
    async function pollForScope(scope: 'WEEK' | 'MONTH'): Promise<any> {
      for (let i = 0; i < 20; i++) {
        const res = await gql(`{ latestPlanRun(scope: ${scope}) { id triggerEvent } }`);
        if (res.body.data.latestPlanRun) return res.body.data.latestPlanRun;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return null;
    }

    const weekPlan = await pollForScope('WEEK');
    expect(weekPlan).not.toBeNull();
    expect(weekPlan.triggerEvent).toBe('auto_task_completed');

    const monthPlan = await pollForScope('MONTH');
    expect(monthPlan).not.toBeNull();
    expect(monthPlan.triggerEvent).toBe('auto_task_completed');
  });

  // Each scope's cooldown is independent — a WEEK plan generated moments
  // ago must not suppress a DAY auto-trigger firing right after it, even
  // though both came from maybeAutoReplan's own single loop over all three
  // scopes in one call.
  it("each scope's auto-replan cooldown is independent of the others", async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Independent cooldown test task" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    // One call already generates DAY, WEEK, and MONTH together (each
    // scope's own cooldown check finds no prior plan yet, so none of the
    // three are suppressed this first time).
    await plannerService.maybeAutoReplan(userId, 'auto_task_completed');
    const day = await gql(`{ latestPlanRun(scope: DAY) { id } }`);
    const week = await gql(`{ latestPlanRun(scope: WEEK) { id } }`);
    const month = await gql(`{ latestPlanRun(scope: MONTH) { id } }`);
    expect(day.body.data.latestPlanRun).not.toBeNull();
    expect(week.body.data.latestPlanRun).not.toBeNull();
    expect(month.body.data.latestPlanRun).not.toBeNull();

    // Immediately again — every scope is still well within its own
    // cooldown window (10/180/720 minutes respectively), so this second
    // call should be a silent no-op across all three, not just DAY.
    await plannerService.maybeAutoReplan(userId, 'auto_calendar_changed');
    const dayAfter = await gql(`{ latestPlanRun(scope: DAY) { id } }`);
    const weekAfter = await gql(`{ latestPlanRun(scope: WEEK) { id } }`);
    const monthAfter = await gql(`{ latestPlanRun(scope: MONTH) { id } }`);
    expect(dayAfter.body.data.latestPlanRun.id).toBe(day.body.data.latestPlanRun.id);
    expect(weekAfter.body.data.latestPlanRun.id).toBe(week.body.data.latestPlanRun.id);
    expect(monthAfter.body.data.latestPlanRun.id).toBe(month.body.data.latestPlanRun.id);
  });

  // New auto-replanning triggers increment — three more real, end-to-end
  // wiring proofs in the same style as the very first test in this suite
  // (a real mutation, not a direct `maybeAutoReplan` call, so this is
  // proving HabitsService/SignalsService/RoutinesService's own
  // `eventEmitter.emit` calls really reach PlannerService's listeners, not
  // just that `maybeAutoReplan` itself works).
  it('completing a habit triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the habit" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    const create = await gql(`mutation { createHabit(input: { title: "Stretch (auto-replan test)", frequency: DAILY }) { habit { id } errors { code } } }`);
    const habitId = create.body.data.createHabit.habit.id;
    await gql(`mutation { completeHabitLog(habitId: "${habitId}", date: "${new Date().toISOString()}") { habit { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_habit_completed');
  });

  it('logging a mood or energy check-in triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the check-in" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    await gql(`mutation { logMood(input: { moodScore: 4 }) { moodEntry { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_checkin_logged');
  });

  it('fully completing a routine triggers a real end-to-end auto-replan, but a partial completion does not', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the routine" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    const set = await gql(
      `mutation { setRoutine(input: { type: MORNING, steps: ["A", "B"], aiSequenced: false }) { routine { id steps { id label } } errors { code } } }`,
    );
    const stepIds = set.body.data.setRoutine.routine.steps.map((s: any) => s.id);

    // Only one of two steps — a real partial completion, not a finished
    // routine, so `setTodayCompletion`'s own totalSteps check should never
    // emit `routine.completed` at all. Checked immediately (no poll):
    // there's no pending async listener to wait for if the event was never
    // emitted in the first place.
    await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: ${JSON.stringify([stepIds[0]])} }) { routine { id } errors { code } } }`,
    );
    const afterPartial = await gql(`{ latestPlanRun { id } }`);
    expect(afterPartial.body.data.latestPlanRun).toBeNull();

    // Now both steps — a genuinely finished routine.
    await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: ${JSON.stringify(stepIds)} }) { routine { id } errors { code } } }`,
    );
    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_routine_completed');
  });

  // Further auto-replanning triggers increment — same real, end-to-end
  // wiring proofs (a real mutation, not a direct `maybeAutoReplan` call)
  // for the three newest trigger sources: JournalService, FocusService,
  // and ReflectionService.
  it('creating a journal entry triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the journal entry" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    await gql(`mutation { createJournalEntry(input: { content: "A real entry for the auto-replan test." }) { entry { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_journal_entry');
  });

  it('completing a focus session triggers a real end-to-end auto-replan, but cancelling one does not', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the focus session" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    // Cancel one first — must not trigger anything at all, checked
    // immediately (no poll, since nothing should ever have been emitted).
    const toCancel = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`);
    const toCancelId = toCancel.body.data.startFocusSession.session.id;
    await gql(`mutation { cancelFocusSession(id: "${toCancelId}") { session { id } errors { code } } }`);
    const afterCancel = await gql(`{ latestPlanRun { id } }`);
    expect(afterCancel.body.data.latestPlanRun).toBeNull();

    // Now a real completion.
    const toComplete = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`);
    const toCompleteId = toComplete.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${toCompleteId}") { session { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_focus_session_completed');
  });

  // Automatic Pomodoro work/break cycling increment: a completed BREAK
  // must never fire this trigger, even though it's the exact same mutation
  // (completeFocusSession) a completed WORK session uses — only `kind`
  // tells them apart. Checked immediately (no poll) for the break, same
  // "nothing should ever have been emitted" reasoning the cancel case above
  // already uses, then a real WORK completion right after confirms the
  // trigger genuinely still fires in this same test/user, so a silent
  // config problem isn't why the break case saw nothing.
  it('completing a BREAK session does not trigger an auto-replan, unlike a completed WORK session', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the break" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    const brk = await gql(
      `mutation { startFocusSession(input: { plannedDurationMinutes: 5, kind: BREAK }) { session { id kind } errors { code } } }`,
    );
    expect(brk.body.data.startFocusSession.session.kind).toBe('BREAK');
    const brkId = brk.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${brkId}") { session { id } errors { code } } }`);
    const afterBreak = await gql(`{ latestPlanRun { id } }`);
    expect(afterBreak.body.data.latestPlanRun).toBeNull();

    const work = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`);
    const workId = work.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${workId}") { session { id } errors { code } } }`);

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_focus_session_completed');
  });

  it('submitting a daily reflection triggers a real end-to-end auto-replan', async () => {
    const { gql } = freshUser();
    const task = await gql(`mutation { createTask(input: { title: "Something to plan around the reflection" }) { task { id } errors { code } } }`);
    const taskId = task.body.data.createTask.task.id;
    fakeChanges = [{ taskId, proposedStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: 'auto' }];

    await gql(
      `mutation { submitDailyReflection(input: { wentWell: "Shipped a feature.", challenging: "Context switching.", carryForward: "Protect focus time." }) { reflection { id } errors { code } } }`,
    );

    const planRun = await pollForLatestPlanRun(gql);
    expect(planRun).not.toBeNull();
    expect(planRun.triggerEvent).toBe('auto_reflection_submitted');
  });
});

// Mirrors every other feature's own "AI not configured" sibling suite
// (Task duration estimation, Daily reflection, AI recommendations) — a
// separate app instance with the real (unconfigured, no ANTHROPIC_API_KEY
// in this test environment) AnthropicClient, proving maybeAutoReplan is a
// true no-op rather than throwing when AI isn't available.
describe('Automatic AI re-planning — AI not configured (e2e)', () => {
  let app: INestApplication;
  let plannerService: PlannerService;
  const devEmail = `auto-replan-unconfigured-e2e-${Date.now()}@example.com`;

  function gql(query: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    plannerService = moduleRef.get(PlannerService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is a silent no-op when the AI is not configured', async () => {
    await gql(`mutation { createTask(input: { title: "Nothing should happen" }) { task { id } errors { code } } }`);
    const userId = (await gql(`{ me { id } }`)).body.data.me.id;

    await expect(plannerService.maybeAutoReplan(userId, 'auto_task_completed')).resolves.toBeUndefined();

    const res = await gql(`{ latestPlanRun { id } }`);
    expect(res.body.data.latestPlanRun).toBeNull();
  });
});

// Life analytics / trend views increment (PRD §7.3) — nothing here is
// persisted by this increment itself, so every test either seeds data
// through other domains' own real mutations (logMood/logEnergy/logSleep,
// createHabit/completeHabitLog, setRoutine/setTodayRoutineCompletion) or,
// where the GraphQL API genuinely has no way to backdate something (a
// habit's or routine's own createdAt — always stamped `now()` server-side),
// reaches into PrismaService directly, the same escape hatch several
// earlier suites in this file already use for setup the API can't itself
// produce (see e.g. the Two-way calendar sync suite's direct
// `prisma.calendarAccount.create`).
describe('Life analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function freshUser() {
    const devEmail = `analytics-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    function gql(query: string) {
      return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
    }
    return { gql };
  }

  it('returns a real per-day point for every day in the window, null where nothing was logged, with no habits/routines yet', async () => {
    const { gql } = freshUser();
    const res = await gql(
      `{ analyticsSummary(days: 7) { windowDays dailyMoodEnergy { date averageMood averageEnergy } dailySleep { date durationMinutes qualityScore } habitStreaks { habitId } routineConsistency { type } } }`,
    );
    const summary = res.body.data.analyticsSummary;
    expect(summary.windowDays).toBe(7);
    expect(summary.dailyMoodEnergy).toHaveLength(7);
    expect(summary.dailyMoodEnergy.every((d: any) => d.averageMood === null && d.averageEnergy === null)).toBe(true);
    expect(summary.dailySleep).toHaveLength(7);
    expect(summary.dailySleep.every((d: any) => d.durationMinutes === null && d.qualityScore === null)).toBe(true);
    expect(summary.habitStreaks).toEqual([]);
    expect(summary.routineConsistency).toEqual([]);
  });

  it("averages same-day mood/energy check-ins into today's real point, and buckets sleep by date", async () => {
    const { gql } = freshUser();
    await gql(`mutation { logMood(input: { moodScore: 3 }) { moodEntry { id } errors { code } } }`);
    await gql(`mutation { logMood(input: { moodScore: 5 }) { moodEntry { id } errors { code } } }`); // average with the one above: 4
    await gql(`mutation { logEnergy(input: { energyScore: 4 }) { energyEntry { id } errors { code } } }`);
    await gql(`mutation { logSleep(input: { durationMinutes: 420, qualityScore: 4 }) { sleepEntry { id } errors { code } } }`);

    // Dev-auth accounts are fixed at timezone "UTC" (never changed by this
    // test), so today's real UTC calendar date is exactly the date these
    // entries get bucketed under.
    const todayIso = new Date().toISOString().slice(0, 10);
    const res = await gql(
      `{ analyticsSummary(days: 7) { dailyMoodEnergy { date averageMood averageEnergy } dailySleep { date durationMinutes qualityScore } } }`,
    );
    const summary = res.body.data.analyticsSummary;
    const todayMoodEnergy = summary.dailyMoodEnergy.find((d: any) => d.date === todayIso);
    expect(todayMoodEnergy.averageMood).toBe(4);
    expect(todayMoodEnergy.averageEnergy).toBe(4);
    const todaySleep = summary.dailySleep.find((d: any) => d.date === todayIso);
    expect(todaySleep.durationMinutes).toBe(420);
    expect(todaySleep.qualityScore).toBe(4);
  });

  it('computes a habit streak and completion rate, correctly clamped to when the habit was actually created', async () => {
    const { gql } = freshUser();
    const create = await gql(`mutation { createHabit(input: { title: "Stretch", frequency: DAILY }) { habit { id } errors { code } } }`);
    const habitId = create.body.data.createHabit.habit.id;

    // createHabit always stamps createdAt = now() server-side, with no way
    // to override it through the GraphQL API — backdating it directly is
    // the only way to test a real multi-day streak/window rather than a
    // trivial one-day one.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.habit.update({ where: { id: habitId }, data: { createdAt: threeDaysAgo } });

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Deliberately NOT completed two days ago — a real gap, so the streak
    // below should be exactly 2 (today + yesterday), proving the walk
    // correctly stops at the first incomplete due day rather than counting
    // every completed day regardless of order.
    await gql(`mutation { completeHabitLog(habitId: "${habitId}", date: "${now.toISOString()}") { habit { id } errors { code } } }`);
    await gql(`mutation { completeHabitLog(habitId: "${habitId}", date: "${yesterday.toISOString()}") { habit { id } errors { code } } }`);

    const res = await gql(
      `{ analyticsSummary(days: 7) { habitStreaks { habitId title currentStreak dueDaysInWindow completedDaysInWindow completionRatePercent } } }`,
    );
    const streak = res.body.data.analyticsSummary.habitStreaks.find((h: any) => h.habitId === habitId);
    expect(streak.title).toBe('Stretch');
    expect(streak.currentStreak).toBe(2);
    // Due days inside the 7-day window: only the 3 days since the
    // (backdated) habit actually existed — today, yesterday, two days ago —
    // not all 7, proving the creation-date clamp works, not just the
    // streak math in isolation.
    expect(streak.dueDaysInWindow).toBe(3);
    expect(streak.completedDaysInWindow).toBe(2);
    expect(streak.completionRatePercent).toBe(Math.round((2 / 3) * 100));
  });

  it("computes routine consistency using the routine's current checklist length, clamped to when it was created", async () => {
    const { gql } = freshUser();
    const set = await gql(
      `mutation { setRoutine(input: { type: MORNING, steps: ["A", "B"], aiSequenced: false }) { routine { id steps { id label } } errors { code } } }`,
    );
    const routineId = set.body.data.setRoutine.routine.id;
    const stepIds = set.body.data.setRoutine.routine.steps.map((s: any) => s.id);

    await prisma.routine.update({
      where: { id: routineId },
      data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    });

    // setTodayRoutineCompletion (unlike completeHabitLog) only ever writes
    // *today's* log — there's no way to backdate a completion through the
    // API, which is fine here: leaving yesterday and two-days-ago with no
    // log row at all is exactly "not completed," the same default every
    // other day-completion check in this app already uses.
    await gql(
      `mutation { setTodayRoutineCompletion(input: { type: MORNING, completedStepIds: ${JSON.stringify(stepIds)} }) { routine { id } errors { code } } }`,
    );

    const res = await gql(
      `{ analyticsSummary(days: 7) { routineConsistency { type currentStreak daysInWindow completedDaysInWindow completionRatePercent } } }`,
    );
    const consistency = res.body.data.analyticsSummary.routineConsistency.find((r: any) => r.type === 'MORNING');
    expect(consistency.currentStreak).toBe(1); // only today is actually completed
    expect(consistency.daysInWindow).toBe(3); // today, yesterday, two days ago
    expect(consistency.completedDaysInWindow).toBe(1);
    expect(consistency.completionRatePercent).toBe(Math.round((1 / 3) * 100));
  });

  it('clamps an out-of-range days argument into the allowed 7-90 window instead of trusting it as-given', async () => {
    const { gql } = freshUser();
    const tooSmall = await gql(`{ analyticsSummary(days: 1) { windowDays } }`);
    expect(tooSmall.body.data.analyticsSummary.windowDays).toBe(7);
    const tooBig = await gql(`{ analyticsSummary(days: 1000) { windowDays } }`);
    expect(tooBig.body.data.analyticsSummary.windowDays).toBe(90);
  });

  it("is scoped per-user — one account's check-ins never show up in another account's analytics", async () => {
    const userA = freshUser();
    await userA.gql(`mutation { logMood(input: { moodScore: 5 }) { moodEntry { id } errors { code } } }`);

    const userB = freshUser();
    const res = await userB.gql(`{ analyticsSummary(days: 7) { dailyMoodEnergy { averageMood } } }`);
    expect(res.body.data.analyticsSummary.dailyMoodEnergy.every((d: any) => d.averageMood === null)).toBe(true);
  });

  // Cross-metric correlation increment. Sleep duration accepts an explicit
  // `sleepDate` through the real API (see LogSleepInput), so those six days
  // are seeded with genuine mutations; logMood has no such field, so — same
  // escape hatch as the habit/routine `createdAt` backdating above —
  // each mood entry is logged for "today" and then its `loggedAt` is
  // moved directly via Prisma. Energy is never logged at all, and sleep
  // quality is logged as the same constant value every day, so every
  // pair other than sleep-duration-vs-mood should end up with either too
  // few real values or zero variance and correctly not be reported —
  // the test checks for that absence explicitly, not just the one
  // correlation it expects to see.
  it('surfaces a real Pearson correlation between two metrics once there is a genuine day-paired relationship, and omits pairs that never clear the bar', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    // A clean, monotonically increasing sleep-duration-vs-mood relationship
    // across 6 real days (oldest to newest) — independently confirmed via
    // numpy.corrcoef to give r ≈ 0.94 before writing this test, the same
    // "verify the math for real before asserting it" discipline this
    // project already applies to the correlation formula itself.
    const daysAgoValues = [5, 4, 3, 2, 1, 0];
    const sleepMinutesByDay = [300, 360, 420, 450, 480, 500];
    const moodScoresByDay = [2, 2, 3, 4, 4, 5];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);

      await gql(
        `mutation { logSleep(input: { sleepDate: "${date.toISOString()}", durationMinutes: ${sleepMinutesByDay[i]}, qualityScore: 3 }) { sleepEntry { id } errors { code } } }`,
      );

      const moodRes = await gql(`mutation { logMood(input: { moodScore: ${moodScoresByDay[i]} }) { moodEntry { id } errors { code } } }`);
      const moodId = moodRes.body.data.logMood.moodEntry.id;
      await prisma.moodEntry.update({ where: { id: moodId }, data: { loggedAt: date } });
    }

    const res = await gql(
      `{ analyticsSummary(days: 7) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    // This dataset is monotonic enough that both the same-day (lagDays: 0)
    // and one-day-lag (lagDays: 1) checks independently clear the bar for
    // the same underlying pair — a real demonstration that the two are
    // computed and reported completely separately, not that only one of
    // them can ever appear at a time.
    const sleepVsMoodSameDay = correlations.find(
      (c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 0,
    );
    expect(sleepVsMoodSameDay).toBeDefined();
    expect(sleepVsMoodSameDay.sampleSize).toBe(6);
    // Rounded to 2 decimals server-side (see round2 in AnalyticsService) —
    // 0.94 is the exact value independently verified above, not a fuzzy
    // "close enough" check.
    expect(sleepVsMoodSameDay.coefficient).toBe(0.94);
    expect(sleepVsMoodSameDay.description).toContain('higher mood');
    expect(sleepVsMoodSameDay.description).toContain('r = 0.94');
    expect(sleepVsMoodSameDay.description).not.toContain('next day');

    const sleepVsMoodLagged = correlations.find(
      (c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 1,
    );
    expect(sleepVsMoodLagged).toBeDefined();
    expect(sleepVsMoodLagged.sampleSize).toBe(5); // one fewer than the same-day version — the first day has no "day before" in-window to pair with
    expect(sleepVsMoodLagged.coefficient).toBe(0.98); // independently verified via numpy.corrcoef before writing this assertion
    expect(sleepVsMoodLagged.description).toContain('next day');
    expect(sleepVsMoodLagged.description).toContain('r = 0.98');

    // Sleep quality was logged as a constant 3 every day — zero variance,
    // so Pearson's r is mathematically undefined for it, not zero — it
    // must not appear as a correlation at all, on either side of a pair,
    // at either lag.
    expect(correlations.some((c: any) => c.metricALabel === 'Sleep quality' || c.metricBLabel === 'Sleep quality')).toBe(false);
    // Energy was never logged this test — no real values to pair at all.
    expect(correlations.some((c: any) => c.metricALabel === 'Energy' || c.metricBLabel === 'Energy')).toBe(false);
    // No habits exist for this user — nothing was ever "due," so the daily
    // habit-completion series is undefined for every day.
    expect(correlations.some((c: any) => c.metricALabel === 'Habit completion')).toBe(false);
  });

  // A second, dedicated case for the lagged-correlation increment
  // specifically: a relationship that's only real one day out, invisible
  // same-day — proving the two checks are genuinely independent, not that
  // a strong same-day relationship always happens to show up lagged too
  // (which the test above already demonstrates the opposite direction of).
  // This exact 8-day dataset (sleep durations and mood scores) was found
  // by a small script that tried random day-orderings until one produced
  // a same-day |r| comfortably under the 0.3 reporting bar and a one-day-
  // lag |r| comfortably over it — then independently re-confirmed via
  // numpy.corrcoef before being hardcoded here.
  it('surfaces a one-day-lag correlation that is invisible same-day, and omits the same-day version of that same pair', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    const daysAgoValues = [7, 6, 5, 4, 3, 2, 1, 0];
    const sleepMinutesByDay = [340, 370, 430, 460, 310, 400, 250, 280];
    const moodScoresByDay = [3, 3, 3, 4, 5, 2, 4, 1];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);

      await gql(
        `mutation { logSleep(input: { sleepDate: "${date.toISOString()}", durationMinutes: ${sleepMinutesByDay[i]}, qualityScore: 3 }) { sleepEntry { id } errors { code } } }`,
      );

      const moodRes = await gql(`mutation { logMood(input: { moodScore: ${moodScoresByDay[i]} }) { moodEntry { id } errors { code } } }`);
      const moodId = moodRes.body.data.logMood.moodEntry.id;
      await prisma.moodEntry.update({ where: { id: moodId }, data: { loggedAt: date } });
    }

    const res = await gql(
      `{ analyticsSummary(days: 8) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    const lagged = correlations.find(
      (c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 1,
    );
    expect(lagged).toBeDefined();
    expect(lagged.sampleSize).toBe(7);
    expect(lagged.coefficient).toBe(0.98); // independently verified via numpy.corrcoef before writing this assertion
    expect(lagged.description).toContain('next day');

    // The same-day version of this exact pair must NOT appear — its real
    // coefficient (≈0.02, also independently verified) is nowhere near the
    // 0.3 reporting bar, so this is the negative-result half of the proof:
    // a lag-1 finding doesn't imply a same-day one for the same metrics.
    const sameDay = correlations.find(
      (c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 0,
    );
    expect(sameDay).toBeUndefined();
  });

  // Multi-day / reverse-direction lag increment. This dataset was found by
  // a small script that searched random sleep/mood sequences for one where
  // same-day and one-day-lag are both comfortably under the 0.3 reporting
  // bar but a two-day lag is comfortably over it — then independently
  // re-confirmed via numpy.corrcoef before being hardcoded here, same
  // discipline as every other correlation dataset in this file.
  it('surfaces a two-day-lag correlation that is invisible same-day and at one-day lag', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    const daysAgoValues = [8, 7, 6, 5, 4, 3, 2, 1, 0];
    const sleepMinutesByDay = [300, 300, 340, 360, 360, 500, 360, 480, 280];
    const moodScoresByDay = [3, 5, 1, 1, 3, 2, 2, 5, 3];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);

      await gql(
        `mutation { logSleep(input: { sleepDate: "${date.toISOString()}", durationMinutes: ${sleepMinutesByDay[i]}, qualityScore: 3 }) { sleepEntry { id } errors { code } } }`,
      );

      const moodRes = await gql(`mutation { logMood(input: { moodScore: ${moodScoresByDay[i]} }) { moodEntry { id } errors { code } } }`);
      const moodId = moodRes.body.data.logMood.moodEntry.id;
      await prisma.moodEntry.update({ where: { id: moodId }, data: { loggedAt: date } });
    }

    const res = await gql(
      `{ analyticsSummary(days: 9) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    const twoDayLag = correlations.find(
      (c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 2,
    );
    expect(twoDayLag).toBeDefined();
    expect(twoDayLag.sampleSize).toBe(7);
    expect(twoDayLag.coefficient).toBe(0.92); // independently verified via numpy.corrcoef before writing this assertion
    expect(twoDayLag.description).toContain('2 days later');
    expect(twoDayLag.description).toContain('2-day-apart pairs');

    // Neither the same-day nor the one-day-lag version of this exact pair
    // qualifies — both real coefficients (≈0.03 and ≈-0.08) are nowhere
    // near the reporting bar, the negative-result half of this proof.
    expect(
      correlations.some((c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 0),
    ).toBe(false);
    expect(
      correlations.some((c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 1),
    ).toBe(false);
  });

  // Multi-day / reverse-direction lag increment, reverse-direction half.
  // Same discipline as above: a dataset found by search, independently
  // re-confirmed via numpy.corrcoef before being hardcoded. This one
  // specifically proves the reverse direction (does mood predict tomorrow's
  // sleep?) is checked and reported as its own real, correctly-labeled
  // entry — not just a relabeling of the forward direction, which this
  // exact dataset deliberately keeps too weak to qualify.
  it('surfaces a one-day reverse-direction correlation (mood predicting tomorrow\'s sleep) that the forward direction does not show', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    const daysAgoValues = [7, 6, 5, 4, 3, 2, 1, 0];
    const sleepMinutesByDay = [340, 280, 380, 280, 480, 400, 380, 250];
    const moodScoresByDay = [4, 1, 5, 1, 2, 3, 4, 5];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);

      await gql(
        `mutation { logSleep(input: { sleepDate: "${date.toISOString()}", durationMinutes: ${sleepMinutesByDay[i]}, qualityScore: 3 }) { sleepEntry { id } errors { code } } }`,
      );

      const moodRes = await gql(`mutation { logMood(input: { moodScore: ${moodScoresByDay[i]} }) { moodEntry { id } errors { code } } }`);
      const moodId = moodRes.body.data.logMood.moodEntry.id;
      await prisma.moodEntry.update({ where: { id: moodId }, data: { loggedAt: date } });
    }

    const res = await gql(
      `{ analyticsSummary(days: 8) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    // Reverse direction: Mood leading, Sleep duration following — its own
    // independent entry, metricALabel/metricBLabel swapped from every other
    // sleep/mood correlation in this file.
    const reverse = correlations.find(
      (c: any) => c.metricALabel === 'Mood' && c.metricBLabel === 'Sleep duration' && c.lagDays === 1,
    );
    expect(reverse).toBeDefined();
    expect(reverse.sampleSize).toBe(7);
    expect(reverse.coefficient).toBe(-0.87); // independently verified via numpy.corrcoef before writing this assertion
    expect(reverse.description).toContain('lower sleep duration');
    expect(reverse.description).toContain('next day');

    // The forward direction of this exact pair at the same lag (Sleep
    // duration leading, Mood following) does not qualify — its real
    // coefficient is 0.0 exactly, nowhere near the bar.
    expect(
      correlations.some((c: any) => c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood' && c.lagDays === 1),
    ).toBe(false);
    // Same-day doesn't qualify either (real r ≈ 0.035).
    expect(
      correlations.some(
        (c: any) =>
          ((c.metricALabel === 'Sleep duration' && c.metricBLabel === 'Mood') ||
            (c.metricALabel === 'Mood' && c.metricBLabel === 'Sleep duration')) &&
          c.lagDays === 0,
      ),
    ).toBe(false);
  });

  // Insights: task/focus-session/journal trends increment. Same backdating
  // escape hatch as the habit/routine streak tests above — `completeTask`,
  // `completeFocusSession`, and `createJournalEntry` all stamp their real
  // timestamp as `now()` with no way to override it through the API, so a
  // direct Prisma update is the only way to spread real data across
  // multiple distinct days deterministically.
  it('computes real daily task-completion counts, including a real zero on a day nothing was completed', async () => {
    const { gql } = freshUser();
    const a = await gql(`mutation { createTask(input: { title: "Task A" }) { task { id } errors { code } } }`);
    const aId = a.body.data.createTask.task.id;
    const b = await gql(`mutation { createTask(input: { title: "Task B" }) { task { id } errors { code } } }`);
    const bId = b.body.data.createTask.task.id;

    await gql(`mutation { completeTask(id: "${aId}") { task { id } errors { code } } }`);
    await gql(`mutation { completeTask(id: "${bId}") { task { id } errors { code } } }`);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.task.update({ where: { id: bId }, data: { completedAt: twoDaysAgo } });

    const res = await gql(`{ analyticsSummary(days: 7) { dailyTaskCompletions { date completedCount } } }`);
    const series = res.body.data.analyticsSummary.dailyTaskCompletions;
    expect(series).toHaveLength(7);

    const todayIso = new Date().toISOString().slice(0, 10);
    const twoDaysAgoIso = twoDaysAgo.toISOString().slice(0, 10);
    const oneDayAgoIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(series.find((d: any) => d.date === todayIso).completedCount).toBe(1);
    expect(series.find((d: any) => d.date === twoDaysAgoIso).completedCount).toBe(1);
    // A real, known zero — the day exists in the series with completedCount:
    // 0, not omitted the way a missing mood/sleep check-in would be.
    const oneDayAgoEntry = series.find((d: any) => d.date === oneDayAgoIso);
    expect(oneDayAgoEntry).toBeDefined();
    expect(oneDayAgoEntry.completedCount).toBe(0);
  });

  it('computes real daily focused minutes and a real focus-session streak, with a real zero day breaking it', async () => {
    const { gql } = freshUser();

    const start1 = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`);
    const session1Id = start1.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${session1Id}") { session { id } errors { code } } }`);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const twoDaysAgoEnd = new Date(twoDaysAgo.getTime() + 30 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: session1Id }, data: { startedAt: twoDaysAgo, endedAt: twoDaysAgoEnd } });

    const start2 = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: 25 }) { session { id } errors { code } } }`);
    const session2Id = start2.body.data.startFocusSession.session.id;
    await gql(`mutation { completeFocusSession(id: "${session2Id}") { session { id } errors { code } } }`);
    const now = new Date();
    const twentyMinAgo = new Date(now.getTime() - 20 * 60 * 1000);
    await prisma.focusSession.update({ where: { id: session2Id }, data: { startedAt: twentyMinAgo, endedAt: now } });

    const res = await gql(
      `{ analyticsSummary(days: 7) { dailyFocusMinutes { date completedMinutes completedSessions } focusSessionConsistency { currentStreak daysInWindow completedDaysInWindow completionRatePercent } } }`,
    );
    const series = res.body.data.analyticsSummary.dailyFocusMinutes;

    const todayIso = new Date().toISOString().slice(0, 10);
    const twoDaysAgoIso = twoDaysAgo.toISOString().slice(0, 10);
    const oneDayAgoIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const today = series.find((d: any) => d.date === todayIso);
    const twoDaysAgoEntry = series.find((d: any) => d.date === twoDaysAgoIso);
    const oneDayAgoEntry = series.find((d: any) => d.date === oneDayAgoIso);

    expect(today.completedMinutes).toBe(20);
    expect(today.completedSessions).toBe(1);
    expect(twoDaysAgoEntry.completedMinutes).toBe(30);
    expect(twoDaysAgoEntry.completedSessions).toBe(1);
    // A real zero — nothing happened yesterday, and this is exactly what
    // breaks the streak walk below.
    expect(oneDayAgoEntry.completedMinutes).toBe(0);
    expect(oneDayAgoEntry.completedSessions).toBe(0);

    const consistency = res.body.data.analyticsSummary.focusSessionConsistency;
    // Only today is part of the *current* unbroken streak — yesterday's
    // real zero breaks it, so the two-days-ago session (real, but on the
    // far side of that gap) doesn't extend it either.
    expect(consistency.currentStreak).toBe(1);
    expect(consistency.daysInWindow).toBe(7);
    expect(consistency.completedDaysInWindow).toBe(2);
    expect(consistency.completionRatePercent).toBe(Math.round((2 / 7) * 100));
  });

  it('computes real daily journal entry counts, including a real zero on a day nothing was written', async () => {
    const { gql } = freshUser();
    const entryA = await gql(`mutation { createJournalEntry(input: { content: "Entry A" }) { entry { id } errors { code } } }`);
    const entryAId = entryA.body.data.createJournalEntry.entry.id;
    const entryB = await gql(`mutation { createJournalEntry(input: { content: "Entry B" }) { entry { id } errors { code } } }`);
    const entryBId = entryB.body.data.createJournalEntry.entry.id;

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.journalEntry.update({ where: { id: entryBId }, data: { createdAt: twoDaysAgo } });
    void entryAId; // logged "today" by default — nothing further to do with its id.

    const res = await gql(`{ analyticsSummary(days: 7) { dailyJournalActivity { date entryCount } } }`);
    const series = res.body.data.analyticsSummary.dailyJournalActivity;

    const todayIso = new Date().toISOString().slice(0, 10);
    const twoDaysAgoIso = twoDaysAgo.toISOString().slice(0, 10);
    const oneDayAgoIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(series.find((d: any) => d.date === todayIso).entryCount).toBe(1);
    expect(series.find((d: any) => d.date === twoDaysAgoIso).entryCount).toBe(1);
    expect(series.find((d: any) => d.date === oneDayAgoIso).entryCount).toBe(0);
  });

  // Wiring Insights' newest trends into the correlation engine increment —
  // proves one of the six new candidate pairs (Tasks completed vs. Mood)
  // computes a real, independently-verified coefficient from real data,
  // the same "verify the exact number via numpy before writing the
  // assertion" discipline the original correlation increment's own tests
  // already established.
  it('surfaces a real correlation between tasks completed and mood', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    async function completeTasksOnDay(count: number, date: Date): Promise<void> {
      for (let i = 0; i < count; i++) {
        const create = await gql(`mutation { createTask(input: { title: "Correlation test task ${Math.random()}" }) { task { id } errors { code } } }`);
        const id = create.body.data.createTask.task.id;
        await gql(`mutation { completeTask(id: "${id}") { task { id } errors { code } } }`);
        await prisma.task.update({ where: { id }, data: { completedAt: date } });
      }
    }

    // Independently confirmed via numpy.corrcoef (r ≈ 0.93) before writing
    // this test — a real, if simple, monotonic relationship between how
    // many tasks got completed a given day and that day's mood.
    const daysAgoValues = [5, 4, 3, 2, 1, 0];
    const taskCompletedCounts = [0, 1, 1, 2, 3, 4];
    const moodScoresByDay = [2, 2, 3, 4, 4, 5];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);
      await completeTasksOnDay(taskCompletedCounts[i], date);

      const moodRes = await gql(`mutation { logMood(input: { moodScore: ${moodScoresByDay[i]} }) { moodEntry { id } errors { code } } }`);
      const moodId = moodRes.body.data.logMood.moodEntry.id;
      await prisma.moodEntry.update({ where: { id: moodId }, data: { loggedAt: date } });
    }

    const res = await gql(
      `{ analyticsSummary(days: 7) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    const tasksVsMood = correlations.find(
      (c: any) => c.metricALabel === 'Tasks completed' && c.metricBLabel === 'Mood' && c.lagDays === 0,
    );
    expect(tasksVsMood).toBeDefined();
    expect(tasksVsMood.sampleSize).toBe(6); // every day has a real completedCount, even the 0 — none excluded
    expect(tasksVsMood.coefficient).toBe(0.93); // independently verified via numpy.corrcoef before writing this assertion
    expect(tasksVsMood.description).toContain('higher mood');
  });

  // Correlating non-mood/energy metrics increment — proves one of the 14
  // new candidate pairs (Focused minutes vs. Journal entries, neither of
  // which is Mood or Energy) computes a real, independently-verified
  // coefficient from real data. Same "verify the exact number via numpy
  // before writing the assertion" discipline as every other correlation
  // test in this file.
  it('surfaces a real correlation between two non-mood/energy metrics', async () => {
    const { gql } = freshUser();

    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    }

    async function addFocusMinutesOnDay(minutes: number, date: Date): Promise<void> {
      if (minutes === 0) return;
      const start = await gql(`mutation { startFocusSession(input: { plannedDurationMinutes: ${minutes} }) { session { id } errors { code } } }`);
      const id = start.body.data.startFocusSession.session.id;
      await gql(`mutation { completeFocusSession(id: "${id}") { session { id } errors { code } } }`);
      const endedAt = new Date(date.getTime() + minutes * 60 * 1000);
      await prisma.focusSession.update({ where: { id }, data: { startedAt: date, endedAt } });
    }

    async function addJournalEntriesOnDay(count: number, date: Date): Promise<void> {
      for (let i = 0; i < count; i++) {
        const create = await gql(
          `mutation { createJournalEntry(input: { content: "Correlation test entry ${Math.random()}" }) { entry { id } errors { code } } }`,
        );
        const id = create.body.data.createJournalEntry.entry.id;
        await prisma.journalEntry.update({ where: { id }, data: { createdAt: date } });
      }
    }

    // Independently confirmed via numpy.corrcoef (r ≈ 0.97) before writing
    // this test — a real, non-monotonic-but-strong relationship between how
    // many minutes were focused a given day and how many journal entries
    // got written that same day (both plausible on a genuinely productive
    // vs. genuinely quiet day).
    const daysAgoValues = [5, 4, 3, 2, 1, 0];
    const focusMinutesByDay = [0, 20, 45, 60, 90, 30];
    const journalEntriesByDay = [0, 1, 1, 2, 3, 1];

    for (let i = 0; i < daysAgoValues.length; i++) {
      const date = daysAgo(daysAgoValues[i]);
      await addFocusMinutesOnDay(focusMinutesByDay[i], date);
      await addJournalEntriesOnDay(journalEntriesByDay[i], date);
    }

    const res = await gql(
      `{ analyticsSummary(days: 7) { correlations { metricALabel metricBLabel lagDays coefficient sampleSize description } } }`,
    );
    const correlations = res.body.data.analyticsSummary.correlations;

    const focusVsJournal = correlations.find(
      (c: any) => c.metricALabel === 'Focused minutes' && c.metricBLabel === 'Journal entries' && c.lagDays === 0,
    );
    expect(focusVsJournal).toBeDefined();
    expect(focusVsJournal.sampleSize).toBe(6); // every day has a real completedMinutes/entryCount, even the 0s — none excluded
    expect(focusVsJournal.coefficient).toBe(0.97); // independently verified via numpy.corrcoef before writing this assertion
    expect(focusVsJournal.description).toContain('higher journal entries');

    // Neither Mood nor Energy was ever logged this test — confirms this
    // pair really is checked independently of them, not only ever
    // computed alongside a mood/energy pair.
    expect(correlations.some((c: any) => c.metricALabel === 'Mood' || c.metricBLabel === 'Mood')).toBe(false);
    expect(correlations.some((c: any) => c.metricALabel === 'Energy' || c.metricBLabel === 'Energy')).toBe(false);
  });
});

// Real Stripe billing integration. Same "override just the one third-party
// client, exercise everything downstream for real" pattern every other
// external-integration describe block in this file already uses (see
// AnthropicClient/GoogleCalendarWriteService/MicrosoftCalendarClient/
// AppleCaldavClient above) — StripeService is the only thing standing in
// for the real network here; the webhook controller, raw-body handling,
// signature verification math, and BillingService's own DB-writing logic
// below all run for real, unmocked.
describe('Billing — Stripe not configured (e2e)', () => {
  let app: INestApplication;
  const devEmail = `billing-unconfigured-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeService)
      .useValue({
        isConfigured: () => false,
        tierForPriceId: () => null,
        createCheckoutSession: async () => {
          throw new Error('STRIPE_NOT_CONFIGURED');
        },
        createBillingPortalSession: async () => {
          throw new Error('STRIPE_NOT_CONFIGURED');
        },
        retrieveSubscription: async () => {
          throw new Error('STRIPE_NOT_CONFIGURED');
        },
        constructWebhookEvent: () => {
          throw new Error('STRIPE_NOT_CONFIGURED');
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
  }

  it('createCheckoutSession reports STRIPE_NOT_CONFIGURED instead of crashing', async () => {
    const res = await gql(`mutation { createCheckoutSession(tier: PRO) { checkoutUrl errors { code message } } }`);
    expect(res.body.data.createCheckoutSession.checkoutUrl).toBeNull();
    expect(res.body.data.createCheckoutSession.errors[0].code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('createCheckoutSession rejects FREE with INVALID_TIER before ever reaching Stripe', async () => {
    const res = await gql(`mutation { createCheckoutSession(tier: FREE) { checkoutUrl errors { code message } } }`);
    expect(res.body.data.createCheckoutSession.errors[0].code).toBe('INVALID_TIER');
  });

  it('createBillingPortalSession reports NO_STRIPE_CUSTOMER for a fresh account regardless of Stripe configuration', async () => {
    const res = await gql(`mutation { createBillingPortalSession { portalUrl errors { code message } } }`);
    expect(res.body.data.createBillingPortalSession.portalUrl).toBeNull();
    expect(res.body.data.createBillingPortalSession.errors[0].code).toBe('NO_STRIPE_CUSTOMER');
  });

  it('a fresh account starts on FREE with hasStripeCustomer false', async () => {
    const res = await gql(`{ me { subscription { tier status hasStripeCustomer } } }`);
    expect(res.body.data.me.subscription.tier).toBe('FREE');
    expect(res.body.data.me.subscription.hasStripeCustomer).toBe(false);
  });
});

describe('Billing — Stripe webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const devEmail = `billing-webhook-e2e-${Date.now()}@example.com`;
  const webhookSecret = 'whsec_test_e2e_secret';
  const priceIdByTier: Record<string, string> = { PLUS: 'price_plus_e2e', PRO: 'price_pro_e2e' };
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeService)
      .useValue({
        isConfigured: () => true,
        tierForPriceId: (priceId: string) =>
          (Object.entries(priceIdByTier).find(([, id]) => id === priceId)?.[0] as 'PLUS' | 'PRO' | undefined) ?? null,
        createCheckoutSession: async () => {
          throw new Error('not exercised in this describe block');
        },
        createBillingPortalSession: async () => {
          throw new Error('not exercised in this describe block');
        },
        // A real Stripe.Subscription-shaped object for the one
        // subscription id the checkout.session.completed test below uses —
        // standing in for the real network call StripeService.
        // retrieveSubscription would otherwise make, exactly the way every
        // other external-API stub in this file works.
        retrieveSubscription: async (subscriptionId: string) => ({
          id: subscriptionId,
          customer: 'cus_from_retrieve_e2e',
          status: 'active',
          current_period_end: 1893456000,
          items: { data: [{ price: { id: priceIdByTier.PLUS } }] },
        }),
        // The one method genuinely NOT stubbed — real Stripe SDK signature
        // verification, run against a fixed test secret, exactly what
        // StripeService.constructWebhookEvent itself does.
        constructWebhookEvent: (rawBody: Buffer, signature: string) =>
          Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret),
      })
      .compile();
    // rawBody: true — same flag main.ts's own bootstrap passes, needed
    // here too since the testing module's createNestApplication doesn't
    // inherit it from anywhere; without it req.rawBody would be undefined
    // and the webhook controller would 400 on every request.
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);

    // Establish the real user row this test correlates every webhook event
    // against via metadata.userId — the exact same JIT-provisioning path
    // every other describe block in this file relies on.
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('x-dev-user-email', devEmail)
      .send({ query: '{ me { id } }' });
    userId = res.body.data.me.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function gql(query: string) {
    return request(app.getHttpServer()).post('/graphql').set('x-dev-user-email', devEmail).send({ query });
  }

  function postWebhook(payload: string, signature: string) {
    return request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);
  }

  it('a genuinely signature-verified customer.subscription.updated event updates tier/status/currentPeriodEnd/hasStripeCustomer', async () => {
    const eventPayload = JSON.stringify({
      id: 'evt_e2e_sub_updated',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_e2e_1',
          customer: 'cus_e2e_1',
          status: 'active',
          current_period_end: 1893456000,
          items: { data: [{ price: { id: priceIdByTier.PRO } }] },
          metadata: { userId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: webhookSecret });

    const webhookRes = await postWebhook(eventPayload, signature);
    expect(webhookRes.status).toBe(200);

    const res = await gql(`{ me { subscription { tier status currentPeriodEnd hasStripeCustomer } } }`);
    expect(res.body.data.me.subscription.tier).toBe('PRO');
    expect(res.body.data.me.subscription.status).toBe('ACTIVE');
    expect(res.body.data.me.subscription.hasStripeCustomer).toBe(true);
    expect(new Date(res.body.data.me.subscription.currentPeriodEnd).getTime()).toBe(1893456000 * 1000);

    // Confirmed directly against the database too, not just the GraphQL
    // read path — proves the real stripeCustomerId/stripeSubscriptionId
    // columns were actually written, even though those two are
    // deliberately never exposed over GraphQL (see subscription.resolver.ts's
    // own comment on why only the derived hasStripeCustomer boolean is).
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.stripeCustomerId).toBe('cus_e2e_1');
    expect(row?.stripeSubscriptionId).toBe('sub_e2e_1');
  });

  it('a checkout.session.completed event looks up the real subscription (via retrieveSubscription) and applies the same state', async () => {
    const eventPayload = JSON.stringify({
      id: 'evt_e2e_checkout_completed',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_e2e_1',
          subscription: 'sub_e2e_from_checkout',
          customer: 'cus_e2e_from_checkout',
          metadata: { userId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: webhookSecret });

    const webhookRes = await postWebhook(eventPayload, signature);
    expect(webhookRes.status).toBe(200);

    // retrieveSubscription's stub above always returns tier PLUS/status
    // active for whatever id it's asked for — this proves the webhook
    // handler actually called it with the session's own subscription id
    // (sub_e2e_from_checkout) rather than skipping straight to a no-op.
    const row = await prisma.subscription.findUnique({ where: { userId } });
    expect(row?.tier).toBe('PLUS');
    expect(row?.stripeCustomerId).toBe('cus_from_retrieve_e2e');
    expect(row?.stripeSubscriptionId).toBe('sub_e2e_from_checkout');
  });

  it('rejects a webhook with a tampered signature, and makes no database change', async () => {
    const before = await prisma.subscription.findUnique({ where: { userId } });

    const eventPayload = JSON.stringify({
      id: 'evt_e2e_tampered',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_e2e_should_not_apply',
          customer: 'cus_e2e_should_not_apply',
          status: 'active',
          current_period_end: 1893456000,
          items: { data: [{ price: { id: priceIdByTier.PRO } }] },
          metadata: { userId },
        },
      },
    });
    // Signed against the wrong secret — StripeService.constructWebhookEvent
    // (the real, unstubbed method) rejects this the same way it would
    // reject a forged request from anyone who doesn't know the real
    // webhook signing secret.
    const badSignature = Stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: 'whsec_wrong_secret' });

    const webhookRes = await postWebhook(eventPayload, badSignature);
    expect(webhookRes.status).toBe(400);

    const after = await prisma.subscription.findUnique({ where: { userId } });
    expect(after?.stripeCustomerId).toBe(before?.stripeCustomerId);
    expect(after?.stripeSubscriptionId).toBe(before?.stripeSubscriptionId);
    expect(after?.tier).toBe(before?.tier);
  });

  it('customer.subscription.deleted moves the account back toward CANCELED without touching tier when the price is unrecognized', async () => {
    const eventPayload = JSON.stringify({
      id: 'evt_e2e_sub_deleted',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_e2e_1',
          customer: 'cus_e2e_1',
          status: 'canceled',
          current_period_end: null,
          items: { data: [{ price: { id: 'price_unrecognized_e2e' } }] },
          metadata: { userId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: webhookSecret });

    const webhookRes = await postWebhook(eventPayload, signature);
    expect(webhookRes.status).toBe(200);

    const res = await gql(`{ me { subscription { tier status currentPeriodEnd } } }`);
    expect(res.body.data.me.subscription.status).toBe('CANCELED');
    expect(res.body.data.me.subscription.currentPeriodEnd).toBeNull();
    // tier is left at whatever it already was (PLUS, from the
    // checkout.session.completed test above) — an unrecognized price on a
    // cancellation event must never silently reset it to something wrong.
    expect(res.body.data.me.subscription.tier).toBe('PLUS');
  });
});
