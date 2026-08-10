import { Field, ObjectType } from '@nestjs/graphql';
import { TaskEdge } from './task.model';
import { PageInfo } from '../../common/graphql/page-info.model';

// Relay-style connection (API Design Document §3, §5.1) for the root-level
// `tasks` query — the dashboard's `todayPlan.tasks` field returns a plain
// list instead, since that set is naturally bounded (PRD §7.1).
@ObjectType()
export class TaskConnection {
  @Field(() => [TaskEdge])
  edges!: TaskEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
