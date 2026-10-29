import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../auth/auth.controller';
import { AuthenticatedRequest, AuthUser, CurrentUser } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { driverProfiles, passengerProfiles, userRoles, users } from '../database/schema';

export const SUPPORTED_LANGUAGES = ['en-IN', 'hi-IN'];

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(/^[\p{L}\p{M} .'-]+$/u, { message: 'fullName contains unsupported characters' })
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  preferredLanguage?: string;
}

export class AcceptTermsDto {
  @IsString()
  @Length(1, 40)
  termsVersion: string;
}

export class MeResponse {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  preferredLanguage: string;
  roles: string[];
  passenger: { eligibilityStatus: string; termsAccepted: boolean } | null;
  currentTermsVersion: string;
  driver: { status: string } | null;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly env: Env,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.userId));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Account not found');
    const roles = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.userId));
    const [passenger] = await this.db
      .select({
        eligibilityStatus: passengerProfiles.eligibilityStatus,
        termsVersion: passengerProfiles.termsVersionAccepted,
      })
      .from(passengerProfiles)
      .where(eq(passengerProfiles.userId, user.userId));
    const [driver] = await this.db
      .select({ status: driverProfiles.status })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, user.userId));
    return {
      id: row.id,
      phone: row.phoneE164,
      fullName: row.fullName,
      email: row.email,
      preferredLanguage: row.preferredLanguage,
      roles: roles.map((r) => r.role),
      passenger: passenger
        ? {
            eligibilityStatus: passenger.eligibilityStatus,
            termsAccepted: passenger.termsVersion === this.env.TERMS_VERSION,
          }
        : null,
      driver: driver ?? null,
      currentTermsVersion: this.env.TERMS_VERSION,
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMeDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MeResponse> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    ) as UpdateMeDto;
    if (Object.keys(changes).length) {
      await this.db.update(users).set(changes).where(eq(users.id, user.userId));
      await this.audit.record({
        actorType: 'USER',
        actorId: user.userId,
        action: 'user.profile_updated',
        entityType: 'user',
        entityId: user.userId,
        ...clientInfo(req),
        metadata: { fields: Object.keys(changes) },
      });
    }
    return this.me(user);
  }

  /** Records acceptance of the current terms and privacy notice (required before booking). */
  @Post('terms')
  @HttpCode(200)
  async acceptTerms(
    @CurrentUser() user: AuthUser,
    @Body() dto: AcceptTermsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MeResponse> {
    if (dto.termsVersion !== this.env.TERMS_VERSION) {
      throw new AppError(409, 'TERMS_VERSION_OUTDATED', 'Please review the latest terms', {
        currentTermsVersion: this.env.TERMS_VERSION,
      });
    }
    const now = new Date();
    const updated = await this.db
      .update(passengerProfiles)
      .set({
        termsVersionAccepted: dto.termsVersion,
        termsAcceptedAt: now,
        privacyVersionAccepted: dto.termsVersion,
      })
      .where(eq(passengerProfiles.userId, user.userId))
      .returning({ userId: passengerProfiles.userId });
    if (!updated.length)
      throw new AppError(403, 'NOT_A_PASSENGER', 'Only passengers accept rider terms');
    await this.audit.record({
      actorType: 'USER',
      actorId: user.userId,
      action: 'user.terms_accepted',
      entityType: 'user',
      entityId: user.userId,
      ...clientInfo(req),
      metadata: { termsVersion: dto.termsVersion },
    });
    return this.me(user);
  }
}
