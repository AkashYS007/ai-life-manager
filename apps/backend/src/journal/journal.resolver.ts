import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { JournalEntry } from './models/journal-entry.model';
import { JournalEntryConnection } from './models/journal-entry-connection.model';
import { CreateJournalEntryPayload, UpdateJournalEntryPayload, DeleteJournalEntryPayload } from './models/journal-entry.payload';
import { CreateJournalEntryInput } from './dto/create-journal-entry.input';
import { UpdateJournalEntryInput } from './dto/update-journal-entry.input';
import { JournalService } from './journal.service';

// Same ownership discipline as every other resolver here: `auth.authProviderId`
// is the external Clerk/dev-auth identity, never the row-scoping key —
// every method resolves the internal `users.id` first.
@Resolver(() => JournalEntry)
@UseGuards(AuthGuard)
export class JournalResolver {
  constructor(
    private readonly journalService: JournalService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => JournalEntryConnection)
  async journalEntries(
    @CurrentAuth() auth: AuthContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<JournalEntryConnection> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.journalService.listConnection(user.id, { first, after }) as any;
  }

  @Mutation(() => CreateJournalEntryPayload)
  async createJournalEntry(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateJournalEntryInput,
  ): Promise<CreateJournalEntryPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const entry = await this.journalService.create(user.id, input);
      return { entry, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't save that journal entry. Try again." }] };
    }
  }

  @Mutation(() => UpdateJournalEntryPayload)
  async updateJournalEntry(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateJournalEntryInput,
  ): Promise<UpdateJournalEntryPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const entry = await this.journalService.update(user.id, id, input);
      return { entry, errors: [] };
    } catch {
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }

  @Mutation(() => DeleteJournalEntryPayload)
  async deleteJournalEntry(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteJournalEntryPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const deletedEntryId = await this.journalService.delete(user.id, id);
      return { deletedEntryId, errors: [] };
    } catch {
      return { errors: [{ code: 'DELETE_FAILED', message: "We couldn't delete that journal entry. Try again." }] };
    }
  }
}
