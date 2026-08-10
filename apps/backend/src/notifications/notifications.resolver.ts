import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { User } from '../users/models/user.model';
import { Notification } from './models/notification.model';
import { MarkNotificationReadPayload, UpdateNotificationPreferencesPayload } from './models/notification.payload';
import { UpdateNotificationPreferencesInput } from './dto/update-notification-preferences.input';
import { NotificationsService } from './notifications.service';

@Resolver(() => Notification)
@UseGuards(AuthGuard)
export class NotificationsResolver {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => [Notification])
  async notifications(
    @CurrentAuth() auth: AuthContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
  ): Promise<Notification[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.notificationsService.listRecent(user.id, first ?? 20);
  }

  @Query(() => Int)
  async unreadNotificationCount(@CurrentAuth() auth: AuthContext): Promise<number> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.notificationsService.unreadCount(user.id);
  }

  @Mutation(() => MarkNotificationReadPayload)
  async markNotificationRead(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<MarkNotificationReadPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const notification = await this.notificationsService.markRead(user.id, id);
      return { notification, errors: [] };
    } catch {
      return { errors: [{ code: 'MARK_READ_FAILED', message: "We couldn't update that notification. Try again." }] };
    }
  }

  @Mutation(() => UpdateNotificationPreferencesPayload)
  async updateNotificationPreferences(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: UpdateNotificationPreferencesInput,
  ): Promise<UpdateNotificationPreferencesPayload> {
    try {
      const authedUser = await this.usersService.getOrCreateFromAuth(auth);
      const user = await this.notificationsService.updatePreferences(authedUser.id, input);
      return { user: user as unknown as User, errors: [] };
    } catch {
      return {
        errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those notification preferences. Try again." }],
      };
    }
  }
}
