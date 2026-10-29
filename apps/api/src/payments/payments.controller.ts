import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Matches } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { Idempotent } from '../common/idempotency/idempotency';
import { EarningsService } from './earnings.service';
import { PaymentsService } from './payments.service';

class PeriodQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

function assertPeriod(q: PeriodQuery): void {
  if (q.to < q.from) throw new AppError(400, 'INVALID_PERIOD', '"to" must not be before "from"');
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
  if (days > 92) throw new AppError(400, 'PERIOD_TOO_LONG', 'Choose a period of at most 92 days');
}

@ApiTags('payments')
@Controller({ version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly earnings: EarningsService,
  ) {}

  /** Starts (or resumes) an online payment for what the ride owes. */
  @ApiBearerAuth()
  @Roles('PASSENGER')
  @Post('rides/:id/payments')
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  start(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.startOnlinePayment(user.userId, id);
  }

  @ApiBearerAuth()
  @Roles('PASSENGER')
  @Get('rides/:id/payments')
  list(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.paymentsForRide(user.userId, id);
  }

  /** Driver confirms cash was received for a completed cash ride. */
  @ApiBearerAuth()
  @Roles('DRIVER')
  @Post('driver/rides/:id/cash-collected')
  @HttpCode(200)
  cash(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.confirmCashCollected(user.userId, id);
  }

  /** Gateway webhook. Authenticated by HMAC signature over the raw body, not by session. */
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Post('payments/webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook(req.rawBody, req.headers);
  }

  @ApiBearerAuth()
  @Roles('DRIVER')
  @Get('driver/earnings')
  summary(@CurrentUser() user: AuthUser, @Query() q: PeriodQuery) {
    assertPeriod(q);
    return this.earnings.summary(user.userId, q.from, q.to);
  }

  @ApiBearerAuth()
  @Roles('DRIVER')
  @Get('driver/earnings/statement.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="saheli-statement.csv"')
  statement(@CurrentUser() user: AuthUser, @Query() q: PeriodQuery) {
    assertPeriod(q);
    return this.earnings.statementCsv(user.userId, q.from, q.to);
  }
}
