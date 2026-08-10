import { Inject, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { AiConversation } from './models/ai-conversation.model';
import { SendChatMessagePayload } from './models/chat.payload';
import { ChatStreamChunk } from './models/chat-stream-chunk.model';
import { ChatMessageRole } from './models/chat-message.model';
import { ChatService } from './chat.service';

// Same ownership discipline as every other resolver: resolve the internal
// users.id first, never scope by the raw auth identity.
@Resolver()
@UseGuards(AuthGuard)
export class ChatResolver {
  constructor(
    private readonly chatService: ChatService,
    private readonly usersService: UsersService,
    @Inject('PUB_SUB') private readonly pubSub: PubSub,
  ) {}

  @Query(() => [AiConversation])
  async aiConversations(@CurrentAuth() auth: AuthContext): Promise<AiConversation[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.chatService.listForUser(user.id);
  }

  @Query(() => AiConversation, { nullable: true })
  async aiConversation(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AiConversation | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    try {
      return await this.chatService.getConversation(user.id, id);
    } catch {
      return null;
    }
  }

  @Mutation(() => SendChatMessagePayload)
  async sendChatMessage(
    @CurrentAuth() auth: AuthContext,
    @Args('content') content: string,
    @Args('conversationId', { type: () => ID, nullable: true }) conversationId?: string,
  ): Promise<SendChatMessagePayload> {
    if (!this.chatService.isConfigured()) {
      return {
        errors: [
          {
            code: 'AI_NOT_CONFIGURED',
            message: 'Chat needs an Anthropic API key configured on the server first (see README).',
          },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const conversation = await this.chatService.sendMessage(user.id, user.timezone, content, conversationId);
      return { conversation, errors: [] };
    } catch (error) {
      if ((error as Error).message === 'EMPTY_MESSAGE') {
        return { errors: [{ field: 'content', code: 'EMPTY_MESSAGE', message: "Message can't be empty." }] };
      }
      return { errors: [{ code: 'SEND_FAILED', message: "We couldn't send that message. Try again." }] };
    }
  }

  // Real-time chat streaming increment, extended by Tool-calling actions in
  // Chat to also carry a `role` on every published chunk (see
  // ChatStreamChunk's own comment) — ASSISTANT for the model's own streamed
  // words, TOOL for one real action having just been executed server-side.
  // Same errors, same final return shape as sendChatMessage above — the
  // plain sendChatMessage mutation is still untouched and fully functional
  // on its own, this is a genuinely additive second path.
  @Mutation(() => SendChatMessagePayload)
  async sendChatMessageStreaming(
    @CurrentAuth() auth: AuthContext,
    @Args('content') content: string,
    @Args('requestId') requestId: string,
    @Args('conversationId', { type: () => ID, nullable: true }) conversationId?: string,
  ): Promise<SendChatMessagePayload> {
    if (!this.chatService.isConfigured()) {
      return {
        errors: [
          {
            code: 'AI_NOT_CONFIGURED',
            message: 'Chat needs an Anthropic API key configured on the server first (see README).',
          },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const conversation = await this.chatService.sendMessageStreaming(
        user.id,
        user.timezone,
        content,
        conversationId,
        (role, text) => {
          this.pubSub.publish('chatStreamChunk', {
            chatStreamChunk: {
              requestId,
              role: role === 'TOOL' ? ChatMessageRole.TOOL : ChatMessageRole.ASSISTANT,
              delta: text,
              done: false,
            },
          });
        },
      );
      // One final marker event with an empty delta — the one thing a
      // subscriber actually needs from it is `done: true`, the cue to stop
      // appending locally-accumulated text and trust this mutation's own
      // returned `conversation` (already fully persisted by this point) as
      // the authoritative version instead. `role` is irrelevant on this one
      // (nothing renders it), ASSISTANT is just a harmless, valid default.
      this.pubSub.publish('chatStreamChunk', {
        chatStreamChunk: { requestId, role: ChatMessageRole.ASSISTANT, delta: '', done: true },
      });
      return { conversation, errors: [] };
    } catch (error) {
      this.pubSub.publish('chatStreamChunk', {
        chatStreamChunk: { requestId, role: ChatMessageRole.ASSISTANT, delta: '', done: true },
      });
      if ((error as Error).message === 'EMPTY_MESSAGE') {
        return { errors: [{ field: 'content', code: 'EMPTY_MESSAGE', message: "Message can't be empty." }] };
      }
      return { errors: [{ code: 'SEND_FAILED', message: "We couldn't send that message. Try again." }] };
    }
  }

  // No @UseGuards override needed here — the class-level @UseGuards(AuthGuard)
  // above already applies to this subscription the same as every query/
  // mutation on this resolver, and AuthGuard itself is fully
  // transport-aware now (see its own comment): a WebSocket connection is
  // authenticated once at connect time (app.module.ts's onConnect), not
  // per-subscription, so this never re-checks anything, it just requires
  // that upstream check to have already passed. `filter` scopes the
  // shared 'chatStreamChunk' pub/sub topic down to only the one request a
  // given subscriber actually asked about — every concurrent chat send
  // across every user publishes onto the same topic, so without this a
  // subscriber would see everyone's chunks, not just their own.
  @Subscription(() => ChatStreamChunk, {
    filter: (payload: { chatStreamChunk: ChatStreamChunk }, variables: { requestId: string }) =>
      payload.chatStreamChunk.requestId === variables.requestId,
  })
  chatStreamChunk(@Args('requestId') requestId: string) {
    // `graphql-subscriptions` v2's real, exported API is `asyncIterator`
    // (a slightly misleading name held over from an older version — the
    // object it actually returns fully implements Symbol.asyncIterator,
    // `next`/`return`/`throw`, everything graphql-js 16's subscribe()
    // requires, confirmed directly against the installed package's own
    // source rather than assumed) — not `asyncIterableIterator`, a method
    // that doesn't exist on this version and would fail at the first
    // subscription attempt.
    return this.pubSub.asyncIterator('chatStreamChunk');
  }
}
