import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, Matches } from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
// E.164: a leading +, then 1-15 digits, the first non-zero — the exact
// format Twilio's own API requires for both the `To` and `From` numbers
// (see sms.service.ts), so validating it here means a malformed number
// never even reaches a real API call.
const E164 = /^\+[1-9]\d{1,14}$/;

// Full set of preference fields, all optional (undefined = leave unchanged,
// same convention UpdateTaskInput already uses) — a real GraphQL `null`
// explicitly clears quietHoursStart/End back to "no quiet hours configured"
// (Prisma distinguishes undefined from null on writes), since there's no
// other way to turn quiet hours back off once set.
@InputType()
export class UpdateNotificationPreferencesInput {
  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'quietHoursStart must be in 24-hour HH:mm format' })
  quietHoursStart?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'quietHoursEnd must be in 24-hour HH:mm format' })
  quietHoursEnd?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  pushNotificationsEnabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  smsNotificationsEnabled?: boolean;

  // SMS delivery increment. A real GraphQL `null` explicitly clears a
  // saved number back to "none on file" — same undefined-vs-null
  // convention quietHoursStart/End already use above — but an actually
  // *present* value must be a real E.164 number, not free text, since it
  // goes straight into a real Twilio API call.
  @Field({ nullable: true })
  @IsOptional()
  @Matches(E164, { message: 'phoneNumber must be in E.164 format, e.g. +15551234567' })
  phoneNumber?: string;
}
