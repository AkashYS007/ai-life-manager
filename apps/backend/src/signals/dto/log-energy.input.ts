import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, Max, Min } from 'class-validator';

@InputType()
export class LogEnergyInput {
  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5)
  energyScore!: number;
}
