import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { CalendarEvent } from './models/calendar-event.model';
import { CalendarEventConnection } from './models/calendar-event-connection.model';
import {
  CreateCalendarEventPayload,
  UpdateCalendarEventPayload,
  DeleteCalendarEventPayload,
} from './models/calendar-event.payload';
import { CreateCalendarEventInput } from './dto/create-calendar-event.input';
import { UpdateCalendarEventInput } from './dto/update-calendar-event.input';
import { CalendarService } from './calendar.service';
import { GoogleReconnectRequiredError } from '../integrations/google/google-calendar-write.service';
import { MicrosoftReconnectRequiredError } from '../integrations/microsoft/microsoft-calendar-write.service';

// Same ownership discipline as TasksResolver: `auth.authProviderId` is the
// external Clerk/dev-auth identity, never the row-scoping key. Every method
// resolves the internal `users.id` first via UsersService.
@Resolver(() => CalendarEvent)
@UseGuards(AuthGuard)
export class CalendarResolver {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly usersService: UsersService,
  ) {}

  // Practical range query for a day/week view — see CalendarService.listInRange
  // for why this isn't Relay-paginated.
  @Query(() => [CalendarEvent])
  async calendarEventsInRange(
    @CurrentAuth() auth: AuthContext,
    @Args('start') start: Date,
    @Args('end') end: Date,
  ): Promise<CalendarEvent[]> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.calendarService.listInRange(user.id, start, end);
  }

  // Matches the `calendarEvents` connection called out in the API Design
  // Document §3 — full history, cursor-paginated, for a dedicated
  // "all events" list rather than a bounded day/week view.
  @Query(() => CalendarEventConnection)
  async calendarEvents(
    @CurrentAuth() auth: AuthContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
  ): Promise<CalendarEventConnection> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return this.calendarService.listConnection(user.id, { first, after }) as any;
  }

  @Mutation(() => CreateCalendarEventPayload)
  async createCalendarEvent(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CreateCalendarEventInput,
  ): Promise<CreateCalendarEventPayload> {
    if (input.endTime <= input.startTime) {
      return {
        errors: [
          {
            field: 'endTime',
            code: 'INVALID_RANGE',
            message: 'End time must be after the start time.',
          },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const event = await this.calendarService.create(user.id, input);
      return { event, errors: [] };
    } catch {
      return { errors: [{ code: 'CREATE_FAILED', message: "We couldn't create that event. Try again." }] };
    }
  }

  @Mutation(() => UpdateCalendarEventPayload)
  async updateCalendarEvent(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCalendarEventInput,
  ): Promise<UpdateCalendarEventPayload> {
    if (input.startTime && input.endTime && input.endTime <= input.startTime) {
      return {
        errors: [
          {
            field: 'endTime',
            code: 'INVALID_RANGE',
            message: 'End time must be after the start time.',
          },
        ],
      };
    }
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const event = await this.calendarService.update(user.id, id, input);
      return { event, errors: [] };
    } catch (error) {
      // Push-edits-back increment: same RECONNECT_REQUIRED mapping
      // deleteCalendarEvent below already has, for the same reason — an
      // account connected before either provider's write-scope widened
      // needs a real reconnect, not a retry.
      if (error instanceof GoogleReconnectRequiredError || error instanceof MicrosoftReconnectRequiredError) {
        return { errors: [{ code: 'RECONNECT_REQUIRED', message: error.message }] };
      }
      return { errors: [{ code: 'UPDATE_FAILED', message: "We couldn't save those changes. Try again." }] };
    }
  }

  @Mutation(() => DeleteCalendarEventPayload)
  async deleteCalendarEvent(
    @CurrentAuth() auth: AuthContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteCalendarEventPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const deletedEventId = await this.calendarService.delete(user.id, id);
      return { deletedEventId, errors: [] };
    } catch (error) {
      if (error instanceof GoogleReconnectRequiredError || error instanceof MicrosoftReconnectRequiredError) {
        return { errors: [{ code: 'RECONNECT_REQUIRED', message: error.message }] };
      }
      return { errors: [{ code: 'DELETE_FAILED', message: "We couldn't delete that event. Try again." }] };
    }
  }
}
