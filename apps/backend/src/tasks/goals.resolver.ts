import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { Goal, GoalStatus } from './models/goal.model';
import { CreateGoalPayload, UpdateGoalPayload } from './models/goal.payload';
import { CreateGoalInput } from './dto/create-goal.input';
import { UpdateGoalInput } from './dto/update-goal.input';
import { GoalsService } from './goals.service';

@Resolver(() => Goal)
@UseGuards(AuthGuard)
export class GoalsResolver {
  constructor(
    private readonly goalsService: GoalsService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => [Goal])
  async goals(
    @CurrentAuth() auth: AuthContext,
    @Args('status', { type: () => GoalStatus, nullable: true }) status?: GoalStatus,
  ): Promise<Goal[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.goalsService.listForUser(user.id, status);
  }

  @Mutation(() => CreateGoalPayload)
  async createGoal(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateGoalInput,
  ): Promise<CreateGoalPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const goal = await this.goalsService.create(user.id, input);
      return { goal, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't create that goal. Try again." }] };
    }
  }

  @Mutation(() => UpdateGoalPayload)
  async updateGoal(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateGoalInput,
  ): Promise<UpdateGoalPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const goal = await this.goalsService.update(user.id, id, input);
      return { goal, errors: [] };
    } catch {
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }
}
