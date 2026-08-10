import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { RegisterPushSubscriptionInput } from './dto/register-push-subscription.input';
import { RegisterPushSubscriptionPayload, UnregisterPushSubscriptionPayload } from './models/push-subscription.payload';
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
}
