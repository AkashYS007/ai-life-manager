import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { RegisterPushSubscriptionInput } from './dto/register-push-subscription.input';
import {
  RegisterPushSubscriptionPayload,
  SendTestNotificationPayload,
  UnregisterPushSubscriptionPayload,
} from './models/push-subscription.payload';
import { WebPushService } from './web-push.service';

@Resolver()
export class PushResolver {
  constructor(
    private readonly webPushService: WebPushService,
    private readonly usersService: UsersService,
  ) {}

  // Deliberately not behind @UseGuards(AuthGuard) — the public VAPID key
  // is, by definition, public (it's sent to every push service provider on
  // every send), and the frontend needs it before a person has necessarily
  // done anything else. Returns null (not an error) when unconfigured, the
  // same "isConfigured() gate, null/no-op otherwise" pattern
  // AnthropicClient's own isConfigured() already established for a missing
  // key.
  @Query(() => String, { nullable: true })
  vapidPublicKey(): string | null {
    return this.webPushService.getPublicKey();
  }

  @Mutation(() => RegisterPushSubscriptionPayload)
  @UseGuards(AuthGuard)
  async registerPushSubscription(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: RegisterPushSubscriptionInput,
  ): Promise<RegisterPushSubscriptionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      await this.webPushService.register(user.id, input);
      return { registered: true, errors: [] };
    } catch {
      return {
        registered: false,
        errors: [{ code: 'REGISTER_FAILED', message: "We couldn't enable browser notifications. Try again." }],
      };
    }
  }

  @Mutation(() => UnregisterPushSubscriptionPayload)
  @UseGuards(AuthGuard)
  async unregisterPushSubscription(
    @CurrentAuth() auth: AuthContext,
    @Args('endpoint') endpoint: string,
  ): Promise<UnregisterPushSubscriptionPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      await this.webPushService.unregister(user.id, endpoint);
      return { unregistered: true, errors: [] };
    } catch {
      return {
        unregistered: false,
        errors: [{ code: 'UNREGISTER_FAILED', message: "We couldn't turn off browser notifications. Try again." }],
      };
    }
  }

  // On-demand diagnostic increment (2026-08-19, explicit user request): lets
  // someone confirm their own device's push subscription actually works
  // right now, instead of waiting for the next naturally-scheduled habit or
  // routine reminder to find out. Deliberately bypasses everything
  // NotificationsService.create() applies for a real reminder — quiet
  // hours, the pushNotificationsEnabled preference, same-type batching —
  // since none of that is relevant to "can a push reach this device at
  // all," and doesn't write a Notification row either, so a test send can
  // never show up in or interfere with someone's real notification history.
  @Mutation(() => SendTestNotificationPayload)
  @UseGuards(AuthGuard)
  async sendTestNotification(@CurrentAuth() auth: AuthContext): Promise<SendTestNotificationPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const subscriptionCount = await this.webPushService.subscriptionCount(user.id);
      if (subscriptionCount === 0) {
        return { sent: false, subscriptionCount: 0, errors: [] };
      }
      await this.webPushService.sendToUser(user.id, {
        title: 'Test notification',
        body: "If you can see this, push notifications are working on this device.",
        deeplink: '/notifications',
      });
      return { sent: true, subscriptionCount, errors: [] };
    } catch {
      return {
        sent: false,
        subscriptionCount: 0,
        errors: [{ code: 'SEND_TEST_FAILED', message: "We couldn't send a test notification. Try again." }],
      };
    }
  }
}
