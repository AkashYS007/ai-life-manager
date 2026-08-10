import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

// Mirrors AiMessage in the API Design Document §4.4 / MessageRole enum.
// TOOL is a reserved value (this increment's chat can only talk, not take
// actions) — same zero-cost forward-compat pattern used throughout this
// codebase (CalendarEventSource, PlanChangeType, etc.).
export enum ChatMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  TOOL = 'TOOL',
}
registerEnumType(ChatMessageRole, { name: 'ChatMessageRole' });

@ObjectType()
export class AiMessage {
  @Field(() => ID)
  id!: string;

  @Field(() => ChatMessageRole)
  role!: ChatMessageRole;

  @Field()
  content!: string;

  @Field()
  createdAt!: Date;
}
