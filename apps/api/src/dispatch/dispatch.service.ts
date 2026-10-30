import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LatLng, rankCandidates, settleFare } from '@saheli/domain';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { Env } from '../config/env';
import { DB, Database, Tx } from '../database/database.module';
import { NotificationsService, PushNotice } from '../notifications/notifications.service';
import { driverAvailability, fareQuotes, rideAssignments, rides, users } from '../database/schema';
import { geoPoint, PricingService } from '../pricing/pricing.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { RideRow, RideStateService, TransitionResult } from '../rides/ride-state.service';

type Candidate = {
  driver_id: string;
  distance_m: number;
  idle_seconds: number;
};

export interface OfferView {
  id: string;
  rideId: string;
  expiresAt: Date;
  pickupDistanceMeters: number;
  pickup: LatLng;
  pickupAddress: string;
  dropoff: LatLng;
  dropoffAddress: string;
  categoryCode: string;
  tripDistanceMeters: number;
  estimatedEarningPaise: number;
  passengerFirstName: string | null;
}

/**
 * Finds and offers rides to drivers. One offer is outstanding per ride at a
 * time; the offered driver is reserved (driver_availability.active_ride_id) so
 * no one else can offer them work. All state lives in Postgres, so any API
 * instance can run the sweeper; `FOR UPDATE SKIP LOCKED` keeps them apart.
 */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Dispatch');
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly env: Env,
    private readonly state: RideStateService,
    private readonly realtime: RealtimeService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (this.env.DISPATCH_SWEEP_INTERVAL_MS > 0) {
      this.timer = setInterval(() => void this.sweep(), this.env.DISPATCH_SWEEP_INTERVAL_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends the next offer for a searching ride, widening the radius or giving up as configured. */
  async dispatchNext(rideId: string): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'dispatch:' + rideId}))`);
      const [ride] = await tx.select().from(rides).where(eq(rides.id, rideId)).for('update');
      if (!ride || ride.status !== 'SEARCHING') return null;

      const [open] = await tx
        .select({ id: rideAssignments.id })
        .from(rideAssignments)
        .where(
          and(
            eq(rideAssignments.rideId, rideId),
            eq(rideAssignments.status, 'OFFERED'),
            gt(rideAssignments.expiresAt, new Date()),
          ),
        );
      if (open) return null;

      const radii = this.env.dispatchRadii;
      let round = Math.max(1, ride.dispatchRound);
      for (;;) {
        const radius = radii[Math.min(round, radii.length) - 1]!;
        const offer = await this.tryOffer(tx, ride, radius, round);
        if (offer) {
          await tx.update(rides).set({ dispatchRound: round }).where(eq(rides.id, rideId));
          return { kind: 'offer' as const, offer };
        }
        if (round < radii.length) {
          round++;
          continue;
        }
        await tx.update(rides).set({ dispatchRound: round }).where(eq(rides.id, rideId));
        const searchedFor =
          (Date.now() - (ride.searchStartedAt ?? ride.requestedAt).getTime()) / 1000;
        if (searchedFor < this.env.DISPATCH_SEARCH_WINDOW_SECONDS) {
          return null; // keep searching; the sweeper retries
        }
        const result = await this.state.transition(tx, {
          rideId,
          to: 'NO_DRIVER_FOUND',
          actor: 'SYSTEM',
          actorId: null,
          reason: 'No eligible driver accepted within the search window',
          metadata: { rounds: round },
        });
        return { kind: 'ended' as const, result };
      }
    });

    if (outcome?.kind === 'offer') {
      const view = await this.buildOfferView(outcome.offer.assignmentId);
      this.realtime.toUser(outcome.offer.driverId, 'offer.created', view);
      this.push({
        userId: outcome.offer.driverId,
        app: 'DRIVER',
        template: 'ride_offer',
        title: 'New ride request',
        body: `Open Saheli Driver to accept within ${this.env.DISPATCH_OFFER_TIMEOUT_SECONDS} seconds.`,
        path: '/',
      });
    } else if (outcome?.kind === 'ended') {
      this.notifyRide(outcome.result);
    }
  }

  private async tryOffer(
    tx: Tx,
    ride: RideRow,
    radiusMeters: number,
    round: number,
  ): Promise<{ driverId: string; assignmentId: string } | null> {
    const pickup = geoPoint(ride.pickup);
    // GiST-indexed radius search over fresh positions of free, approved, online drivers.
    const { rows } = await tx.execute<Candidate>(sql`
      SELECT dl.driver_id,
             ST_Distance(dl.location, ${pickup})::int AS distance_m,
             EXTRACT(EPOCH FROM (now() - da.updated_at))::int AS idle_seconds
        FROM driver_locations dl
        JOIN driver_availability da ON da.driver_id = dl.driver_id
        JOIN driver_profiles dp ON dp.user_id = dl.driver_id
        JOIN users u ON u.id = dl.driver_id
        JOIN vehicles v ON v.id = da.vehicle_id
       WHERE da.is_online
         AND da.active_ride_id IS NULL
         AND dp.status = 'APPROVED'
         AND u.status = 'ACTIVE'
         AND v.status = 'ACTIVE'
         AND v.category_code = ${ride.categoryCode}
         AND dl.driver_id <> ${ride.passengerId}
         -- Review accounts only ever meet each other (docs/MOBILE_RELEASE.md).
         AND u.is_review_account = (SELECT is_review_account FROM users WHERE id = ${ride.passengerId})
         AND dl.recorded_at > now() - make_interval(secs => ${this.env.LOCATION_MAX_AGE_SECONDS})
         AND ST_DWithin(dl.location, ${pickup}, ${radiusMeters})
         AND NOT EXISTS (
           SELECT 1 FROM ride_assignments ra
            WHERE ra.ride_id = ${ride.id} AND ra.driver_id = dl.driver_id)
       ORDER BY dl.location <-> ${pickup}
       LIMIT 20`);
    const ranked = rankCandidates(
      rows.map((r) => ({
        driverId: r.driver_id,
        pickupDistanceMeters: Number(r.distance_m),
        idleSeconds: Number(r.idle_seconds),
      })),
    );

    for (const candidate of ranked) {
      const reserved = await tx
        .update(driverAvailability)
        .set({ activeRideId: ride.id })
        .where(
          and(
            eq(driverAvailability.driverId, candidate.driverId),
            eq(driverAvailability.isOnline, true),
            sql`${driverAvailability.activeRideId} IS NULL`,
          ),
        )
        .returning({ driverId: driverAvailability.driverId });
      if (!reserved.length) continue; // taken by another ride meanwhile

      const expiresAt = new Date(Date.now() + this.env.DISPATCH_OFFER_TIMEOUT_SECONDS * 1000);
      const [assignment] = await tx
        .insert(rideAssignments)
        .values({
          rideId: ride.id,
          driverId: candidate.driverId,
          dispatchRound: round,
          pickupDistanceMeters: candidate.pickupDistanceMeters,
          score: candidate.score,
          expiresAt,
        })
        .returning({ id: rideAssignments.id });
      return { driverId: candidate.driverId, assignmentId: assignment!.id };
    }
    return null;
  }

  /** The driver's current pending offer, if any (for apps that missed the push). */
  async currentOffer(driverId: string): Promise<OfferView | null> {
    const [a] = await this.db
      .select()
      .from(rideAssignments)
      .where(
        and(
          eq(rideAssignments.driverId, driverId),
          eq(rideAssignments.status, 'OFFERED'),
          gt(rideAssignments.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return a ? this.buildOfferView(a.id) : null;
  }

  private async buildOfferView(assignmentId: string): Promise<OfferView> {
    const [row] = await this.db
      .select({
        assignment: rideAssignments,
        ride: rides,
        quote: fareQuotes,
        passengerName: users.fullName,
      })
      .from(rideAssignments)
      .innerJoin(rides, eq(rides.id, rideAssignments.rideId))
      .innerJoin(fareQuotes, eq(fareQuotes.id, rides.quoteId))
      .innerJoin(users, eq(users.id, rides.passengerId))
      .where(eq(rideAssignments.id, assignmentId));
    if (!row) throw new Error(`Assignment ${assignmentId} missing`);
    const { assignment, ride, quote } = row;
    const rule = await this.pricing.ruleById(ride.pricingRuleId);
    const settlement = settleFare(quote.breakdown, rule.commissionRateBps);
    return {
      id: assignment.id,
      rideId: ride.id,
      expiresAt: assignment.expiresAt,
      pickupDistanceMeters: assignment.pickupDistanceMeters,
      pickup: ride.pickup,
      pickupAddress: ride.pickupAddress,
      dropoff: ride.dropoff,
      dropoffAddress: ride.dropoffAddress,
      categoryCode: ride.categoryCode,
      tripDistanceMeters: quote.distanceMeters,
      estimatedEarningPaise: settlement.driverEarningPaise,
      // First name only: drivers do not need the passenger's full identity.
      passengerFirstName: row.passengerName?.split(' ')[0] ?? null,
    };
  }

  /**
   * Accepts an offer. Exactly one driver can win: the assignment must still be
   * OFFERED and unexpired, the ride must still be SEARCHING, and the database
   * allows only one ACCEPTED assignment per ride.
   */
  async accept(driverId: string, assignmentId: string): Promise<RideRow> {
    const result = await this.db.transaction(async (tx) => {
      const [assignment] = await tx
        .update(rideAssignments)
        .set({ status: 'ACCEPTED', respondedAt: new Date() })
        .where(
          and(
            eq(rideAssignments.id, assignmentId),
            eq(rideAssignments.driverId, driverId),
            eq(rideAssignments.status, 'OFFERED'),
            gt(rideAssignments.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!assignment) {
        throw new AppError(409, 'OFFER_NO_LONGER_AVAILABLE', 'This ride is no longer available');
      }
      const [availability] = await tx
        .select({
          vehicleId: driverAvailability.vehicleId,
          activeRideId: driverAvailability.activeRideId,
        })
        .from(driverAvailability)
        .where(eq(driverAvailability.driverId, driverId));
      if (availability?.activeRideId !== assignment.rideId) {
        throw new AppError(409, 'OFFER_NO_LONGER_AVAILABLE', 'This ride is no longer available');
      }
      return this.state.transition(tx, {
        rideId: assignment.rideId,
        to: 'DRIVER_ASSIGNED',
        actor: 'DRIVER',
        actorId: driverId,
        prepare: () => ({
          driverId,
          vehicleId: availability.vehicleId,
          driverAssignedAt: new Date(),
        }),
      });
    });
    this.notifyRide(result);
    return result.ride;
  }

  async reject(driverId: string, assignmentId: string): Promise<void> {
    const rideId = await this.db.transaction(async (tx) => {
      const [assignment] = await tx
        .update(rideAssignments)
        .set({ status: 'REJECTED', respondedAt: new Date() })
        .where(
          and(
            eq(rideAssignments.id, assignmentId),
            eq(rideAssignments.driverId, driverId),
            eq(rideAssignments.status, 'OFFERED'),
          ),
        )
        .returning({ rideId: rideAssignments.rideId });
      if (!assignment) throw new AppError(404, 'OFFER_NOT_FOUND', 'Offer not found');
      await tx
        .update(driverAvailability)
        .set({ activeRideId: null })
        .where(
          and(
            eq(driverAvailability.driverId, driverId),
            eq(driverAvailability.activeRideId, assignment.rideId),
          ),
        );
      return assignment.rideId;
    });
    await this.dispatchNext(rideId);
  }

  /**
   * Expires overdue offers and retries rides that are still searching. Runs on
   * an interval in normal operation; tests call it directly.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const expired = await this.db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ id: string; ride_id: string; driver_id: string }>(sql`
          SELECT id, ride_id, driver_id FROM ride_assignments
           WHERE status = 'OFFERED' AND expires_at <= now()
           ORDER BY expires_at
           LIMIT 100
           FOR UPDATE SKIP LOCKED`);
        for (const row of rows) {
          await tx
            .update(rideAssignments)
            .set({ status: 'EXPIRED' })
            .where(eq(rideAssignments.id, row.id));
          await tx
            .update(driverAvailability)
            .set({ activeRideId: null })
            .where(
              and(
                eq(driverAvailability.driverId, row.driver_id),
                eq(driverAvailability.activeRideId, row.ride_id),
              ),
            );
        }
        return rows;
      });
      for (const row of expired) {
        this.realtime.toUser(row.driver_id, 'offer.withdrawn', {
          offerId: row.id,
          reason: 'EXPIRED',
        });
      }

      const searching = await this.db
        .select({ id: rides.id })
        .from(rides)
        .where(and(eq(rides.status, 'SEARCHING'), lte(rides.requestedAt, new Date())))
        .limit(200);
      for (const ride of searching) {
        try {
          await this.dispatchNext(ride.id);
        } catch (err) {
          this.logger.error({ err, rideId: ride.id }, 'Dispatch retry failed');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Dispatch sweep failed');
    } finally {
      this.sweeping = false;
    }
  }

  /** Tells both parties a ride changed; withdrawn drivers are told their offer is gone. */
  notifyRide(result: TransitionResult): void {
    const { ride } = result;
    const payload = { rideId: ride.id, status: ride.status, version: ride.version };
    this.realtime.toUser(ride.passengerId, 'ride.updated', payload);
    if (ride.driverId) this.realtime.toUser(ride.driverId, 'ride.updated', payload);
    for (const driverId of result.withdrawnDrivers) {
      if (driverId !== ride.driverId) {
        this.realtime.toUser(driverId, 'offer.withdrawn', { rideId: ride.id, reason: ride.status });
      }
    }
    const notice = rideStatusPush(ride);
    if (notice) this.push(notice);
  }

  /** Push is a nudge on top of realtime: it never blocks or fails the ride flow. */
  private push(notice: PushNotice): void {
    void this.notifications.push(notice).catch((err: unknown) => {
      this.logger.warn({ err, template: notice.template }, 'Push notification failed');
    });
  }
}

/** Lock-screen text for the ride changes worth interrupting someone for. No personal details. */
function rideStatusPush(ride: RideRow): PushNotice | null {
  const toPassenger = (template: string, title: string, body: string): PushNotice => ({
    userId: ride.passengerId,
    app: 'PASSENGER',
    template,
    title,
    body,
    path: `/ride/${ride.id}`,
  });
  switch (ride.status) {
    case 'DRIVER_ASSIGNED':
      return toPassenger('ride_driver_assigned', 'Driver assigned', 'Your driver is on the way.');
    case 'DRIVER_ARRIVED':
      return toPassenger(
        'ride_driver_arrived',
        'Your driver has arrived',
        'Check the vehicle number before you share your PIN.',
      );
    case 'NO_DRIVER_FOUND':
      return toPassenger(
        'ride_no_driver',
        'No driver available',
        'We could not find a driver nearby. Please try again.',
      );
    case 'CANCELLED':
      return ride.driverId && ride.cancelledBy !== 'DRIVER'
        ? {
            userId: ride.driverId,
            app: 'DRIVER',
            template: 'ride_cancelled',
            title: 'Ride cancelled',
            body: 'Your current ride was cancelled.',
            path: '/',
          }
        : null;
    default:
      return null;
  }
}
