import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

@InputType()
export class ConnectAppleCalendarInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  appleId!: string;

  // Not IsEmail-validated on appleId above — some iCloud accounts are
  // @icloud.com/@me.com/@mac.com addresses, all valid emails, but Apple's
  // own docs just call this "your Apple ID," so this stays a plain
  // non-empty string rather than assuming an email shape.
  @Field()
  @IsString()
  @IsNotEmpty()
  appSpecificPassword!: string;
}
