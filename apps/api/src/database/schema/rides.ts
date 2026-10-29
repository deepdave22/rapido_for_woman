import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FareBreakdown } from '@saheli/domain';
import { createdAt, geographyPoint, updatedAt } from './types';
import {
  assignmentStatus,
  paymentMethod,
  paymentStatus,
  placeLabel,
  rideActor,
  rideStatus,
} from './enums';
import { staffUsers, users } from './identity';
import { driverProfiles, serviceCategories, serviceZones, vehicles } from './drivers';

/**
 * Versioned, immutable once published: changing prices means inserting a new
 * version. Quotes and rides reference the exact version they were priced with.
 */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    zoneId: uuid()
      .notNull()
      .references(() => serviceZones.id),
    categoryCode: text()
      .notNull()
      .references(() => serviceCategories.code),
    version: integer().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    baseFarePaise: integer().notNull(),
    includedDistanceMeters: integer().notNull(),
    perKmPaise: integer().notNull(),
    perMinutePaise: integer().notNull(),
    minimumFarePaise: integer().notNull(),
    bookingFeePaise: integer().notNull(),
    taxRateBps: integer().notNull(),
    waitingFreeSeconds: integer().notNull(),
    waitingPerMinutePaise: integer().notNull(),
    commissionRateBps: integer().notNull(),
    maxSurgeBps: integer().notNull().default(10000),
    cancellationFeePaise: integer().notNull(),
    cancellationFreeWindowSeconds: integer().notNull(),
    cancellationArrivedGraceSeconds: integer().notNull(),
    createdBy: uuid().references(() => staffUsers.id),
    changeNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pricing_rules_version_uq').on(t.zoneId, t.categoryCode, t.version),
    index('pricing_rules_lookup_idx').on(t.zoneId, t.categoryCode, t.effectiveFrom),
    check(
      'pricing_rules_amounts_ck',
      sql`${t.baseFarePaise} >= 0 AND ${t.perKmPaise} >= 0 AND ${t.perMinutePaise} >= 0
        AND ${t.minimumFarePaise} >= 0 AND ${t.bookingFeePaise} >= 0
        AND ${t.waitingPerMinutePaise} >= 0 AND ${t.cancellationFeePaise} >= 0
        AND ${t.includedDistanceMeters} >= 0 AND ${t.waitingFreeSeconds} >= 0`,
    ),
    check('pricing_rules_tax_ck', sql`${t.taxRateBps} BETWEEN 0 AND 5000`),
    check('pricing_rules_commission_ck', sql`${t.commissionRateBps} BETWEEN 0 AND 10000`),
    check('pricing_rules_surge_ck', sql`${t.maxSurgeBps} BETWEEN 10000 AND 30000`),
  ],
);

export const savedPlaces = pgTable(
  'saved_places',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: placeLabel().notNull(),
    name: text().notNull(),
    address: text().notNull(),
    location: geographyPoint().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('saved_places_user_idx').on(t.userId),
    uniqueIndex('saved_places_home_work_uq')
      .on(t.userId, t.label)
      .where(sql`${t.label} IN ('HOME', 'WORK')`),
  ],
);

/** A priced offer shown to the passenger. Booking must reference an unexpired, unused quote. */
export const fareQuotes = pgTable(
  'fare_quotes',
  {
    id: uuid().primaryKey().defaultRandom(),
    passengerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    zoneId: uuid()
      .notNull()
      .references(() => serviceZones.id),
    categoryCode: text()
      .notNull()
      .references(() => serviceCategories.code),
    pricingRuleId: uuid()
      .notNull()
      .references(() => pricingRules.id),
    pickup: geographyPoint().notNull(),
    pickupAddress: text().notNull(),
    dropoff: geographyPoint().notNull(),
    dropoffAddress: text().notNull(),
    distanceMeters: integer().notNull(),
    durationSeconds: integer().notNull(),
    routeProvider: text().notNull(),
    surgeMultiplierBps: integer().notNull().default(10000),
    promotionId: uuid(),
    breakdown: jsonb().$type<FareBreakdown>().notNull(),
    totalPaise: integer().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('fare_quotes_passenger_idx').on(t.passengerId, t.createdAt),
    check('fare_quotes_total_ck', sql`${t.totalPaise} >= 0`),
  ],
);

export const rides = pgTable(
  'rides',
  {
    id: uuid().primaryKey().defaultRandom(),
    passengerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    driverId: uuid().references(() => driverProfiles.userId, { onDelete: 'restrict' }),
    vehicleId: uuid().references(() => vehicles.id),
    zoneId: uuid()
      .notNull()
      .references(() => serviceZones.id),
    categoryCode: text()
      .notNull()
      .references(() => serviceCategories.code),
    quoteId: uuid()
      .notNull()
      .references(() => fareQuotes.id),
    pricingRuleId: uuid()
      .notNull()
      .references(() => pricingRules.id),
    status: rideStatus().notNull().default('REQUESTED'),
    pickup: geographyPoint().notNull(),
    pickupAddress: text().notNull(),
    dropoff: geographyPoint().notNull(),
    dropoffAddress: text().notNull(),
    /** Four-digit code the passenger tells the driver at pickup. Shown only to the passenger. */
    pickupPin: text().notNull(),
    pickupPinAttempts: smallint().notNull().default(0),
    pickupVerifiedAt: timestamp({ withTimezone: true }),
    quotedTotalPaise: integer().notNull(),
    finalBreakdown: jsonb().$type<FareBreakdown>(),
    finalTotalPaise: integer(),
    paymentMethod: paymentMethod().notNull(),
    paymentStatus: paymentStatus().notNull().default('NOT_STARTED'),
    cancelledBy: rideActor(),
    cancellationReason: text(),
    cancellationFeePaise: integer().notNull().default(0),
    dispatchRound: smallint().notNull().default(0),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    driverAssignedAt: timestamp({ withTimezone: true }),
    driverArrivedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Optimistic concurrency: every state change increments this. */
    version: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('rides_quote_uq').on(t.quoteId),
    // At most one live ride per passenger and one engaged ride per driver,
    // enforced by the database so races cannot violate it.
    uniqueIndex('rides_one_active_per_passenger_uq')
      .on(t.passengerId)
      .where(
        sql`${t.status} IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`,
      ),
    uniqueIndex('rides_one_engaged_per_driver_uq')
      .on(t.driverId)
      .where(
        sql`${t.status} IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`,
      ),
    index('rides_passenger_idx').on(t.passengerId, t.requestedAt),
    index('rides_driver_idx').on(t.driverId, t.requestedAt),
    index('rides_status_idx').on(t.status),
    check('rides_pin_ck', sql`${t.pickupPin} ~ '^[0-9]{4}$'`),
    check(
      'rides_amounts_ck',
      sql`${t.quotedTotalPaise} >= 0 AND ${t.cancellationFeePaise} >= 0
        AND (${t.finalTotalPaise} IS NULL OR ${t.finalTotalPaise} >= 0)`,
    ),
    check(
      'rides_driver_required_ck',
      sql`${t.status} IN ('REQUESTED','SEARCHING','NO_DRIVER_FOUND','CANCELLED') OR ${t.driverId} IS NOT NULL`,
    ),
    check(
      'rides_started_verified_ck',
      sql`${t.startedAt} IS NULL OR ${t.pickupVerifiedAt} IS NOT NULL`,
    ),
  ],
);

/** Append-only history of every status change. */
export const rideEvents = pgTable(
  'ride_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    fromStatus: rideStatus(),
    toStatus: rideStatus().notNull(),
    actorType: rideActor().notNull(),
    actorId: uuid(),
    reason: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('ride_events_ride_idx').on(t.rideId, t.id)],
);

/** Each offer sent to a driver during dispatch, and its outcome. */
export const rideAssignments = pgTable(
  'ride_assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid()
      .notNull()
      .references(() => driverProfiles.userId),
    dispatchRound: smallint().notNull(),
    status: assignmentStatus().notNull().default('OFFERED'),
    pickupDistanceMeters: integer().notNull(),
    score: integer().notNull(),
    offeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    respondedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ride_assignments_round_uq').on(t.rideId, t.driverId, t.dispatchRound),
    uniqueIndex('ride_assignments_one_accepted_uq')
      .on(t.rideId)
      .where(sql`${t.status} = 'ACCEPTED'`),
    index('ride_assignments_driver_idx').on(t.driverId, t.offeredAt),
    index('ride_assignments_open_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'OFFERED'`),
  ],
);

/** Breadcrumbs during an active ride, for safety review. Purged per the retention policy. */
export const rideLocationPoints = pgTable(
  'ride_location_points',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    location: geographyPoint().notNull(),
    accuracyM: integer(),
    recordedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index('ride_location_points_ride_idx').on(t.rideId, t.recordedAt)],
);
