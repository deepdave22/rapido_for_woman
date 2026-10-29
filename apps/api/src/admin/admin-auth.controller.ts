import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../auth/auth.controller';
import { AuthenticatedRequest, Public } from '../auth/auth.decorators';
import { AppError } from '../common/errors';
import { randomToken } from '../common/hashing';
import { DB, Database } from '../database/database.module';
import { staffRoleAssignments, staffSessions, staffUsers } from '../database/schema';
import { CurrentStaff, StaffAuth, StaffAuthService, StaffPrincipal, StaffRole } from './staff-auth';
import { hashPassword } from './staff-crypto';

const ROLES: StaffRole[] = ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'FINANCE', 'SAFETY'];

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

class ChallengeDto {
  @IsString()
  challengeToken: string;
}

class MfaDto extends ChallengeDto {
  @Matches(/^\d{6}$/)
  code: string;
}

class RefreshDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  newPassword: string;
}

class CreateStaffDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 80)
  fullName: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLES, { each: true })
  roles: StaffRole[];
}

class UpdateStaffDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLES, { each: true })
  roles?: StaffRole[];

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

@ApiTags('admin: auth')
@Controller({ path: 'admin', version: '1' })
export class AdminAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest) {
    return this.auth.login(dto.email, dto.password, clientInfo(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/mfa/enroll')
  @HttpCode(200)
  enroll(@Body() dto: ChallengeDto) {
    return this.auth.startEnrollment(dto.challengeToken);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/mfa/verify')
  @HttpCode(200)
  verify(@Body() dto: MfaDto, @Req() req: AuthenticatedRequest) {
    return this.auth.verifyMfa(dto.challengeToken, dto.code, clientInfo(req));
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @StaffAuth()
  @Post('auth/logout')
  @HttpCode(204)
  logout(@CurrentStaff() staff: StaffPrincipal) {
    return this.auth.logout(staff);
  }

  @StaffAuth()
  @Get('me')
  me(@CurrentStaff() staff: StaffPrincipal) {
    return this.auth.me(staff);
  }

  @StaffAuth()
  @Post('auth/password')
  @HttpCode(204)
  changePassword(@CurrentStaff() staff: StaffPrincipal, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(staff, dto.currentPassword, dto.newPassword);
  }

  // ---------- staff management (SUPER_ADMIN) ----------

  @StaffAuth('SUPER_ADMIN')
  @Get('staff')
  async listStaff() {
    const rows = await this.db
      .select({
        id: staffUsers.id,
        email: staffUsers.email,
        fullName: staffUsers.fullName,
        status: staffUsers.status,
        mfaEnrolled: sql<boolean>`${staffUsers.mfaEnrolledAt} IS NOT NULL`,
        lastLoginAt: staffUsers.lastLoginAt,
      })
      .from(staffUsers)
      .orderBy(staffUsers.email);
    const roles = await this.db.select().from(staffRoleAssignments);
    return rows.map((r) => ({
      ...r,
      roles: roles.filter((x) => x.staffUserId === r.id).map((x) => x.role),
    }));
  }

  /** Returns a one-time temporary password; the new staff member must set up MFA at first sign-in. */
  @StaffAuth('SUPER_ADMIN')
  @Post('staff')
  async createStaff(@CurrentStaff() me: StaffPrincipal, @Body() dto: CreateStaffDto) {
    const temporaryPassword = `${randomToken(9)}9a`;
    try {
      const id = await this.db.transaction(async (tx) => {
        const [s] = await tx
          .insert(staffUsers)
          .values({
            email: dto.email,
            fullName: dto.fullName,
            passwordHash: await hashPassword(temporaryPassword),
          })
          .returning({ id: staffUsers.id });
        await tx
          .insert(staffRoleAssignments)
          .values(dto.roles.map((role) => ({ staffUserId: s!.id, role, grantedBy: me.staffId })));
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: me.staffId,
            action: 'staff.created',
            entityType: 'staff_user',
            entityId: s!.id,
            metadata: { roles: dto.roles },
          },
          tx,
        );
        return s!.id;
      });
      return { id, email: dto.email, roles: dto.roles, temporaryPassword };
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new AppError(409, 'STAFF_EXISTS', 'A staff member with this email already exists');
      }
      throw err;
    }
  }

  @StaffAuth('SUPER_ADMIN')
  @Patch('staff/:id')
  async updateStaff(
    @CurrentStaff() me: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    if (
      id === me.staffId &&
      (dto.status === 'DISABLED' || (dto.roles && !dto.roles.includes('SUPER_ADMIN')))
    ) {
      throw new AppError(
        409,
        'CANNOT_DEMOTE_SELF',
        'Ask another super administrator to change your own access',
      );
    }
    await this.db.transaction(async (tx) => {
      const [exists] = await tx
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(eq(staffUsers.id, id));
      if (!exists) throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
      if (dto.status) {
        await tx.update(staffUsers).set({ status: dto.status }).where(eq(staffUsers.id, id));
        if (dto.status === 'DISABLED') {
          await tx
            .update(staffSessions)
            .set({ revokedAt: new Date() })
            .where(eq(staffSessions.staffUserId, id));
        }
      }
      if (dto.roles) {
        await tx.delete(staffRoleAssignments).where(eq(staffRoleAssignments.staffUserId, id));
        await tx
          .insert(staffRoleAssignments)
          .values(dto.roles.map((role) => ({ staffUserId: id, role, grantedBy: me.staffId })));
      }
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: me.staffId,
          action: 'staff.updated',
          entityType: 'staff_user',
          entityId: id,
          metadata: { roles: dto.roles ?? null, status: dto.status ?? null },
        },
        tx,
      );
    });
    return (await this.listStaff()).find((s) => s.id === id);
  }
}
