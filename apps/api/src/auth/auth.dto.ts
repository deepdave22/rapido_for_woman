import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import type { ClientApp } from './auth.decorators';

const APPS: ClientApp[] = ['PASSENGER', 'DRIVER'];

export class RequestOtpDto {
  /** Indian mobile number in any common format, e.g. "98765 43210" or "+919876543210". */
  @IsString()
  @MaxLength(20)
  phone: string;
}

export class RequestOtpResponse {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export class VerifyOtpDto {
  @IsUUID()
  challengeId: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  /** Which app is signing in. Determines the role granted to the session. */
  @IsIn(APPS)
  app: ClientApp;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class TokenResponse {
  accessToken: string;
  /** Opaque; rotates on every refresh. Store in secure device storage only. */
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  isNewUser: boolean;
  user: { id: string; roles: string[] };
}

export class SessionView {
  id: string;
  app: ClientApp;
  deviceName: string | null;
  lastUsedAt: Date;
  current: boolean;
}
