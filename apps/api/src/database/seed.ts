import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { createDatabase, Database } from './database.module';
import { pricingRules, serviceCategories, serviceZones } from './schema';

/**
 * Reference data for development and tests. Prices are SYNTHETIC placeholders,
 * not a commercial tariff. Real tariffs are created as new pricing versions by
 * operations staff after tax and regulatory review (docs/LAUNCH_BLOCKERS.md).
 */
export const PILOT_ZONE_NAME = 'Bengaluru pilot (synthetic dev data)';

/** Rough bounding polygon around central Bengaluru, lng/lat. */
export const PILOT_ZONE_WKT =
  'MULTIPOLYGON(((77.45 12.82, 77.80 12.82, 77.80 13.10, 77.45 13.10, 77.45 12.82)))';

const SYNTHETIC_PRICES = {
  BIKE: {
    base: 2000,
    included: 1500,
    perKm: 600,
    perMin: 50,
    min: 2500,
    fee: 200,
    commission: 1500,
    cancel: 1000,
  },
  AUTO: {
    base: 3000,
    included: 1800,
    perKm: 1500,
    perMin: 100,
    min: 3500,
    fee: 300,
    commission: 1500,
    cancel: 2000,
  },
  CAB: {
    base: 5000,
    included: 2000,
    perKm: 1800,
    perMin: 150,
    min: 8000,
    fee: 500,
    commission: 2000,
    cancel: 5000,
  },
} as const;

export async function seedReferenceData(db: Database): Promise<{ zoneId: string }> {
  await db
    .insert(serviceCategories)
    .values([
      { code: 'BIKE', displayName: 'Bike', seats: 1, sortOrder: 1 },
      { code: 'AUTO', displayName: 'Auto', seats: 3, sortOrder: 2 },
      { code: 'CAB', displayName: 'Cab', seats: 4, sortOrder: 3 },
    ])
    .onConflictDoNothing();

  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM service_zones WHERE name = ${PILOT_ZONE_NAME} LIMIT 1`,
  );
  let zoneId = existing.rows[0]?.id;
  if (!zoneId) {
    const [zone] = await db
      .insert(serviceZones)
      .values({
        city: 'Bengaluru',
        name: PILOT_ZONE_NAME,
        boundary: sql`ST_GeogFromText(${'SRID=4326;' + PILOT_ZONE_WKT})` as unknown as string,
        active: true,
      })
      .returning({ id: serviceZones.id });
    zoneId = zone!.id;
  }

  for (const [categoryCode, p] of Object.entries(SYNTHETIC_PRICES)) {
    await db
      .insert(pricingRules)
      .values({
        zoneId,
        categoryCode,
        version: 1,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        baseFarePaise: p.base,
        includedDistanceMeters: p.included,
        perKmPaise: p.perKm,
        perMinutePaise: p.perMin,
        minimumFarePaise: p.min,
        bookingFeePaise: p.fee,
        taxRateBps: 500,
        waitingFreeSeconds: 180,
        waitingPerMinutePaise: 100,
        commissionRateBps: p.commission,
        cancellationFeePaise: p.cancel,
        cancellationFreeWindowSeconds: 120,
        cancellationArrivedGraceSeconds: 180,
        changeNote: 'Synthetic development pricing',
      })
      .onConflictDoNothing();
  }
  return { zoneId };
}

if (require.main === module) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    console.error('Refusing to seed synthetic data into', process.env.NODE_ENV);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  seedReferenceData(createDatabase(pool))
    .then(({ zoneId }) => console.log('Seeded reference data. Pilot zone:', zoneId))
    .catch((err: unknown) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
