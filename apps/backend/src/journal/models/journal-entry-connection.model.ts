import { Field, ObjectType } from '@nestjs/graphql';
import { JournalEntryEdge } from './journal-entry.model';
import { PageInfo } from '../../common/graphql/page-info.model';

// Relay-style connection, same reasoning as TaskConnection/CalendarEventConnection
// — a personal journal is exactly the kind of table that keeps growing for
// as long as someone uses the app, so cursor pagination (not a bounded
// "recent N" list) is the right shape here.
@ObjectType()
export class JournalEntryConnection {
  @Field(() => [JournalEntryEdge])
  edges!: JournalEntryEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
