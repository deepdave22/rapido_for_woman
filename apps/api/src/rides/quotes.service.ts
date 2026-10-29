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
    const zone = await this.pricing.findZone(dto.pickup);
    const dropZone = await this.pricing.findZone(dto.dropoff);
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

    const nearby = await this.nearbyDrivers(dto.pickup);
    const expiresAt = new Date(Date.now() + this.env.QUOTE_TTL_SECONDS * 1000);
    const options = [];
    for (const category of await this.pricing.activeCategories()) {
      const rule = await this.pricing.currentRule(zone.id, category.code);
      if (!rule) continue;
      const undiscounted = calculateFare({
        rule: toDomainRule(rule),
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      });
      const discountPaise = promo
        ? this.promotions.discountFor(promo, undiscounted.rideFarePaise)
        : 0;
      const breakdown = discountPaise
        ? calculateFare({
            rule: toDomainRule(rule),
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            discountPaise,
          })
        : undiscounted;
      const [row] = await this.db
        .insert(fareQuotes)
        .values({
          passengerId,
          zoneId: zone.id,
          categoryCode: category.code,
          pricingRuleId: rule.id,
          pickup: { lat: dto.pickup.lat, lng: dto.pickup.lng },
          pickupAddress: dto.pickup.address,
          dropoff: { lat: dto.dropoff.lat, lng: dto.dropoff.lng },
          dropoffAddress: dto.dropoff.address,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          routeProvider: route.provider,
          promotionId: discountPaise ? promo!.id : null,
          breakdown,
          totalPaise: breakdown.totalPaise,
          expiresAt,
        })
        .returning({ id: fareQuotes.id });
      const nearest = nearby.get(category.code);
      options.push({
        quoteId: row!.id,
        categoryCode: category.code,
        displayName: category.displayName,
        seats: category.seats,
        totalPaise: breakdown.totalPaise,
        breakdown,
        expiresAt,
        driversNearby: nearest !== undefined,
        pickupEtaSeconds:
          nearest !== undefined ? Math.max(60, Math.round(nearest / PICKUP_SPEED_MPS)) : null,
      });
    }
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
