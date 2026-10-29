import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, AuthUser, CurrentUser, Public } from './auth.decorators';
import {
  RefreshDto,
  RequestOtpDto,
  RequestOtpResponse,
  SessionView,
  TokenResponse,
  VerifyOtpDto,
} from './auth.dto';
import { AuthService, ClientInfo } from './auth.service';

export function clientInfo(req: AuthenticatedRequest): ClientInfo {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: req.id ? String(req.id) : undefined,
  };
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sends a 6-digit login code by SMS. Rate-limited per phone number and per IP. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(202)
  requestOtp(
    @Body() dto: RequestOtpDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RequestOtpResponse> {
    return this.auth.requestOtp(dto.phone, clientInfo(req));
  }

  /** Exchanges a correct code for tokens. Creates the account on first sign-in. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: AuthenticatedRequest): Promise<TokenResponse> {
    return this.auth.verifyOtp(dto, clientInfo(req));
  }

  /** Rotates the refresh token. Clients must not run two refreshes in parallel. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: AuthenticatedRequest): Promise<TokenResponse> {
    return this.auth.refresh(dto.refreshToken, clientInfo(req));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest): Promise<void> {
    return this.auth.logout(user, clientInfo(req));
  }

  /** Signed-in devices for the current account. */
  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser): Promise<SessionView[]> {
    return this.auth.listSessions(user);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.auth.revokeSession(user, id, clientInfo(req));
  }
}
