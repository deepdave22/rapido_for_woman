import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './types';
import {
  discountType,
  ledgerAccount,
  ledgerDirection,
  paymentMethod,
  paymentStatus,
  payoutStatus,
  refundStatus,
} from './enums';
import { staffUsers, users } from './identity';
import { driverProfiles } from './drivers';
import { rides } from './rides';

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    rideId: uuid()
      .notNull()
      .references(() => rides.id),
    payerUserId: uuid()
      .notNull()
      .references(() => users.id),
    method: paymentMethod().notNull(),
    /** 'cash', 'razorpay', or 'sandbox'. Sandbox payments are never real money. */
    provider: text().notNull(),
    providerOrderId: text(),
    providerPaymentId: text(),
    amountPaise: integer().notNull(),
    currency: text().notNull().default('INR'),
    status: paymentStatus().notNull().default('PENDING'),
    failureReason: text(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_provider_order_uq')
      .on(t.provider, t.providerOrderId)
      .where(sql`${t.providerOrderId} IS NOT NULL`),
    uniqueIndex('payments_provider_payment_uq')
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    index('payments_ride_idx').on(t.rideId),
    check('payments_amount_ck', sql`${t.amountPaise} > 0`),
    check('payments_currency_ck', sql`${t.currency} = 'INR'`),
  ],
);

/** Inbound gateway webhooks, stored before processing so duplicates are ignored. */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    providerEventId: text().notNull(),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    processingError: text(),
  },
  (t) => [uniqueIndex('payment_webhook_events_uq').on(t.provider, t.providerEventId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    amountPaise: integer().notNull(),
    status: refundStatus().notNull().default('REQUESTED'),
    reason: text().notNull(),
    requestedBy: uuid().references(() => staffUsers.id),
    approvedBy: uuid().references(() => staffUsers.id),
    providerRefundId: text(),
    failureReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('refunds_payment_idx').on(t.paymentId),
    check('refunds_amount_ck', sql`${t.amountPaise} > 0`),
    check(
      'refunds_four_eyes_ck',
      sql`${t.approvedBy} IS NULL OR ${t.requestedBy} IS NULL OR ${t.approvedBy} <> ${t.requestedBy}`,
    ),
  ],
);

export const driverPayouts = pgTable(
  'driver_payouts',
  {
    id: uuid().primaryKey().defaultRandom(),
    driverId: uuid()
      .notNull()
      .references(() => driverProfiles.userId),
    amountPaise: integer().notNull(),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    status: payoutStatus().notNull().default('PENDING'),
    provider: text(),
    providerReference: text(),
    failureReason: text(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('driver_payouts_driver_idx').on(t.driverId, t.periodEnd),
    check('driver_payouts_amount_ck', sql`${t.amountPaise} > 0`),
    check('driver_payouts_period_ck', sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/**
 * Double-entry, append-only ledger. Every financial event writes a balanced
 * set of rows sharing a transaction_id (sum of debits = sum of credits).
 * UPDATE and DELETE are blocked by a trigger; corrections are new entries.
 */
export const ledgerEntries = pgTable(
  'financial_ledger_entries',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    transactionId: uuid().notNull(),
    account: ledgerAccount().notNull(),
    direction: ledgerDirection().notNull(),
    amountPaise: integer().notNull(),
    /** The driver for DRIVER_PAYABLE / CASH_HELD_BY_DRIVER, passenger for receivables. */
    ownerUserId: uuid().references(() => users.id),
    rideId: uuid().references(() => rides.id),
    paymentId: uuid().references(() => payments.id),
    refundId: uuid().references(() => refunds.id),
    payoutId: uuid().references(() => driverPayouts.id),
    description: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_transaction_idx').on(t.transactionId),
    index('ledger_owner_account_idx').on(t.ownerUserId, t.account, t.createdAt),
    index('ledger_ride_idx').on(t.rideId),
    check('ledger_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

export const promotions = pgTable(
  'promotions',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    description: text().notNull(),
    discountType: discountType().notNull(),
    /** Basis points for PERCENT, paise for FLAT. */
    discountValue: integer().notNull(),
    maxDiscountPaise: integer(),
    minRideFarePaise: integer().notNull().default(0),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    totalRedemptionLimit: integer(),
    perUserLimit: smallint().notNull().default(1),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('promotions_code_uq').on(sql`upper(${t.code})`),
    check('promotions_window_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'promotions_value_ck',
      sql`${t.discountValue} > 0 AND (${t.discountType} = 'FLAT' OR ${t.discountValue} <= 10000)`,
    ),
  ],
);

export const promotionRedemptions = pgTable(
  'promotion_redemptions',
  {
    promotionId: uuid()
      .notNull()
      .references(() => promotions.id),
    rideId: uuid()
      .notNull()
      .references(() => rides.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    discountPaise: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.promotionId, t.rideId] }),
    index('promotion_redemptions_user_idx').on(t.promotionId, t.userId),
  ],
);

/**
 * Replay protection for state-changing requests that carry an Idempotency-Key
 * header. A repeated key with the same body returns the stored response.
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    scope: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);
