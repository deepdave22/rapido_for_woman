import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { maskIndianMobile } from '@saheli/domain';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  driverAvailability,
  driverDocuments,
  driverLocations,
  driverProfiles,
  driverVerifications,
  rides,
  users,
  vehicles,
} from '../database/schema';
import { REQUIRED_CHECKS, requiredDocuments } from '../drivers/driver-eligibility.service';
import { ObjectStorage, STORAGE } from '../integrations/storage';
import { EarningsService } from '../payments/earnings.service';
import { CurrentStaff, StaffAuth, StaffPrincipal } from './staff-auth';

export class ListQuery {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  q?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

class DocumentReviewDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 300)
  reason?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn?: string;
}

class CheckResultDto {
  @IsIn(['PASSED', 'FAILED'])
  status: 'PASSED' | 'FAILED';

  /** e.g. "manual-review", or the verification vendor's name. */
  @IsString()
  @Length(2, 60)
  provider: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  providerReference?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

class DriverDecisionDto {
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE'])
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE';

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

const PII_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SAFETY'] as const;
const canSeePii = (s: StaffPrincipal) =>
  s.roles.some((r) => (PII_ROLES as readonly string[]).includes(r));

@Injectable()
export class AdminDriversService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Verification checks and documents are complete, regardless of current profile status. */
  async verificationGaps(driverId: string): Promise<string[]> {
    const gaps: string[] = [];
    const checks = await this.db
      .select()
      .from(driverVerifications)
      .where(eq(driverVerifications.driverId, driverId))
      .orderBy(desc(driverVerifications.createdAt));
    for (const c of REQUIRED_CHECKS) {
      if (checks.find((x) => x.check === c)?.status !== 'PASSED') gaps.push(`CHECK_${c}`);
    }
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, driverId))
      .limit(1);
    if (!vehicle) gaps.push('NO_VEHICLE');
    const docs = await this.db
      .select()
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverId))
      .orderBy(desc(driverDocuments.createdAt));
    for (const t of requiredDocuments(vehicle?.categoryCode ?? null)) {
      if (docs.find((d) => d.type === t)?.status !== 'APPROVED') gaps.push(`DOCUMENT_${t}`);
    }
    return gaps;
  }

  async decide(staff: StaffPrincipal, driverId: string, dto: DriverDecisionDto) {
    const [profile] = await this.db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId));
    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Driver not found');
    const requireReason = dto.decision === 'REJECT' || dto.decision === 'SUSPEND';
    if (requireReason && !dto.reason) throw new AppError(400, 'REASON_REQUIRED', 'Give a reason');

    const allowedFrom: Record<DriverDecisionDto['decision'], string[]> = {
      APPROVE: ['PENDING_REVIEW'],
      REJECT: ['PENDING_REVIEW'],
      SUSPEND: ['APPROVED'],
      REACTIVATE: ['SUSPENDED'],
    };
    if (!allowedFrom[dto.decision].includes(profile.status)) {
      throw new AppError(
        409,
        'INVALID_DRIVER_TRANSITION',
        `Cannot ${dto.decision.toLowerCase()} a driver who is ${profile.status}`,
      );
    }
    if (dto.decision === 'APPROVE' || dto.decision === 'REACTIVATE') {
      const gaps = await this.verificationGaps(driverId);
      if (gaps.length) {
        throw new AppError(
          422,
          'VERIFICATION_INCOMPLETE',
          'All checks and documents must pass first',
          { gaps },
        );
      }
    }

    await this.db.transaction(async (tx) => {
      if (dto.decision === 'SUSPEND') {
        const [busy] = await tx
          .select({ id: driverAvailability.activeRideId })
          .from(driverAvailability)
          .where(
            and(
              eq(driverAvailability.driverId, driverId),
              sql`${driverAvailability.activeRideId} IS NOT NULL`,
            ),
          );
        if (busy) {
          throw new AppError(
            409,
            'ACTIVE_RIDE',
            'The driver has an active ride. Cancel or finish it first',
          );
        }
        await tx
          .update(driverAvailability)
          .set({ isOnline: false })
          .where(eq(driverAvailability.driverId, driverId));
        await tx.delete(driverLocations).where(eq(driverLocations.driverId, driverId));
      }
      const status =
        dto.decision === 'APPROVE' || dto.decision === 'REACTIVATE'
          ? 'APPROVED'
          : dto.decision === 'REJECT'
            ? 'REJECTED'
            : 'SUSPENDED';
      await tx
        .update(driverProfiles)
        .set({
          status,
          statusReason: dto.reason ?? null,
          ...(dto.decision === 'APPROVE'
            ? { approvedAt: new Date(), approvedBy: staff.staffId }
            : {}),
        })
        .where(eq(driverProfiles.userId, driverId));
      if (status === 'APPROVED') {
        await tx.update(vehicles).set({ status: 'ACTIVE' }).where(eq(vehicles.driverId, driverId));
      }
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.staffId,
          action: `driver.${dto.decision.toLowerCase()}`,
          entityType: 'driver',
          entityId: driverId,
          metadata: { from: profile.status },
        },
        tx,
      );
    });
    return {
      driverId,
      status: (
        await this.db
          .select({ s: driverProfiles.status })
          .from(driverProfiles)
          .where(eq(driverProfiles.userId, driverId))
      )[0]!.s,
    };
  }
}

@ApiTags('admin: drivers')
@Controller({ path: 'admin', version: '1' })
export class AdminDriversController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly drivers: AdminDriversService,
    private readonly earnings: EarningsService,
    private readonly audit: AuditService,
  ) {}

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('drivers')
  async list(@CurrentStaff() staff: StaffPrincipal, @Query() q: ListQuery) {
    const search = q.q ? `%${q.q.replace(/[%_]/g, '')}%` : null;
    const where = and(
      q.status ? sql`${driverProfiles.status} = ${q.status}` : undefined,
      search
        ? or(
            ilike(users.fullName, search),
            ilike(users.phoneE164, search),
            ilike(vehicles.registrationNumber, search),
          )
        : undefined,
    );
    const rows = await this.db
      .select({
        id: driverProfiles.userId,
        name: users.fullName,
        phone: users.phoneE164,
        status: driverProfiles.status,
        submittedAt: driverProfiles.submittedAt,
        ratingSum: driverProfiles.ratingSum,
        ratingCount: driverProfiles.ratingCount,
        vehicle: vehicles.registrationNumber,
        category: vehicles.categoryCode,
        online: driverAvailability.isOnline,
      })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .leftJoin(vehicles, eq(vehicles.driverId, driverProfiles.userId))
      .leftJoin(driverAvailability, eq(driverAvailability.driverId, driverProfiles.userId))
      .where(where)
      .orderBy(desc(driverProfiles.submittedAt))
      .limit(q.limit ?? 50)
      .offset(q.offset ?? 0);
    return rows.map((r) => ({
      ...r,
      phone: canSeePii(staff) ? r.phone : maskIndianMobile(r.phone),
      rating: r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : null,
    }));
  }

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('drivers/:id')
  async detail(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const [d] = await this.db
      .select({ profile: driverProfiles, user: users })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(eq(driverProfiles.userId, id));
    if (!d) throw new AppError(404, 'NOT_FOUND', 'Driver not found');
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.driverId, id))
      .limit(1);
    const docs = await this.db
      .select({
        id: driverDocuments.id,
        type: driverDocuments.type,
        status: driverDocuments.status,
        mimeType: driverDocuments.mimeType,
        sizeBytes: driverDocuments.sizeBytes,
        expiresOn: driverDocuments.expiresOn,
        rejectionReason: driverDocuments.rejectionReason,
        createdAt: driverDocuments.createdAt,
      })
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, id))
      .orderBy(desc(driverDocuments.createdAt));
    const checks = await this.db
      .select()
      .from(driverVerifications)
      .where(eq(driverVerifications.driverId, id))
      .orderBy(desc(driverVerifications.createdAt));
    const [stats] = await this.db
      .select({
        completed: sql<number>`count(*) FILTER (WHERE ${rides.status} = 'COMPLETED')::int`,
        total: count(),
      })
      .from(rides)
      .where(eq(rides.driverId, id));
    return {
      id,
      name: d.user.fullName,
      phone: canSeePii(staff) ? d.user.phoneE164 : maskIndianMobile(d.user.phoneE164),
      accountStatus: d.user.status,
      status: d.profile.status,
      statusReason: d.profile.statusReason,
      submittedAt: d.profile.submittedAt,
      approvedAt: d.profile.approvedAt,
      rating: d.profile.ratingCount
        ? Math.round((d.profile.ratingSum / d.profile.ratingCount) * 10) / 10
        : null,
      ratingCount: d.profile.ratingCount,
      vehicle: vehicle ?? null,
      documents: docs,
      checks: checks.map((c) => ({
        id: c.id,
        check: c.check,
        status: c.status,
        provider: c.provider,
        notes: c.notes,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
      verificationGaps: await this.drivers.verificationGaps(id),
      rides: stats,
      balance: await this.earnings.balance(id),
    };
  }

  /** Streams an identity document. Restricted, never cached, and every view is audited. */
  @StaffAuth('OPERATIONS')
  @Get('documents/:id/content')
  @Header('Cache-Control', 'no-store')
  async document(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const [doc] = await this.db.select().from(driverDocuments).where(eq(driverDocuments.id, id));
    if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'driver_document.viewed',
      entityType: 'driver_document',
      entityId: id,
      metadata: { driverId: doc.driverId, type: doc.type },
    });
    return new StreamableFile(await this.storage.get(doc.storageKey), {
      type: doc.mimeType,
      disposition: 'inline',
    });
  }

  @StaffAuth('OPERATIONS')
  @Post('documents/:id/review')
  @HttpCode(200)
  async reviewDocument(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DocumentReviewDto,
  ) {
    if (!dto.approve && !dto.reason)
      throw new AppError(400, 'REASON_REQUIRED', 'Say why the document was rejected');
    const [doc] = await this.db
      .update(driverDocuments)
      .set({
        status: dto.approve ? 'APPROVED' : 'REJECTED',
        rejectionReason: dto.approve ? null : dto.reason!,
        reviewedBy: staff.staffId,
        reviewedAt: new Date(),
        ...(dto.expiresOn ? { expiresOn: dto.expiresOn } : {}),
      })
      .where(eq(driverDocuments.id, id))
      .returning({
        id: driverDocuments.id,
        driverId: driverDocuments.driverId,
        status: driverDocuments.status,
      });
    if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: dto.approve ? 'driver_document.approved' : 'driver_document.rejected',
      entityType: 'driver_document',
      entityId: id,
      metadata: { driverId: doc.driverId },
    });
    return doc;
  }

  /** Records the outcome of one verification check (manual review or a vendor result). */
  @StaffAuth('OPERATIONS')
  @Post('drivers/:id/checks/:check')
  async recordCheck(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('check') check: string,
    @Body() dto: CheckResultDto,
  ) {
    if (!(REQUIRED_CHECKS as readonly string[]).includes(check) && check !== 'PAYOUT_ACCOUNT') {
      throw new AppError(400, 'UNKNOWN_CHECK', 'Unknown verification check');
    }
    const [profile] = await this.db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, id));
    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Driver not found');
    const [row] = await this.db
      .insert(driverVerifications)
      .values({
        driverId: id,
        check: check as (typeof REQUIRED_CHECKS)[number],
        status: dto.status,
        provider: dto.provider,
        providerReference: dto.providerReference ?? null,
        notes: dto.notes ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        reviewedBy: staff.staffId,
        reviewedAt: new Date(),
      })
      .returning({
        id: driverVerifications.id,
        check: driverVerifications.check,
        status: driverVerifications.status,
      });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'driver.check_recorded',
      entityType: 'driver',
      entityId: id,
      metadata: { check, status: dto.status },
    });
    return row;
  }

  @StaffAuth('OPERATIONS')
  @Post('drivers/:id/decision')
  @HttpCode(200)
  decide(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DriverDecisionDto,
  ) {
    return this.drivers.decide(staff, id, dto);
  }
}
