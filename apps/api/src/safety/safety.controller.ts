import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth.decorators';
import {
  CreateTicketDto,
  RatingDto,
  ReportIncidentDto,
  SosDto,
  TicketMessageDto,
  TrustedContactDto,
} from './safety.dto';
import { SafetyService } from './safety.service';
import { SupportService } from './support.service';

@ApiTags('safety')
@ApiBearerAuth()
@Controller({ version: '1' })
export class SafetyController {
  constructor(
    private readonly safety: SafetyService,
    private readonly support: SupportService,
  ) {}

  @Roles('PASSENGER')
  @Get('me/trusted-contacts')
  contacts(@CurrentUser() user: AuthUser) {
    return this.safety.listContacts(user.userId);
  }

  @Roles('PASSENGER')
  @Post('me/trusted-contacts')
  addContact(@CurrentUser() user: AuthUser, @Body() dto: TrustedContactDto) {
    return this.safety.addContact(user.userId, dto);
  }

  @Roles('PASSENGER')
  @Delete('me/trusted-contacts/:id')
  @HttpCode(204)
  removeContact(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.removeContact(user.userId, id);
  }

  /**
   * SOS for passengers and drivers. Never throttled away: an emergency must
   * always be recorded. Repeats within 15 minutes update the same incident.
   */
  @SkipThrottle()
  @Post('safety/sos')
  @HttpCode(201)
  sos(@CurrentUser() user: AuthUser, @Body() dto: SosDto) {
    return this.safety.sos(user, dto);
  }

  @Post('safety/incidents')
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportIncidentDto) {
    return this.safety.report(user, dto);
  }

  @Get('safety/incidents')
  myIncidents(@CurrentUser() user: AuthUser) {
    return this.safety.myIncidents(user.userId);
  }

  @Get('safety/incidents/:id')
  incident(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.incidentForReporter(user.userId, id);
  }

  /** Creates an expiring link that lets anyone with it follow this trip. */
  @Roles('PASSENGER')
  @Post('rides/:id/share')
  share(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.createShare(user.userId, id);
  }

  @Roles('PASSENGER')
  @Delete('rides/:id/share')
  @HttpCode(204)
  revokeShare(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.revokeShares(user.userId, id);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public/trips/:token')
  publicTrip(@Param('token') token: string) {
    return this.safety.publicTrip(token.slice(0, 100));
  }

  @Post('rides/:id/rating')
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RatingDto,
  ) {
    return this.safety.rate(user, id, dto.stars, dto.comment);
  }

  @Post('support/tickets')
  createTicket(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user.userId, dto);
  }

  @Get('support/tickets')
  tickets(@CurrentUser() user: AuthUser) {
    return this.support.list(user.userId);
  }

  @Get('support/tickets/:id')
  ticket(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.support.get(user.userId, id);
  }

  @Post('support/tickets/:id/messages')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TicketMessageDto,
  ) {
    return this.support.reply(user.userId, id, dto.body);
  }
}
