import { Inject, Injectable } from '@nestjs/common';
import {
  calculateFare,
  decideCancellationFee,
  haversineMeters,
  RIDE_STATUSES,
  TERMINAL_RIDE_STATUSES,
} from '@saheli/domain';
import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { randomDigits, safeEqual } from '../common/hashing';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  driverLocations,
  fareQuotes,
  passengerProfiles,
  promotions,
  rides,
} from '../database/schema';
import { DispatchService } from '../dispatch/dispatch.service';
import { PricingService, toCancellationPolicy, toDomainRule } from '../pricing/pricing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { RideRow, RideStateService } from './ride-state.service';
import { RideViews } from './ride-views';

const MAX_PIN_ATTEMPTS = 5;
/** A driver must be this close to the pickup to mark arrival. */
const ARRIVAL_RADIUS_M = 500;
const ACTIVE_STATUSES = RIDE_STATUSES.filter((s) => !TERMINAL_RIDE_STATUSES.includes(s));

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === '23505' && cause.constraint === constraint;
}

@Injectable()
export class RidesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly state: RideStateService,
    private readonly dispatch: DispatchService,
    private readonly pricing: PricingService,
    private readonly promotions: PromotionsService,
    private readonly views: RideViews,
    private readonly audit: AuditService,
    private readonly env: Env,
  ) {}

  // ---------- passenger ----------

  /** Books a quote. Idempotent at the HTTP layer; one live ride per passenger at the database layer. */
  async book(passengerId: string, quoteId: string, paymentMethod: 'CASH' | 'ONLINE') {
    const [profile] = await this.db
      .select({
        terms: passengerProfiles.termsVersionAccepted,
        eligibility: passengerProfiles.eligibilityStatus,
      })
      .from(passengerProfiles)
      .where(eq(passengerProfiles.userId, passengerId));
    if (!profile)
      throw new AppError(403, 'NOT_A_PASSENGER', 'Sign in with the passenger app to book');
    if (profile.terms !== this.env.TERMS_VERSION) {
      throw new AppError(
        403,
        'TERMS_NOT_ACCEPTED',
        'Please accept the latest terms to book a ride',
        {
          termsVersion: this.env.TERMS_VERSION,
        },
      );
    }
    if (profile.eligibility === 'INELIGIBLE') {
      throw new AppError(403, 'NOT_ELIGIBLE', 'This account cannot book rides');
    }

    let ride: RideRow;
    try {
      ride = await this.db.transaction(async (tx) => {
        const [quote] = await tx
          .update(fareQuotes)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(fareQuotes.id, quoteId),
              eq(fareQuotes.passengerId, passengerId),
              isNull(fareQuotes.usedAt),
              sql`${fareQuotes.expiresAt} > now()`,
            ),
          )
          .returning();
        if (!quote) {
          throw new AppError(
            410,
            'QUOTE_EXPIRED',
            'This price has expired. Please get a new quote',
          );
        }
        const [created] = await tx
          .insert(rides)
          .values({
            passengerId,
            zoneId: quote.zoneId,
            categoryCode: quote.categoryCode,
            quoteId: quote.id,
            pricingRuleId: quote.pricingRuleId,
            pickup: quote.pickup,
            pickupAddress: quote.pickupAddress,
            dropoff: quote.dropoff,
            dropoffAddress: quote.dropoffAddress,
            pickupPin: randomDigits(4),
            quotedTotalPaise: quote.totalPaise,
            paymentMethod,
          })
          .returning();
        if (quote.promotionId && quote.breakdown.discountPaise > 0) {
          const [promo] = await tx
            .select({ code: promotions.code })
            .from(promotions)
            .where(eq(promotions.id, quote.promotionId));
          await this.promotions.redeem(tx, {
            promotionId: quote.promotionId,
            code: promo!.code,
            userId: passengerId,
            rideId: created!.id,
            discountPaise: quote.breakdown.discountPaise,
          });
        }
        await this.state.transition(tx, {
          rideId: created!.id,
          to: 'SEARCHING',
          actor: 'SYSTEM',
          actorId: null,
          reason: 'Booked',
          prepare: () => ({ searchStartedAt: new Date() }),
        });
        return created!;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'rides_one_active_per_passenger_uq')) {
        throw new AppError(409, 'ACTIVE_RIDE_EXISTS', 'You already have a ride in progress');
      }
      throw err;
    }
    await this.dispatch.dispatchNext(ride.id);
    return this.getForPassenger(passengerId, ride.id);
  }

  async getForPassenger(passengerId: string, rideId: string) {
    const ride = await this.load(rideId);
    // 404, not 403: do not reveal that another user's ride exists.
    if (ride.passengerId !== passengerId)
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    return this.views.forPassenger(ride);
  }

  async activeForPassenger(passengerId: string) {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(and(eq(rides.passengerId, passengerId), inArray(rides.status, ACTIVE_STATUSES)))
      .limit(1);
    return ride ? this.views.forPassenger(ride) : null;
  }

  async historyForPassenger(passengerId: string, limit = 20, before?: string) {
    const rows = await this.db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.passengerId, passengerId),
          before ? lt(rides.requestedAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(rides.requestedAt))
      .limit(limit);
    return Promise.all(rows.map((r) => this.views.forPassenger(r)));
  }

  async cancelByPassenger(passengerId: string, rideId: string, reason: string) {
    const result = await this.db.transaction((tx) =>
      this.state.transition(tx, {
        rideId,
        to: 'CANCELLED',
        actor: 'PASSENGER',
        actorId: passengerId,
        reason,
        authorize: (ride) => {
          if (ride.passengerId !== passengerId)
            throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
        },
        prepare: async (ride) => {
          const rule = await this.pricing.ruleById(ride.pricingRuleId, tx);
          const decision = decideCancellationFee({
            policy: toCancellationPolicy(rule),
            actor: 'PASSENGER',
            status: ride.status,
            now: new Date(),
            driverAssignedAt: ride.driverAssignedAt,
            driverArrivedAt: ride.driverArrivedAt,
          });
          return {
            cancelledBy: 'PASSENGER',
            cancellationReason: reason,
            cancellationFeePaise: decision.feePaise,
            cancelledAt: new Date(),
            paymentStatus: decision.feePaise > 0 ? 'PENDING' : 'WAIVED',
          };
        },
      }),
    );
    this.dispatch.notifyRide(result);
    return this.views.forPassenger(result.ride);
  }

  // ---------- driver ----------

  async activeForDriver(driverId: string) {
    const [ride] = await this.db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.driverId, driverId),
          notInArray(rides.status, [...TERMINAL_RIDE_STATUSES, 'REQUESTED', 'SEARCHING']),
        ),
      )
      .limit(1);
    return ride ? this.views.forDriver(ride) : null;
  }

  async historyForDriver(driverId: string, limit = 20, before?: string) {
    const rows = await this.db
      .select()
      .from(rides)
      .where(
        and(
          eq(rides.driverId, driverId),
          before ? lt(rides.requestedAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(rides.requestedAt))
      .limit(limit);
    return Promise.all(rows.map((r) => this.views.forDriver(r)));
  }

  async markArriving(driverId: string, rideId: string) {
    return this.driverTransition(driverId, rideId, 'DRIVER_ARRIVING');
  }

  async markArrived(driverId: string, rideId: string) {
    return this.driverTransition(driverId, rideId, 'DRIVER_ARRIVED', async (ride) => {
      const [loc] = await this.db
        .select({ location: driverLocations.location, recordedAt: driverLocations.recordedAt })
        .from(driverLocations)
        .where(eq(driverLocations.driverId, driverId));
      const fresh =
        loc && Date.now() - loc.recordedAt.getTime() < this.env.LOCATION_MAX_AGE_SECONDS * 1000;
      if (!fresh) {
        throw new AppError(
          422,
          'LOCATION_REQUIRED',
          'Turn on location so we can confirm you have arrived',
        );
      }
      if (haversineMeters(loc.location, ride.pickup) > ARRIVAL_RADIUS_M) {
        throw new AppError(422, 'NOT_AT_PICKUP', 'You are not at the pickup point yet');
      }
      return { driverArrivedAt: new Date() };
    });
  }

  /**
   * Checks the trip PIN the passenger tells the driver. Limited attempts stop a
   * driver from guessing; after that, support must intervene.
   */
  async verifyPin(driverId: string, rideId: string, pin: string) {
    const outcome = await this.db.transaction(async (tx) => {
      const [ride] = await tx.select().from(rides).where(eq(rides.id, rideId)).for('update');
      if (!ride || ride.driverId !== driverId)
        throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
      if (ride.status !== 'DRIVER_ARRIVED') {
        throw new AppError(409, 'INVALID_RIDE_TRANSITION', 'Mark arrival before verifying the PIN');
      }
      if (ride.pickupVerifiedAt) return { ok: true as const, ride };
      if (ride.pickupPinAttempts >= MAX_PIN_ATTEMPTS) {
        throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Contact support');
      }
      const ok = safeEqual(pin, ride.pickupPin);
      const [updated] = await tx
        .update(rides)
        .set(
          ok
            ? { pickupVerifiedAt: new Date(), version: sql`${rides.version} + 1` }
            : { pickupPinAttempts: sql`${rides.pickupPinAttempts} + 1` },
        )
        .where(eq(rides.id, rideId))
        .returning();
      return ok ? { ok: true as const, ride: updated! } : { ok: false as const, ride: updated! };
    });
    if (!outcome.ok) {
      await this.audit.record({
        actorType: 'USER',
        actorId: driverId,
        action: 'ride.pin_incorrect',
        entityType: 'ride',
        entityId: rideId,
        metadata: { attempts: outcome.ride.pickupPinAttempts },
      });
      throw new AppError(400, 'PIN_INCORRECT', 'That PIN is not correct', {
        attemptsRemaining: MAX_PIN_ATTEMPTS - outcome.ride.pickupPinAttempts,
      });
    }
    return this.views.forDriver(outcome.ride);
  }

  async start(driverId: string, rideId: string) {
    return this.driverTransition(driverId, rideId, 'IN_PROGRESS', () => ({
      startedAt: new Date(),
    }));
  }

  /**
   * Completes the trip at the upfront quoted fare plus any waiting charge
   * beyond the free window. The fare is computed here from the stored quote
   * and pricing version; nothing from the client is used.
   */
  async complete(driverId: string, rideId: string) {
    return this.driverTransition(driverId, rideId, 'COMPLETED', async (ride) => {
      const [quote] = await this.db
        .select()
        .from(fareQuotes)
        .where(eq(fareQuotes.id, ride.quoteId));
      const rule = await this.pricing.ruleById(ride.pricingRuleId);
      const waitingSeconds =
        ride.driverArrivedAt && ride.startedAt
          ? Math.max(
              0,
              Math.floor((ride.startedAt.getTime() - ride.driverArrivedAt.getTime()) / 1000),
            )
          : 0;
      const finalBreakdown = calculateFare({
        rule: toDomainRule(rule),
        distanceMeters: quote!.distanceMeters,
        durationSeconds: quote!.durationSeconds,
        waitingSeconds,
        surgeMultiplierBps: quote!.surgeMultiplierBps,
        discountPaise: quote!.breakdown.discountPaise,
      });
      return {
        completedAt: new Date(),
        finalBreakdown,
        finalTotalPaise: finalBreakdown.totalPaise,
        paymentStatus: 'PENDING',
      };
    });
  }

  /** Driver backs out before pickup: the ride returns to SEARCHING and is re-dispatched. */
  async cancelByDriver(driverId: string, rideId: string, reason: string) {
    const result = await this.db.transaction((tx) =>
      this.state.transition(tx, {
        rideId,
        to: 'SEARCHING',
        actor: 'DRIVER',
        actorId: driverId,
        reason,
        authorize: (ride) => {
          if (ride.driverId !== driverId)
            throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
        },
        prepare: () => ({
          driverId: null,
          vehicleId: null,
          driverAssignedAt: null,
          driverArrivedAt: null,
          pickupVerifiedAt: null,
          pickupPinAttempts: 0,
          // The search window restarts; the old driver is excluded from re-offers.
          searchStartedAt: new Date(),
        }),
        metadata: { cancelledDriverId: driverId },
      }),
    );
    await this.audit.record({
      actorType: 'USER',
      actorId: driverId,
      action: 'ride.driver_cancelled',
      entityType: 'ride',
      entityId: rideId,
    });
    this.dispatch.notifyRide(result);
    await this.dispatch.dispatchNext(rideId);
    return { rideId, status: 'SEARCHING' as const };
  }

  private async driverTransition(
    driverId: string,
    rideId: string,
    to: 'DRIVER_ARRIVING' | 'DRIVER_ARRIVED' | 'IN_PROGRESS' | 'COMPLETED',
    prepare?: (
      ride: RideRow,
    ) => Partial<typeof rides.$inferInsert> | Promise<Partial<typeof rides.$inferInsert>>,
  ) {
    const result = await this.db.transaction((tx) =>
      this.state.transition(tx, {
        rideId,
        to,
        actor: 'DRIVER',
        actorId: driverId,
        authorize: (ride) => {
          if (ride.driverId !== driverId)
            throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
        },
        prepare,
      }),
    );
    this.dispatch.notifyRide(result);
    return this.views.forDriver(result.ride);
  }

  private async load(rideId: string): Promise<RideRow> {
    const [ride] = await this.db.select().from(rides).where(eq(rides.id, rideId));
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    return ride;
  }
}
