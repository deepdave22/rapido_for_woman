import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, geographyMultiPolygon, geographyPoint, updatedAt } from './types';
import {
  documentStatus,
  documentType,
  driverStatus,
  vehicleStatus,
  verificationCheck,
  verificationStatus,
} from './enums';
import { staffUsers, users } from './identity';

export const serviceCategories = pgTable('service_categories', {
  /** BIKE, AUTO, CAB. */
  code: text().primaryKey(),
  displayName: text().notNull(),
  seats: smallint().notNull(),
  active: boolean().notNull().default(true),
  sortOrder: smallint().notNull().default(0),
  createdAt: createdAt(),
});

/** A city or area the service operates in. Bookings outside every active zone are refused. */
export const serviceZones = pgTable(
  'service_zones',
  {
    id: uuid().primaryKey().defaultRandom(),
    city: text().notNull(),
    name: text().notNull(),
    boundary: geographyMultiPolygon().notNull(),
    timezone: text().notNull().default('Asia/Kolkata'),
    active: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('service_zones_boundary_gix').using('gist', t.boundary)],
);

export const driverProfiles = pgTable(
  'driver_profiles',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: driverStatus().notNull().default('ONBOARDING'),
    homeZoneId: uuid().references(() => serviceZones.id),
    submittedAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    approvedBy: uuid().references(() => staffUsers.id),
    statusReason: text(),
    ratingSum: integer().notNull().default(0),
    ratingCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('driver_profiles_status_idx').on(t.status),
    check('driver_rating_ck', sql`${t.ratingSum} >= 0 AND ${t.ratingCount} >= 0`),
  ],
);

/**
 * Server-side record of each verification check. A driver can go online only
 * when every required check has a PASSED, unexpired row. Results of external
 * providers are referenced, not copied, to avoid duplicating identity data.
 */
export const driverVerifications = pgTable(
  'driver_verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    driverId: uuid()
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    check: verificationCheck().notNull(),
    status: verificationStatus().notNull().default('PENDING'),
    provider: text(),
    providerReference: text(),
    reviewedBy: uuid().references(() => staffUsers.id),
    reviewedAt: timestamp({ withTimezone: true }),
    notes: text(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('driver_verifications_driver_check_idx').on(t.driverId, t.check, t.createdAt)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid().primaryKey().defaultRandom(),
    driverId: uuid()
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'restrict' }),
    categoryCode: text()
      .notNull()
      .references(() => serviceCategories.code),
    registrationNumber: text().notNull(),
    make: text().notNull(),
    model: text().notNull(),
    colour: text().notNull(),
    manufactureYear: smallint(),
    status: vehicleStatus().notNull().default('PENDING_REVIEW'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('vehicles_registration_uq').on(sql`upper(${t.registrationNumber})`),
    index('vehicles_driver_idx').on(t.driverId),
  ],
);

/** Files live in private object storage; only the key and review state are here. */
export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    driverId: uuid()
      .notNull()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    vehicleId: uuid().references(() => vehicles.id, { onDelete: 'cascade' }),
    type: documentType().notNull(),
    storageKey: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    status: documentStatus().notNull().default('UPLOADED'),
    expiresOn: date({ mode: 'string' }),
    reviewedBy: uuid().references(() => staffUsers.id),
    reviewedAt: timestamp({ withTimezone: true }),
    rejectionReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('driver_documents_driver_idx').on(t.driverId, t.type),
    index('driver_documents_expiry_idx').on(t.expiresOn),
    check('driver_documents_size_ck', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`),
  ],
);

/** Current availability. One row per driver; the source of truth for "can be dispatched". */
export const driverAvailability = pgTable(
  'driver_availability',
  {
    driverId: uuid()
      .primaryKey()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    isOnline: boolean().notNull().default(false),
    vehicleId: uuid().references(() => vehicles.id),
    /** Set while the driver holds a pending offer or an engaged ride. */
    activeRideId: uuid(),
    wentOnlineAt: timestamp({ withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('driver_availability_online_idx')
      .on(t.isOnline)
      .where(sql`${t.isOnline}`),
  ],
);

/** Latest known position per driver (overwritten). Dispatch searches this with a GiST index. */
export const driverLocations = pgTable(
  'driver_locations',
  {
    driverId: uuid()
      .primaryKey()
      .references(() => driverProfiles.userId, { onDelete: 'cascade' }),
    location: geographyPoint().notNull(),
    headingDeg: real(),
    speedMps: real(),
    accuracyM: real(),
    recordedAt: timestamp({ withTimezone: true }).notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_locations_gix').using('gist', t.location),
    index('driver_locations_recorded_idx').on(t.recordedAt),
  ],
);
