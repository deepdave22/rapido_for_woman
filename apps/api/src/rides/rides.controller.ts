import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { Idempotent } from '../common/idempotency/idempotency';
import { DispatchService } from '../dispatch/dispatch.service';
import { QuotesService } from './quotes.service';
import {
  BookRideDto,
  CancelRideDto,
  HistoryQueryDto,
  QuoteRequestDto,
  VerifyPinDto,
} from './rides.dto';
import { RidesService } from './rides.service';

@ApiTags('rides (passenger)')
@ApiBearerAuth()
@Roles('PASSENGER')
@Controller({ path: 'rides', version: '1' })
export class PassengerRidesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly rides: RidesService,
  ) {}

  /** Prices the trip for each ride type. Amounts are integer paise. */
  @Post('quotes')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteRequestDto) {
    return this.quotes.quote(user.userId, dto);
  }

  /** Books a quote and starts looking for a driver. Send a unique Idempotency-Key per booking. */
  @Post()
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  book(@CurrentUser() user: AuthUser, @Body() dto: BookRideDto) {
    return this.rides.book(user.userId, dto.quoteId, dto.paymentMethod);
  }

  /** `{ ride: null }` when there is no live ride. */
  @Get('active')
  async active(@CurrentUser() user: AuthUser) {
    return { ride: await this.rides.activeForPassenger(user.userId) };
  }

  @Get()
  history(@CurrentUser() user: AuthUser, @Query() q: HistoryQueryDto) {
    return this.rides.historyForPassenger(user.userId, q.limit, q.before);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.getForPassenger(user.userId, id);
  }

  /** Cancels the ride. A fee may apply once a driver has been assigned for a while. */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.rides.cancelByPassenger(user.userId, id, dto.reason);
  }
}

@ApiTags('rides (driver)')
@ApiBearerAuth()
@Roles('DRIVER')
@Controller({ path: 'driver', version: '1' })
export class DriverRidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly dispatch: DispatchService,
  ) {}

  /** `{ offer: null }` when nothing is pending (offers are also pushed over the socket). */
  @Get('offers/current')
  async currentOffer(@CurrentUser() user: AuthUser) {
    return { offer: await this.dispatch.currentOffer(user.userId) };
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.dispatch.accept(user.userId, id);
    return this.rides.activeForDriver(user.userId);
  }

  @Post('offers/:id/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.dispatch.reject(user.userId, id);
  }

  /** `{ ride: null }` when the driver has no current ride. */
  @Get('rides/active')
  async active(@CurrentUser() user: AuthUser) {
    return { ride: await this.rides.activeForDriver(user.userId) };
  }

  @Get('rides')
  history(@CurrentUser() user: AuthUser, @Query() q: HistoryQueryDto) {
    return this.rides.historyForDriver(user.userId, q.limit, q.before);
  }

  @Post('rides/:id/arriving')
  @HttpCode(200)
  arriving(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.markArriving(user.userId, id);
  }

  /** Requires a fresh location within 500 m of the pickup. */
  @Post('rides/:id/arrived')
  @HttpCode(200)
  arrived(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.markArrived(user.userId, id);
  }

  @Post('rides/:id/verify-pin')
  @HttpCode(200)
  verifyPin(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyPinDto,
  ) {
    return this.rides.verifyPin(user.userId, id, dto.pin);
  }

  @Post('rides/:id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.start(user.userId, id);
  }

  @Post('rides/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rides.complete(user.userId, id);
  }

  /** Before pickup only. The ride is re-dispatched to another driver. */
  @Post('rides/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.rides.cancelByDriver(user.userId, id, dto.reason);
  }
}
