import { Inject, Injectable } from '@nestjs/common';
import { CancellationPolicy, LatLng, PricingRule } from '@saheli/domain';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { DB, Database, Tx } from '../database/database.module';
import { pricingRules, serviceCategories, serviceZones } from '../database/schema';

export type PricingRuleRow = typeof pricingRules.$inferSelect;

export function toDomainRule(row: PricingRuleRow): PricingRule {
  return {
    baseFarePaise: row.baseFarePaise,
    includedDistanceMeters: row.includedDistanceMeters,
    perKmPaise: row.perKmPaise,
    perMinutePaise: row.perMinutePaise,
    minimumFarePaise: row.minimumFarePaise,
    bookingFeePaise: row.bookingFeePaise,
    taxRateBps: row.taxRateBps,
    waitingFreeSeconds: row.waitingFreeSeconds,
    waitingPerMinutePaise: row.waitingPerMinutePaise,
    commissionRateBps: row.commissionRateBps,
  };
}

export function toCancellationPolicy(row: PricingRuleRow): CancellationPolicy {
  return {
    passengerFeePaise: row.cancellationFeePaise,
    freeWindowSeconds: row.cancellationFreeWindowSeconds,
    arrivedGraceSeconds: row.cancellationArrivedGraceSeconds,
  };
}

/** SQL expression for a geography point; parameters are bound, never interpolated. */
export const geoPoint = (p: LatLng) =>
  sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;

@Injectable()
export class PricingService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The active service zone covering a point, if any. */
  async findZone(point: LatLng): Promise<{ id: string; city: string } | null> {
    const [zone] = await this.db
      .select({ id: serviceZones.id, city: serviceZones.city })
      .from(serviceZones)
      .where(
        and(
          eq(serviceZones.active, true),
          sql`ST_Covers(${serviceZones.boundary}, ${geoPoint(point)})`,
        ),
      )
      .limit(1);
    return zone ?? null;
  }

  async activeCategories(): Promise<{ code: string; displayName: string; seats: number }[]> {
    return this.db
      .select({
        code: serviceCategories.code,
        displayName: serviceCategories.displayName,
        seats: serviceCategories.seats,
      })
      .from(serviceCategories)
      .where(eq(serviceCategories.active, true))
      .orderBy(serviceCategories.sortOrder);
  }

  /** The newest published version in effect now for a zone and category. */
  async currentRule(
    zoneId: string,
    categoryCode: string,
    at = new Date(),
  ): Promise<PricingRuleRow | null> {
    const [rule] = await this.db
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.zoneId, zoneId),
          eq(pricingRules.categoryCode, categoryCode),
          lte(pricingRules.effectiveFrom, at),
        ),
      )
      .orderBy(desc(pricingRules.effectiveFrom), desc(pricingRules.version))
      .limit(1);
    return rule ?? null;
  }

  async ruleById(id: string, tx?: Tx): Promise<PricingRuleRow> {
    const [rule] = await (tx ?? this.db).select().from(pricingRules).where(eq(pricingRules.id, id));
    if (!rule) throw new Error(`Pricing rule ${id} missing`);
    return rule;
  }
}
