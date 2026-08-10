import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { AiMemoryFact } from './models/memory-fact.model';
import { CreateMemoryFactPayload, UpdateMemoryFactPayload, DeleteMemoryFactPayload } from './models/memory-fact.payload';
import { MemoryFactInput } from './dto/memory-fact.input';
import { MemoryService } from './memory.service';

// Same ownership discipline as every other resolver: resolve the internal
// users.id first, never scope by the raw auth identity.
@Resolver()
@UseGuards(AuthGuard)
export class MemoryResolver {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => [AiMemoryFact])
  async memoryFacts(@CurrentAuth() auth: AuthContext): Promise<AiMemoryFact[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.memoryService.listForUser(user.id);
  }

  @Mutation(() => CreateMemoryFactPayload)
  async createMemoryFact(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: MemoryFactInput,
  ): Promise<CreateMemoryFactPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const fact = await this.memoryService.create(user.id, input.content);
      return { fact, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't save that. Try again." }] };
    }
  }

  @Mutation(() => UpdateMemoryFactPayload)
  async updateMemoryFact(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: MemoryFactInput,
  ): Promise<UpdateMemoryFactPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const fact = await this.memoryService.update(user.id, id, input.content);
      return { fact, errors: [] };
    } catch {
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }

  @Mutation(() => DeleteMemoryFactPayload)
  async deleteMemoryFact(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteMemoryFactPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const deletedFactId = await this.memoryService.delete(user.id, id);
      return { deletedFactId, errors: [] };
    } catch {
      return { errors: [{ code: 'DELETE_FAILED', message: "We couldn't delete that. Try again." }] };
    }
  }
}
