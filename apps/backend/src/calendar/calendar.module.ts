import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CalendarResolver } from './calendar.resolver';
import { UsersModule } from '../users/users.module';
import { GoogleOAuthService } from '../integrations/google/google-oauth.service';
import { GoogleCalendarClient } from '../integrations/google/google-calendar-client';
import { GoogleCalendarWriteService } from '../integrations/google/google-calendar-write.service';
import { MicrosoftOAuthService } from '../integrations/microsoft/microsoft-oauth.service';
import { MicrosoftCalendarClient } from '../integrations/microsoft/microsoft-calendar-client';
import { MicrosoftCalendarWriteService } from '../integrations/microsoft/microsoft-calendar-write.service';

// Google's and Microsoft's OAuth/client/write-service triples are declared
// here too (also declared in IntegrationsModule, which owns the read/pull
// side of both integrations) rather than pulled from a shared module — see
// GoogleCalendarWriteService's own comment for why: IntegrationsModule
// already depends on CalendarModule, so importing it back here would be
// circular. All six classes are stateless (no in-memory state — every call
// reads/writes through Prisma or a live fetch), so two independent
// instances across the two modules cost nothing functionally.
@Module({
  imports: [UsersModule],
  providers: [
    CalendarService,
    CalendarResolver,
    GoogleOAuthService,
    GoogleCalendarClient,
    GoogleCalendarWriteService,
    MicrosoftOAuthService,
    MicrosoftCalendarClient,
    MicrosoftCalendarWriteService,
  ],
  exports: [CalendarService],
})
export class CalendarModule {}
