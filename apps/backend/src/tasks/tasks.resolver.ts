import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { Task, TaskStatus } from './models/task.model';
import { TaskConnection } from './models/task-connection.model';
import { CreateTaskPayload, UpdateTaskPayload, CompleteTaskPayload } from './models/task.payload';
import { CreateTagPayload } from './models/tag.payload';
import { CreateTaskInput } from './dto/create-task.input';
import { UpdateTaskInput } from './dto/update-task.input';
import { CreateTagInput } from './dto/create-tag.input';
import { TasksService } from './tasks.service';

// Every method resolves the internal user record from the auth context
// first — `auth.authProviderId` is the external Clerk/dev-auth identity,
// never the row-ownership key. Task/tag ownership is always scoped by the
// internal `users.id`, matching the foreign keys in the Database Design
// Document §4.2, not the auth provider's own id.
@Resolver(() => Task)
@UseGuards(AuthGuard)
export class TasksResolver {
  constructor(
    private readonly tasksService: TasksService,
    private readonly usersService: UsersService,
  ) {}

  // Matches the `tasks` query in the API Design Document §5.1 — full,
  // cursor-paginated list for a dedicated task-list screen.
  //
  // Tasks pagination increment: `statuses` (a list) is a new, separate arg
  // from the original singular `status` — kept alongside it rather than
  // replacing it, since COMPLETED_TASKS_QUERY (see queries.ts) already
  // relies on the singular form and there's no reason to break that. Lets
  // the Tasks screen's "Open" tab ask for PENDING and IN_PROGRESS together
  // in one real, server-paginated query instead of over-fetching every
  // status into one unfiltered page and filtering client-side (which is
  // what forced that screen's old 100-task cap in the first place — see
  // the README's own note on this increment).
  @Query(() => TaskConnection)
  async tasks(
    @CurrentAuth() auth: AuthContext,
    @Args('status', { type: () => TaskStatus, nullable: true }) status?: TaskStatus,
    @Args('statuses', { type: () => [TaskStatus], nullable: true }) statuses?: TaskStatus[],
    @Args('goalId', { type: () => ID, nullable: true }) goalId?: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<TaskConnection> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.tasksService.listConnection(user.id, { status, statuses, goalId, first, after }) as any;
  }

  @Mutation(() => CreateTaskPayload)
  async createTask(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateTaskInput,
  ): Promise<CreateTaskPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const task = await this.tasksService.create(user.id, input);
      return { task, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't create that task. Try again." }] };
    }
  }

  @Mutation(() => UpdateTaskPayload)
  async updateTask(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateTaskInput,
  ): Promise<UpdateTaskPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const task = await this.tasksService.update(user.id, id, input);
      return { task, errors: [] };
    } catch {
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }

  @Mutation(() => CompleteTaskPayload)
  async completeTask(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('actualDurationMinutes', { type: () => Int, nullable: true }) actualDurationMinutes?: number,
  ): Promise<CompleteTaskPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const task = await this.tasksService.complete(user.id, id, actualDurationMinutes);
      return { task, errors: [] };
    } catch {
      return { errors: [{ code: 'COMPLETE_FAILED', message: "We couldn't mark that task complete. Try again." }] };
    }
  }

  @Mutation(() => CompleteTaskPayload)
  async cancelTask(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<CompleteTaskPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const task = await this.tasksService.cancel(user.id, id);
      return { task, errors: [] };
    } catch {
      return { errors: [{ code: 'CANCEL_FAILED', message: "We couldn't cancel that task. Try again." }] };
    }
  }

  // Un-completing a task increment: the counterpart to completeTask, for
  // undoing a misclick from the completed-tasks view (/more). Reuses
  // CompleteTaskPayload — same { task, errors } shape, no need for a new
  // payload type just for this.
  @Mutation(() => CompleteTaskPayload)
  async reopenTask(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<CompleteTaskPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const task = await this.tasksService.reopen(user.id, id);
      return { task, errors: [] };
    } catch {
      return { errors: [{ code: 'REOPEN_FAILED', message: "We couldn't reopen that task. Try again." }] };
    }
  }

  @Mutation(() => CreateTagPayload)
  async createTag(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateTagInput,
  ): Promise<CreateTagPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const tag = await this.tasksService.createTag(user.id, input.name, input.color);
      return { tag: tag as any, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_TAG_FAILED', message: "We couldn't create that tag. Try again." }] };
    }
  }
}
