import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

// Mirrors journal_entries (Database Design Document §4.5). sentimentScore
// is nullable — populated synchronously right when an entry is created
// (JournalService.create, via AnthropicClient.analyzeSentiment) whenever
// ANTHROPIC_API_KEY is configured; stays null otherwise, or if that
// best-effort scoring call fails, or for any entry written before this
// increment shipped. -1.0 (very negative) to 1.0 (very positive); see
// MemoryService.refreshJournalSentimentPattern for the aggregate trend fact
// derived from a run of these scores.
@ObjectType()
export class JournalEntry {
  @Field(() => ID)
  id!: string;

  @Field()
  content!: string;

  @Field(() => Float, { nullable: true })
  sentimentScore?: number;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class JournalEntryEdge {
  @Field()
  cursor!: string;

  @Field(() => JournalEntry)
  node!: JournalEntry;
}
