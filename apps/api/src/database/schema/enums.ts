import { pgEnum } from 'drizzle-orm/pg-core';
import { RIDE_ACTORS, RIDE_STATUSES } from '@saheli/domain';

export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);
export const userRole = pgEnum('user_role', ['PASSENGER', 'DRIVER']);
export const clientApp = pgEnum('client_app', ['PASSENGER', 'DRIVER']);
export const otpPurpose = pgEnum('otp_purpose', ['LOGIN']);

export const staffStatus = pgEnum('staff_status', ['ACTIVE', 'DISABLED']);
export const staffRole = pgEnum('staff_role', [
  'SUPER_ADMIN',
  'OPERATIONS',
  'SUPPORT',
  'FINANCE',
  'SAFETY',
]);

export const eligibilityStatus = pgEnum('eligibility_status', [
  'PENDING',
  'ELIGIBLE',
  'INELIGIBLE',
]);

export const driverStatus = pgEnum('driver_status', [
  'ONBOARDING',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);
export const verificationCheck = pgEnum('verification_check', [
  'IDENTITY',
  'GENDER_ELIGIBILITY',
  'DRIVING_LICENCE',
  'BACKGROUND',
  'PAYOUT_ACCOUNT',
]);
export const verificationStatus = pgEnum('verification_status', [
  'PENDING',
  'PASSED',
  'FAILED',
  'EXPIRED',
]);
export const documentType = pgEnum('document_type', [
  'PROFILE_PHOTO',
  'IDENTITY_PROOF',
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'VEHICLE_INSURANCE',
  'VEHICLE_PERMIT',
  'VEHICLE_FITNESS',
  'POLLUTION_CERTIFICATE',
]);
export const documentStatus = pgEnum('document_status', [
  'UPLOADED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);
export const vehicleStatus = pgEnum('vehicle_status', ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE']);
export const placeLabel = pgEnum('place_label', ['HOME', 'WORK', 'OTHER']);

export const rideStatus = pgEnum('ride_status', RIDE_STATUSES);
export const rideActor = pgEnum('ride_actor', RIDE_ACTORS);
export const assignmentStatus = pgEnum('assignment_status', [
  'OFFERED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
]);

export const paymentMethod = pgEnum('payment_method', ['CASH', 'ONLINE']);
export const paymentStatus = pgEnum('payment_status', [
  'NOT_STARTED',
  'PENDING',
  'PAID',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'WAIVED',
]);
export const refundStatus = pgEnum('refund_status', [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
]);
export const ledgerAccount = pgEnum('ledger_account', [
  'PASSENGER_RECEIVABLE',
  'GATEWAY_CLEARING',
  'CASH_HELD_BY_DRIVER',
  'DRIVER_PAYABLE',
  'PLATFORM_REVENUE',
  'TAX_PAYABLE',
  'PROMO_EXPENSE',
  'PAYOUT_CLEARING',
]);
export const ledgerDirection = pgEnum('ledger_direction', ['DEBIT', 'CREDIT']);
export const payoutStatus = pgEnum('payout_status', [
  'PENDING',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
]);

export const incidentType = pgEnum('incident_type', [
  'SOS',
  'HARASSMENT',
  'ROUTE_DEVIATION',
  'UNSAFE_DRIVING',
  'VEHICLE_MISMATCH',
  'OTHER',
]);
export const incidentSeverity = pgEnum('incident_severity', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const incidentStatus = pgEnum('incident_status', [
  'OPEN',
  'ACKNOWLEDGED',
  'RESPONDING',
  'RESOLVED',
  'CLOSED',
]);

export const ticketStatus = pgEnum('ticket_status', [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_USER',
  'RESOLVED',
  'CLOSED',
]);
export const ticketPriority = pgEnum('ticket_priority', ['URGENT', 'HIGH', 'NORMAL', 'LOW']);

export const notificationChannel = pgEnum('notification_channel', ['PUSH', 'SMS', 'IN_APP']);
export const notificationStatus = pgEnum('notification_status', [
  'QUEUED',
  'SENT',
  'FAILED',
  'SKIPPED',
]);
export const pushPlatform = pgEnum('push_platform', ['ANDROID', 'IOS']);
export const discountType = pgEnum('discount_type', ['PERCENT', 'FLAT']);
export const auditActorType = pgEnum('audit_actor_type', ['USER', 'STAFF', 'SYSTEM']);
