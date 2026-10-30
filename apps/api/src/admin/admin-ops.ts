import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { maskIndianMobile, TERMINAL_RIDE_STATUSES } from '@saheli/domain';
import { IsString, Length, Matches } from 'class-validator';
import { and, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { DB, Database } from '../database/database.module';
import {
  driverAvailability,
  passengerProfiles,
  payments,
  rideAssignments,
  rideEvents,
  rides,
  safetyIncidents,
  sessions,
  supportTickets,
  users,
} from '../database/schema';
import { DispatchService } from '../dispatch/dispatch.service';
import { RideStateService } from '../rides/ride-state.service';
import { ListQuery } from './admin-drivers';
import { CurrentStaff, StaffAuth, StaffPrincipal } from './staff-auth';

class PeriodQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

class ReasonDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

const IST = (col: string) => sql.raw(`(${col} AT TIME ZONE 'Asia/Kolkata')::date`);
const PII_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SAFETY'];
const canSeePii = (s: StaffPrincipal) => s.roles.some((r) => PII_ROLES.includes(r));

@ApiTags('admin: operations')
@Controller({ path: 'admin', version: '1' })
export class AdminOpsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly state: RideStateService,
    private readonly dispatch: DispatchService,
    private readonly audit: AuditService,
  ) {}

  /** Overview numbers, all computed from the database for the IST date range. */
  @StaffAuth()
  @Get('metrics')
  async metrics(@Query() q: PeriodQuery) {
    const one = async <T>(query: ReturnType<typeof sql>) =>
      ((await this.db.execute(query)).rows[0] ?? {}) as T;
    const people = await one<{ passengers: number; drivers: number }>(sql`
      SELECT (SELECT count(*) FROM user_roles WHERE role = 'PASSENGER')::int AS passengers,
             (SELECT count(*) FROM user_roles WHERE role = 'DRIVER')::int AS drivers`);
    const { rows: driverStatuses } = await this.db.execute<{ status: string; n: number }>(
      sql`SELECT status, count(*)::int AS n FROM driver_profiles GROUP BY status`,
    );
    const live = await one<{ active: number; online: number }>(sql`
      SELECT (SELECT count(*) FROM rides WHERE status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS'))::int AS active,
             (SELECT count(*) FROM driver_availability WHERE is_online)::int AS online`);
    const period = await one<{
      completed: number;
      cancelled: number;
      no_driver: number;
      gbv: number;
    }>(sql`
      SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
             count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
             count(*) FILTER (WHERE status = 'NO_DRIVER_FOUND')::int AS no_driver,
             COALESCE(SUM(final_total_paise) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS gbv
        FROM rides WHERE ${IST('requested_at')} BETWEEN ${q.from}::date AND ${q.to}::date`);
    const revenue = await one<{ revenue: number }>(sql`
      SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_paise ELSE -amount_paise END), 0)::bigint AS revenue
        FROM financial_ledger_entries
       WHERE account = 'PLATFORM_REVENUE' AND ${IST('created_at')} BETWEEN ${q.from}::date AND ${q.to}::date`);
    const offers = await one<{
      offered: number;
      accepted: number;
      rejected: number;
      expired: number;
    }>(sql`
      SELECT count(*)::int AS offered,
             (SELECT count(*) FROM ride_events
               WHERE to_status = 'DRIVER_ASSIGNED'
                 AND ${IST('created_at')} BETWEEN ${q.from}::date AND ${q.to}::date)::int AS accepted,
             count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE status = 'EXPIRED')::int AS expired
        FROM ride_assignments WHERE ${IST('offered_at')} BETWEEN ${q.from}::date AND ${q.to}::date`);
    const driverCancels = await one<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ride_events
       WHERE actor_type = 'DRIVER' AND to_status = 'SEARCHING'
         AND ${IST('created_at')} BETWEEN ${q.from}::date AND ${q.to}::date`);
    const { rows: incidents } = await this.db.execute<{ severity: string; n: number }>(sql`
      SELECT severity, count(*)::int AS n FROM safety_incidents
       WHERE status IN ('OPEN','ACKNOWLEDGED','RESPONDING') GROUP BY severity`);
    const tickets = await one<{ open: number }>(
      sql`SELECT count(*)::int AS open FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS','WAITING_ON_USER')`,
    );
    const { rows: zones } = await this.db.execute<{
      city: string;
      name: string;
      active: boolean;
      online: number;
    }>(sql`
      SELECT z.city, z.name, z.active,
             (SELECT count(*) FROM driver_availability da
                JOIN driver_locations dl ON dl.driver_id = da.driver_id
               WHERE da.is_online AND ST_Covers(z.boundary, dl.location))::int AS online
        FROM service_zones z ORDER BY z.city`);

    const offered = Number(offers.offered ?? 0);
    const completed = Number(period.completed ?? 0);
    return {
      period: { from: q.from, to: q.to },
      passengers: Number(people.passengers ?? 0),
      drivers: Number(people.drivers ?? 0),
      driversByStatus: Object.fromEntries(driverStatuses.map((r) => [r.status, Number(r.n)])),
      activeRides: Number(live.active ?? 0),
      driversOnline: Number(live.online ?? 0),
      completedRides: completed,
      cancelledRides: Number(period.cancelled ?? 0),
      noDriverFoundRides: Number(period.no_driver ?? 0),
      grossBookingValuePaise: Number(period.gbv ?? 0),
      platformRevenuePaise: Number(revenue.revenue ?? 0),
      offers: {
        offered,
        accepted: Number(offers.accepted ?? 0),
        rejected: Number(offers.rejected ?? 0),
        expired: Number(offers.expired ?? 0),
        acceptanceRate: offered
          ? Math.round((Number(offers.accepted) / offered) * 1000) / 1000
          : null,
      },
      driverCancellations: Number(driverCancels.n ?? 0),
      openIncidentsBySeverity: Object.fromEntries(incidents.map((r) => [r.severity, Number(r.n)])),
      openTickets: Number(tickets.open ?? 0),
      zones: zones.map((z) => ({ ...z, online: Number(z.online) })),
    };
  }

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('rides')
  async rides(@Query() q: ListQuery) {
    return this.db
      .select({
        id: rides.id,
        status: rides.status,
        categoryCode: rides.categoryCode,
        requestedAt: rides.requestedAt,
        pickupAddress: rides.pickupAddress,
        dropoffAddress: rides.dropoffAddress,
        quotedTotalPaise: rides.quotedTotalPaise,
        finalTotalPaise: rides.finalTotalPaise,
        paymentMethod: rides.paymentMethod,
        paymentStatus: rides.paymentStatus,
        passengerId: rides.passengerId,
        driverId: rides.driverId,
      })
      .from(rides)
      .where(q.status ? sql`${rides.status} = ${q.status}` : undefined)
      .orderBy(desc(rides.requestedAt))
      .limit(q.limit ?? 50)
      .offset(q.offset ?? 0);
  }

  /** Live operations view: active rides with the assigned driver's last position. */
  @StaffAuth('OPERATIONS', 'SAFETY')
  @Get('rides/active')
  async activeRides() {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      SELECT r.id, r.status, r.category_code, r.requested_at, r.pickup_address, r.dropoff_address,
             ST_Y(r.pickup::geometry) AS pickup_lat, ST_X(r.pickup::geometry) AS pickup_lng,
             ST_Y(dl.location::geometry) AS driver_lat, ST_X(dl.location::geometry) AS driver_lng,
             dl.recorded_at AS driver_location_at,
             (SELECT count(*) FROM safety_incidents si
               WHERE si.ride_id = r.id AND si.status IN ('OPEN','ACKNOWLEDGED','RESPONDING'))::int AS open_incidents
        FROM rides r
        LEFT JOIN driver_locations dl ON dl.driver_id = r.driver_id
       WHERE r.status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')
       ORDER BY open_incidents DESC, r.requested_at`);
    return rows;
  }

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('rides/:id')
  async ride(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, id));
    if (!ride) throw new AppError(404, 'NOT_FOUND', 'Ride not found');
    const people = await this.db
      .select({ id: users.id, name: users.fullName, phone: users.phoneE164 })
      .from(users)
      .where(inArray(users.id, [ride.passengerId, ...(ride.driverId ? [ride.driverId] : [])]));
    const person = (uid: string | null) => {
      const p = people.find((x) => x.id === uid);
      return p
        ? { id: p.id, name: p.name, phone: canSeePii(staff) ? p.phone : maskIndianMobile(p.phone) }
        : null;
    };
    const { pickupPin: _pin, ...safe } = ride;
    return {
      ...safe,
      passenger: person(ride.passengerId),
      driver: person(ride.driverId),
      events: await this.db
        .select()
        .from(rideEvents)
        .where(eq(rideEvents.rideId, id))
        .orderBy(rideEvents.id),
      assignments: await this.db
        .select()
        .from(rideAssignments)
        .where(eq(rideAssignments.rideId, id))
        .orderBy(rideAssignments.offeredAt),
      payments: await this.db.select().from(payments).where(eq(payments.rideId, id)),
      incidents: await this.db
        .select({
          id: safetyIncidents.id,
          type: safetyIncidents.type,
          status: safetyIncidents.status,
        })
        .from(safetyIncidents)
        .where(eq(safetyIncidents.rideId, id)),
    };
  }

  /** Ends a ride for operational or safety reasons, including one in progress. No fee is charged. */
  @StaffAuth('OPERATIONS', 'SAFETY')
  @Post('rides/:id/cancel')
  @HttpCode(200)
  async cancelRide(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    const result = await this.db.transaction(async (tx) => {
      const r = await this.state.transition(tx, {
        rideId: id,
        to: 'CANCELLED',
        actor: 'ADMIN',
        actorId: null,
        reason: dto.reason,
        prepare: () => ({
          cancelledBy: 'ADMIN',
          cancellationReason: dto.reason,
          cancellationFeePaise: 0,
          cancelledAt: new Date(),
          paymentStatus: 'WAIVED',
        }),
        metadata: { staffId: staff.staffId },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.staffId,
          action: 'ride.cancelled_by_admin',
          entityType: 'ride',
          entityId: id,
        },
        tx,
      );
      return r;
    });
    this.dispatch.notifyRide(result);
    return { id, status: result.ride.status };
  }

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('passengers')
  async passengers(@CurrentStaff() staff: StaffPrincipal, @Query() q: ListQuery) {
    const search = q.q ? `%${q.q.replace(/[%_]/g, '')}%` : null;
    const rows = await this.db
      .select({
        id: users.id,
        name: users.fullName,
        phone: users.phoneE164,
        reviewAccount: users.isReviewAccount,
        status: users.status,
        eligibility: passengerProfiles.eligibilityStatus,
        createdAt: users.createdAt,
      })
      .from(passengerProfiles)
      .innerJoin(users, eq(users.id, passengerProfiles.userId))
      .where(search ? or(ilike(users.fullName, search), ilike(users.phoneE164, search)) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(q.limit ?? 50)
      .offset(q.offset ?? 0);
    return rows.map((r) => ({
      ...r,
      phone: canSeePii(staff) ? r.phone : maskIndianMobile(r.phone),
    }));
  }

  @StaffAuth('OPERATIONS', 'SUPPORT', 'SAFETY')
  @Get('passengers/:id')
  async passenger(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const [u] = await this.db
      .select({ user: users, profile: passengerProfiles })
      .from(passengerProfiles)
      .innerJoin(users, eq(users.id, passengerProfiles.userId))
      .where(eq(users.id, id));
    if (!u) throw new AppError(404, 'NOT_FOUND', 'Passenger not found');
    return {
      id,
      name: u.user.fullName,
      phone: canSeePii(staff) ? u.user.phoneE164 : maskIndianMobile(u.user.phoneE164),
      status: u.user.status,
      suspendedReason: u.user.suspendedReason,
      eligibilityStatus: u.profile.eligibilityStatus,
      termsVersionAccepted: u.profile.termsVersionAccepted,
      createdAt: u.user.createdAt,
      rides: await this.db
        .select({
          id: rides.id,
          status: rides.status,
          requestedAt: rides.requestedAt,
          total: rides.finalTotalPaise,
        })
        .from(rides)
        .where(eq(rides.passengerId, id))
        .orderBy(desc(rides.requestedAt))
        .limit(20),
      tickets: await this.db
        .select({
          id: supportTickets.id,
          subject: supportTickets.subject,
          status: supportTickets.status,
        })
        .from(supportTickets)
        .where(eq(supportTickets.userId, id)),
      incidents: await this.db
        .select({
          id: safetyIncidents.id,
          type: safetyIncidents.type,
          status: safetyIncidents.status,
        })
        .from(safetyIncidents)
        .where(eq(safetyIncidents.reporterUserId, id)),
    };
  }

  /** Suspends any app account (passenger or driver): signs out every device at once. */
  @StaffAuth('OPERATIONS', 'SAFETY')
  @Post('users/:id/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    const [busy] = await this.db
      .select({ id: rides.id })
      .from(rides)
      .where(
        and(
          or(eq(rides.passengerId, id), eq(rides.driverId, id)),
          notInArray(rides.status, [...TERMINAL_RIDE_STATUSES]),
        ),
      )
      .limit(1);
    if (busy)
      throw new AppError(409, 'ACTIVE_RIDE', 'This user has an active ride. Resolve it first', {
        rideId: busy.id,
      });
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ status: 'SUSPENDED', suspendedReason: dto.reason })
        .where(eq(users.id, id))
        .returning({ id: users.id });
      if (!updated.length) throw new AppError(404, 'NOT_FOUND', 'User not found');
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'suspended' })
        .where(eq(sessions.userId, id));
      await tx
        .update(driverAvailability)
        .set({ isOnline: false })
        .where(eq(driverAvailability.driverId, id));
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.staffId,
          action: 'user.suspended',
          entityType: 'user',
          entityId: id,
        },
        tx,
      );
    });
    return { id, status: 'SUSPENDED' };
  }

  @StaffAuth('OPERATIONS', 'SAFETY')
  @Post('users/:id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
  ) {
    const updated = await this.db
      .update(users)
      .set({ status: 'ACTIVE', suspendedReason: null })
      .where(and(eq(users.id, id), eq(users.status, 'SUSPENDED')))
      .returning({ id: users.id });
    if (!updated.length) throw new AppError(409, 'NOT_SUSPENDED', 'This account is not suspended');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staff.staffId,
      action: 'user.reactivated',
      entityType: 'user',
      entityId: id,
      metadata: { reason: dto.reason.slice(0, 200) },
    });
    return { id, status: 'ACTIVE' };
  }
}
