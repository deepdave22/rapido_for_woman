import { Inject, Injectable } from '@nestjs/common';
import { assertLatLng, calculateFare, haversineMeters } from '@saheli/domain';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { fareQuotes } from '../database/schema';
import { ROUTING, RoutingProvider } from '../integrations/maps';
import { geoPoint, PricingService, toDomainRule } from '../pricing/pricing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { QuoteRequestDto } from './rides.dto';

const MIN_TRIP_METERS = 300;
const MAX_TRIP_METERS = 100_000;
/** Assumed city speed for "driver is N min away" when routing each driver is too costly. */
const PICKUP_SPEED_MPS = 20_000 / 3600;

@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ROUTING) private readonly routing: RoutingProvider,
    private readonly pricing: PricingService,
    private readonly promotions: PromotionsService,
    private readonly env: Env,
  ) {}

  /**
   * Prices a trip for every available category. Each option is stored as a
   * quote that can be booked, unchanged, until it expires.
   */
  async quote(passengerId: string, dto: QuoteRequestDto) {
    assertLatLng(dto.pickup, 'pickup');
    assertLatLng(dto.dropoff, 'dropoff');
    if (haversineMeters(dto.pickup, dto.dropoff) < MIN_TRIP_METERS) {
      throw new AppError(422, 'TRIP_TOO_SHORT', 'Pickup and drop are too close together');
    }
    const [zone, dropZone] = await Promise.all([
      this.pricing.findZone(dto.pickup),
      this.pricing.findZone(dto.dropoff),
    ]);
    if (!zone || !dropZone || zone.id !== dropZone.id) {
      throw new AppError(422, 'OUTSIDE_SERVICE_AREA', 'We do not serve this trip yet');
    }

    const route = await this.routing.route(dto.pickup, dto.dropoff);
    if (route.distanceMeters > MAX_TRIP_METERS) {
      throw new AppError(422, 'TRIP_TOO_LONG', 'This trip is longer than we currently support');
    }
    const promo = dto.promoCode
      ? await this.promotions.findRedeemable(dto.promoCode, passengerId)
      : null;

    const [nearby, rules] = await Promise.all([
      this.nearbyDrivers(dto.pickup),
      this.pricing.currentRulesForZone(zone.id),
    ]);
    const expiresAt = new Date(Date.now() + this.env.QUOTE_TTL_SECONDS * 1000);
    const priced = rules.map(({ rule, displayName, seats }) => {
      const fareInput = {
        rule: toDomainRule(rule),
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      };
      const undiscounted = calculateFare(fareInput);
      const discountPaise = promo
        ? this.promotions.discountFor(promo, undiscounted.rideFarePaise)
        : 0;
      const breakdown = discountPaise
        ? calculateFare({ ...fareInput, discountPaise })
        : undiscounted;
      return { rule, displayName, seats, breakdown, discountPaise };
    });
    // One insert for all options.
    const inserted = priced.length
      ? await this.db
          .insert(fareQuotes)
          .values(
            priced.map((x) => ({
              passengerId,
              zoneId: zone.id,
              categoryCode: x.rule.categoryCode,
              pricingRuleId: x.rule.id,
              pickup: { lat: dto.pickup.lat, lng: dto.pickup.lng },
              pickupAddress: dto.pickup.address,
              dropoff: { lat: dto.dropoff.lat, lng: dto.dropoff.lng },
              dropoffAddress: dto.dropoff.address,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              routeProvider: route.provider,
              promotionId: x.discountPaise ? promo!.id : null,
              breakdown: x.breakdown,
              totalPaise: x.breakdown.totalPaise,
              expiresAt,
            })),
          )
          .returning({ id: fareQuotes.id, categoryCode: fareQuotes.categoryCode })
      : [];
    const options = priced.map((x) => {
      const nearest = nearby.get(x.rule.categoryCode);
      return {
        quoteId: inserted.find((r) => r.categoryCode === x.rule.categoryCode)!.id,
        categoryCode: x.rule.categoryCode,
        displayName: x.displayName,
        seats: x.seats,
        totalPaise: x.breakdown.totalPaise,
        breakdown: x.breakdown,
        expiresAt,
        driversNearby: nearest !== undefined,
        pickupEtaSeconds:
          nearest !== undefined ? Math.max(60, Math.round(nearest / PICKUP_SPEED_MPS)) : null,
      };
    });
    if (!options.length) {
      throw new AppError(422, 'NO_SERVICE_AVAILABLE', 'No ride types are available here right now');
    }
    return {
      zone: { id: zone.id, city: zone.city },
      route,
      promo: promo
        ? { code: promo.code, applied: options.some((o) => o.breakdown.discountPaise > 0) }
        : null,
      options,
    };
  }

  /** Nearest free online driver per category within 5 km (metres). */
  private async nearbyDrivers(pickup: { lat: number; lng: number }): Promise<Map<string, number>> {
    const point = geoPoint(pickup);
    const { rows } = await this.db.execute<{ category_code: string; distance_m: number }>(sql`
      SELECT v.category_code, MIN(ST_Distance(dl.location, ${point}))::int AS distance_m
        FROM driver_locations dl
        JOIN driver_availability da ON da.driver_id = dl.driver_id
        JOIN driver_profiles dp ON dp.user_id = dl.driver_id
        JOIN vehicles v ON v.id = da.vehicle_id
       WHERE da.is_online AND da.active_ride_id IS NULL AND dp.status = 'APPROVED' AND v.status = 'ACTIVE'
         AND dl.recorded_at > now() - make_interval(secs => ${this.env.LOCATION_MAX_AGE_SECONDS})
         AND ST_DWithin(dl.location, ${point}, 5000)
       GROUP BY v.category_code`);
    return new Map(rows.map((r) => [r.category_code, Number(r.distance_m)]));
  }
}
