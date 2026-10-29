import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { validatePricingRule } from '@saheli/domain';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  auditLogs,
  driverPayouts,
  pricingRules,
  promotions,
  refunds,
  serviceZones,
} from '../database/schema';
import { EarningsService } from '../payments/earnings.service';
import { PaymentsService } from '../payments/payments.service';
import { CurrentStaff, StaffAuth, StaffPrincipal } from './staff-auth';

class PricingVersionDto {
  @IsUUID()
  zoneId: string;

  @IsIn(['BIKE', 'AUTO', 'CAB'])
  categoryCode: string;

  /** Defaults to now. A future time schedules the change. */
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsInt() @Min(0) baseFarePaise: number;
  @IsInt() @Min(0) includedDistanceMeters: number;
  @IsInt() @Min(0) perKmPaise: number;
  @IsInt() @Min(0) perMinutePaise: number;
  @IsInt() @Min(0) minimumFarePaise: number;
  @IsInt() @Min(0) bookingFeePaise: number;
  @IsInt() @Min(0) @Max(5000) taxRateBps: number;
  @IsInt() @Min(0) waitingFreeSeconds: number;
  @IsInt() @Min(0) waitingPerMinutePaise: number;
  @IsInt() @Min(0) @Max(10000) commissionRateBps: number;
  @IsInt() @Min(10000) @Max(30000) maxSurgeBps: number;
  @IsInt() @Min(0) cancellationFeePaise: number;
  @IsInt() @Min(0) cancellationFreeWindowSeconds: number;
  @IsInt() @Min(0) cancellationArrivedGraceSeconds: number;

  @IsString()
  @Length(5, 300)
  changeNote: string;
}

class ZoneDto {
  @IsString() @Length(2, 60) city: string;
  @IsString() @Length(2, 80) name: string;
  /** WKT MULTIPOLYGON in lng/lat. */
  @IsString() @Length(20, 200000) wkt: string;
}

class ZoneActiveDto {
  @IsBoolean() active: boolean;
}

class PromotionDto {
  @Matches(/^[A-Za-z0-9]{3,20}$/) code: string;
  @IsString() @Length(3, 200) description: string;
  @IsIn(['PERCENT', 'FLAT']) discountType: 'PERCENT' | 'FLAT';
  @IsInt() @Min(1) discountValue: number;
  @IsOptional() @IsInt() @Min(1) maxDiscountPaise?: number;
  @IsOptional() @IsInt() @Min(0) minRideFarePaise?: number;
  @IsISO8601() startsAt: string;
  @IsISO8601() endsAt: string;
  @IsOptional() @IsInt() @Min(1) totalRedemptionLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) perUserLimit?: number;
}

class RefundRequestDto {
  @IsInt() @Min(1) amountPaise: number;
  @IsString() @Length(5, 500) reason: string;
}

class RefundDecisionDto {
  @IsBoolean() approve: boolean;
}

class PayoutDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) periodStart: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) periodEnd: string;
}

class SettleDto {
  @IsBoolean() paid: boolean;
  @IsOptional() @IsString() @Length(3, 100) reference?: string;
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}

class PeriodQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}

class AuditQuery {
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@ApiTags('admin: finance & configuration')
@Controller({ path: 'admin', version: '1' })
export class AdminFinanceController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly earnings: EarningsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- zones & pricing ----------

  @StaffAuth('OPERATIONS', 'FINANCE')
  @Get('zones')
  async zones() {
    const { rows } = await this.db.execute(sql`
      SELECT id, city, name, active, ST_AsText(boundary) AS wkt, created_at FROM service_zones ORDER BY city, name`);
    return rows;
  }

  @StaffAuth('OPERATIONS')
  @Post('zones')
  async createZone(@CurrentStaff() staff: StaffPrincipal, @Body() dto: ZoneDto) {
    const { rows } = await this.db
      .execute<{ valid: boolean }>(
        sql`SELECT ST_IsValid(ST_GeomFromText(${dto.wkt}, 4326)) AND GeometryType(ST_GeomFromText(${dto.wkt}, 4326)) = 'MULTIPOLYGON' AS valid`,
      )
      .catch(() => ({ rows: [{ valid: false }] }));
    if (!rows[0]?.valid)
      throw new AppError(400, 'INVALID_BOUNDARY', 'Boundary must be a valid WKT MULTIPOLYGON');
    const [zone] = await this.db
      .insert(serviceZones)
      .values({
        city: dto.city,
        name: dto.name,
        boundary: sql`ST_GeogFromText(${'SRID=4326;' + dto.wkt})` as unknown as string,
        active: false,
      })
      .returning({ id: serviceZones.id });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'zone.created',
      entityType: 'service_zone',
      entityId: zone!.id,
    });
    return { id: zone!.id, active: false };
  }

  @StaffAuth('OPERATIONS')
  @Patch('zones/:id')
  async setZoneActive(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ZoneActiveDto,
  ) {
    const [z] = await this.db
      .update(serviceZones)
      .set({ active: dto.active })
      .where(eq(serviceZones.id, id))
      .returning({ id: serviceZones.id });
    if (!z) throw new AppError(404, 'NOT_FOUND', 'Zone not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: dto.active ? 'zone.activated' : 'zone.deactivated',
      entityType: 'service_zone',
      entityId: id,
    });
    return { id, active: dto.active };
  }

  /** Every version for every zone and category, newest first. */
  @StaffAuth('OPERATIONS', 'FINANCE')
  @Get('pricing')
  pricing() {
    return this.db
      .select()
      .from(pricingRules)
      .orderBy(pricingRules.zoneId, pricingRules.categoryCode, desc(pricingRules.version));
  }

  /** Publishes a new immutable version. Quotes already given keep their old price. */
  @StaffAuth('FINANCE')
  @Post('pricing')
  async publishPricing(@CurrentStaff() staff: StaffPrincipal, @Body() dto: PricingVersionDto) {
    validatePricingRule(dto);
    if (dto.minimumFarePaise < dto.baseFarePaise) {
      throw new AppError(422, 'INVALID_PRICING', 'Minimum fare must not be below the base fare');
    }
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    if (effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new AppError(422, 'BACKDATED_PRICING', 'Prices cannot take effect in the past');
    }
    const rule = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${'pricing:' + dto.zoneId + dto.categoryCode}))`,
      );
      const [{ next }] = (
        await tx.execute<{ next: number }>(sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS next FROM pricing_rules
         WHERE zone_id = ${dto.zoneId} AND category_code = ${dto.categoryCode}`)
      ).rows as [{ next: number }];
      const { effectiveFrom: _e, ...fields } = dto;
      const [row] = await tx
        .insert(pricingRules)
        .values({ ...fields, version: Number(next), effectiveFrom, createdBy: staff.staffId })
        .returning();
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.staffId,
          action: 'pricing.published',
          entityType: 'pricing_rule',
          entityId: row!.id,
          metadata: { zoneId: dto.zoneId, categoryCode: dto.categoryCode, version: Number(next) },
        },
        tx,
      );
      return row!;
    });
    return rule;
  }

  // ---------- promotions ----------

  @StaffAuth('FINANCE', 'OPERATIONS')
  @Get('promotions')
  promotions() {
    return this.db.select().from(promotions).orderBy(desc(promotions.createdAt));
  }

  @StaffAuth('FINANCE')
  @Post('promotions')
  async createPromotion(@CurrentStaff() staff: StaffPrincipal, @Body() dto: PromotionDto) {
    if (dto.discountType === 'PERCENT' && dto.discountValue > 10000) {
      throw new AppError(
        400,
        'INVALID_DISCOUNT',
        'Percent discounts are in basis points (max 10000)',
      );
    }
    if (new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new AppError(400, 'INVALID_WINDOW', 'End must be after start');
    }
    try {
      const [p] = await this.db
        .insert(promotions)
        .values({
          ...dto,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          code: dto.code.toUpperCase(),
          createdBy: staff.staffId,
        })
        .returning();
      await this.audit.record({
        actorType: 'STAFF',
        actorId: staff.staffId,
        action: 'promotion.created',
        entityType: 'promotion',
        entityId: p!.id,
      });
      return p;
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new AppError(409, 'PROMO_CODE_EXISTS', 'This code already exists');
      }
      throw err;
    }
  }

  @StaffAuth('FINANCE')
  @Post('promotions/:id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const [p] = await this.db
      .update(promotions)
      .set({ active: false })
      .where(eq(promotions.id, id))
      .returning({ id: promotions.id });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Promotion not found');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'promotion.deactivated',
      entityType: 'promotion',
      entityId: id,
    });
    return { id, active: false };
  }

  // ---------- refunds & payouts ----------

  @StaffAuth('SUPPORT', 'FINANCE')
  @Post('payments/:id/refunds')
  requestRefund(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RefundRequestDto,
  ) {
    return this.payments.requestRefund(staff.staffId, id, dto.amountPaise, dto.reason);
  }

  @StaffAuth('FINANCE')
  @Get('refunds')
  refunds() {
    return this.db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(100);
  }

  @StaffAuth('FINANCE')
  @Post('refunds/:id/decision')
  @HttpCode(200)
  decideRefund(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RefundDecisionDto,
  ) {
    return this.payments.decideRefund(staff.staffId, id, dto.approve);
  }

  /** Drivers currently owed money, largest first. */
  @StaffAuth('FINANCE')
  @Get('payouts/balances')
  async balances() {
    const { rows } = await this.db.execute(sql`
      SELECT l.owner_user_id AS driver_id, u.full_name AS name,
             SUM(CASE WHEN l.account = 'DRIVER_PAYABLE' THEN CASE l.direction WHEN 'CREDIT' THEN l.amount_paise ELSE -l.amount_paise END ELSE 0 END)
           - SUM(CASE WHEN l.account = 'CASH_HELD_BY_DRIVER' THEN CASE l.direction WHEN 'DEBIT' THEN l.amount_paise ELSE -l.amount_paise END ELSE 0 END) AS net_paise
        FROM financial_ledger_entries l
        JOIN users u ON u.id = l.owner_user_id
       WHERE l.account IN ('DRIVER_PAYABLE', 'CASH_HELD_BY_DRIVER')
       GROUP BY 1, 2
      HAVING SUM(CASE WHEN l.account = 'DRIVER_PAYABLE' THEN CASE l.direction WHEN 'CREDIT' THEN l.amount_paise ELSE -l.amount_paise END ELSE 0 END)
           - SUM(CASE WHEN l.account = 'CASH_HELD_BY_DRIVER' THEN CASE l.direction WHEN 'DEBIT' THEN l.amount_paise ELSE -l.amount_paise END ELSE 0 END) <> 0
       ORDER BY 3 DESC`);
    return rows;
  }

  @StaffAuth('FINANCE')
  @Get('payouts')
  payouts() {
    return this.db.select().from(driverPayouts).orderBy(desc(driverPayouts.createdAt)).limit(100);
  }

  @StaffAuth('FINANCE')
  @Post('drivers/:id/payouts')
  createPayout(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayoutDto,
  ) {
    return this.earnings.createPayout(staff.staffId, id, dto.periodStart, dto.periodEnd);
  }

  @StaffAuth('FINANCE')
  @Post('payouts/:id/settle')
  @HttpCode(200)
  settle(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SettleDto,
  ) {
    if (dto.paid && !dto.reference)
      throw new AppError(400, 'REFERENCE_REQUIRED', 'Enter the bank reference (UTR)');
    if (!dto.paid && !dto.reason)
      throw new AppError(400, 'REASON_REQUIRED', 'Say why the payout failed');
    return this.earnings.settlePayout(
      staff.staffId,
      id,
      dto.paid ? { paid: true, reference: dto.reference! } : { paid: false, reason: dto.reason! },
    );
  }

  // ---------- reports & audit ----------

  /** Ride export without names or phone numbers. */
  @StaffAuth('FINANCE', 'OPERATIONS')
  @Get('reports/rides.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="rides.csv"')
  async ridesCsv(@CurrentStaff() staff: StaffPrincipal, @Query() q: PeriodQuery) {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, to_char(r.requested_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS requested_ist,
             r.status, r.category_code, z.city, r.quoted_total_paise, r.final_total_paise,
             r.payment_method, r.payment_status, r.cancelled_by, r.cancellation_fee_paise
        FROM rides r JOIN service_zones z ON z.id = r.zone_id
       WHERE (r.requested_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${q.from}::date AND ${q.to}::date
       ORDER BY r.requested_at`);
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'report.rides_exported',
      entityType: 'report',
      metadata: { from: q.from, to: q.to, rows: rows.length },
    });
    const header = [
      'ride_id',
      'requested_ist',
      'status',
      'category',
      'city',
      'quoted_paise',
      'final_paise',
      'payment_method',
      'payment_status',
      'cancelled_by',
      'cancellation_fee_paise',
    ];
    return (
      [header.join(','), ...rows.map((r) => Object.values(r).map(csvCell).join(','))].join('\n') +
      '\n'
    );
  }

  @StaffAuth('SUPER_ADMIN')
  @Get('audit')
  auditLog(@Query() q: AuditQuery) {
    return this.db
      .select()
      .from(auditLogs)
      .where(
        and(
          q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
          q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
          q.actorId ? eq(auditLogs.actorId, q.actorId) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.id))
      .limit(q.limit ?? 100);
  }
}
