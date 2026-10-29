import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, geographyPoint, updatedAt } from './types';
import {
  auditActorType,
  incidentSeverity,
  incidentStatus,
  incidentType,
  notificationChannel,
  notificationStatus,
  ticketPriority,
  ticketStatus,
  userRole,
} from './enums';
import { staffUsers, users } from './identity';
import { rides } from './rides';

export const trustedContacts = pgTable(
  'trusted_contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    phoneE164: text('phone_e164').notNull(),
    relationship: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trusted_contacts_user_phone_uq').on(t.userId, t.phoneE164),
    check('trusted_contacts_phone_ck', sql`${t.phoneE164} ~ '^\\+91[6-9][0-9]{9}$'`),
  ],
);

/** Revocable, expiring link that lets a trusted contact follow one trip. */
export const tripShares = pgTable(
  'trip_shares',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trip_shares_token_uq').on(t.tokenHash),
    index('trip_shares_ride_idx').on(t.rideId),
  ],
);

/**
 * SOS and safety reports. `responseInitiatedAt` is set only when a staff member
 * records an actual response; the apps show that state truthfully.
 */
export const safetyIncidents = pgTable(
  'safety_incidents',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid().references(() => rides.id),
    reporterUserId: uuid()
      .notNull()
      .references(() => users.id),
    reporterRole: userRole().notNull(),
    type: incidentType().notNull(),
    severity: incidentSeverity().notNull(),
    status: incidentStatus().notNull().default('OPEN'),
    location: geographyPoint(),
    description: text(),
    assignedStaffId: uuid().references(() => staffUsers.id),
    acknowledgedAt: timestamp({ withTimezone: true }),
    responseInitiatedAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
    resolutionSummary: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('safety_incidents_open_idx')
      .on(t.severity, t.createdAt)
      .where(sql`${t.status} IN ('OPEN','ACKNOWLEDGED','RESPONDING')`),
    index('safety_incidents_ride_idx').on(t.rideId),
    index('safety_incidents_reporter_idx').on(t.reporterUserId),
  ],
);

export const incidentEvents = pgTable(
  'incident_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    incidentId: uuid()
      .notNull()
      .references(() => safetyIncidents.id, { onDelete: 'cascade' }),
    staffUserId: uuid().references(() => staffUsers.id),
    action: text().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('incident_events_incident_idx').on(t.incidentId, t.id)],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    rideId: uuid().references(() => rides.id),
    category: text().notNull(),
    priority: ticketPriority().notNull().default('NORMAL'),
    status: ticketStatus().notNull().default('OPEN'),
    subject: text().notNull(),
    assignedStaffId: uuid().references(() => staffUsers.id),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_tickets_queue_idx').on(t.status, t.priority, t.createdAt),
    index('support_tickets_user_idx').on(t.userId),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    ticketId: uuid()
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid().references(() => users.id),
    authorStaffId: uuid().references(() => staffUsers.id),
    body: text().notNull(),
    internalNote: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('support_messages_ticket_idx').on(t.ticketId, t.id),
    check(
      'support_messages_author_ck',
      sql`(${t.authorUserId} IS NULL) <> (${t.authorStaffId} IS NULL)`,
    ),
  ],
);

export const ratings = pgTable(
  'ratings',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id),
    raterUserId: uuid()
      .notNull()
      .references(() => users.id),
    rateeUserId: uuid()
      .notNull()
      .references(() => users.id),
    raterRole: userRole().notNull(),
    stars: smallint().notNull(),
    comment: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ratings_one_per_rater_uq').on(t.rideId, t.raterUserId),
    index('ratings_ratee_idx').on(t.rateeUserId),
    check('ratings_stars_ck', sql`${t.stars} BETWEEN 1 AND 5`),
    check('ratings_not_self_ck', sql`${t.raterUserId} <> ${t.rateeUserId}`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** For trusted-contact SMS, where the recipient is not a user. */
    recipientPhoneE164: text('recipient_phone_e164'),
    channel: notificationChannel().notNull(),
    template: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: notificationStatus().notNull().default('QUEUED'),
    attempts: integer().notNull().default(0),
    lastError: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    index('notifications_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'QUEUED'`),
    check(
      'notifications_recipient_ck',
      sql`${t.userId} IS NOT NULL OR ${t.recipientPhoneE164} IS NOT NULL`,
    ),
  ],
);

/**
 * Who did what to which record. Append-only (trigger-enforced). Metadata must
 * not contain personal data beyond identifiers.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorType: auditActorType().notNull(),
    actorId: uuid(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    ip: inet(),
    requestId: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_actor_idx').on(t.actorType, t.actorId, t.createdAt),
  ],
);
