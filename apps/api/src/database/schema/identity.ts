import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './types';
import {
  clientApp,
  eligibilityStatus,
  otpPurpose,
  pushPlatform,
  staffRole,
  staffStatus,
  userRole,
  userStatus,
} from './enums';

/** Passengers and drivers. Identified by a verified Indian mobile number. */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    status: userStatus().notNull().default('ACTIVE'),
    fullName: text(),
    email: text(),
    dateOfBirth: date({ mode: 'string' }),
    profilePhotoKey: text(),
    preferredLanguage: text().notNull().default('en-IN'),
    suspendedReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_phone_uq').on(t.phoneE164),
    check('users_phone_e164_ck', sql`${t.phoneE164} ~ '^\\+91[6-9][0-9]{9}$'`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRole().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** One OTP challenge per send. Only a keyed hash of the code is stored. */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid().primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    purpose: otpPurpose().notNull().default('LOGIN'),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    requestIp: inet(),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_challenges_phone_created_idx').on(t.phoneE164, t.createdAt),
    index('otp_challenges_ip_created_idx').on(t.requestIp, t.createdAt),
    check('otp_attempts_ck', sql`${t.attempts} >= 0 AND ${t.attempts} <= ${t.maxAttempts}`),
  ],
);

/**
 * A signed-in device. The refresh token is opaque and stored hashed; each
 * refresh rotates it. Presenting an already-rotated token revokes the whole
 * family (token theft detection).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: clientApp().notNull(),
    familyId: uuid().notNull(),
    refreshTokenHash: text().notNull(),
    deviceName: text(),
    userAgent: text(),
    ip: inet(),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    rotatedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
  },
  (t) => [
    uniqueIndex('sessions_refresh_hash_uq').on(t.refreshTokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
  ],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'cascade' }),
    platform: pushPlatform().notNull(),
    token: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_tokens_token_uq').on(t.token),
    index('push_tokens_user_idx').on(t.userId),
  ],
);

export const passengerProfiles = pgTable('passenger_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** How eligibility for the women-only service is established is a legal decision; see docs. */
  eligibilityStatus: eligibilityStatus().notNull().default('PENDING'),
  eligibilityMethod: text(),
  eligibilityDecidedAt: timestamp({ withTimezone: true }),
  termsVersionAccepted: text(),
  termsAcceptedAt: timestamp({ withTimezone: true }),
  privacyVersionAccepted: text(),
  safetyIntroCompletedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Operations staff. Separate from app users; email + password + mandatory TOTP. */
export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    /** TOTP secret, encrypted with the app's data-encryption key. */
    totpSecretEncrypted: text(),
    mfaEnrolledAt: timestamp({ withTimezone: true }),
    status: staffStatus().notNull().default('ACTIVE'),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('staff_users_email_uq').on(sql`lower(${t.email})`)],
);

export const staffRoleAssignments = pgTable(
  'staff_role_assignments',
  {
    staffUserId: uuid()
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    role: staffRole().notNull(),
    grantedBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.staffUserId, t.role] })],
);

export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    staffUserId: uuid()
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    refreshTokenHash: text().notNull(),
    mfaVerified: boolean().notNull().default(false),
    userAgent: text(),
    ip: inet(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('staff_sessions_refresh_hash_uq').on(t.refreshTokenHash)],
);
