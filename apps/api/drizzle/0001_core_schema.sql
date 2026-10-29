CREATE TYPE "public"."assignment_status" AS ENUM('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('USER', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."client_app" AS ENUM('PASSENGER', 'DRIVER');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('PERCENT', 'FLAT');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('PROFILE_PHOTO', 'IDENTITY_PROOF', 'DRIVING_LICENCE', 'VEHICLE_RC', 'VEHICLE_INSURANCE', 'VEHICLE_PERMIT', 'VEHICLE_FITNESS', 'POLLUTION_CERTIFICATE');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('ONBOARDING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."eligibility_status" AS ENUM('PENDING', 'ELIGIBLE', 'INELIGIBLE');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('SOS', 'HARASSMENT', 'ROUTE_DEVIATION', 'UNSAFE_DRIVING', 'VEHICLE_MISMATCH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('PASSENGER_RECEIVABLE', 'GATEWAY_CLEARING', 'CASH_HELD_BY_DRIVER', 'DRIVER_PAYABLE', 'PLATFORM_REVENUE', 'TAX_PAYABLE', 'PROMO_EXPENSE', 'PAYOUT_CLEARING');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('PUSH', 'SMS', 'IN_APP');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('LOGIN');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'ONLINE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('NOT_STARTED', 'PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'WAIVED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."place_label" AS ENUM('HOME', 'WORK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ANDROID', 'IOS');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ride_actor" AS ENUM('PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'FINANCE', 'SAFETY');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('URGENT', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PASSENGER', 'DRIVER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('PENDING_REVIEW', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."verification_check" AS ENUM('IDENTITY', 'GENDER_ELIGIBILITY', 'DRIVING_LICENCE', 'BACKGROUND', 'PAYOUT_ACCOUNT');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"purpose" "otp_purpose" DEFAULT 'LOGIN' NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"request_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_attempts_ck" CHECK ("otp_challenges"."attempts" >= 0 AND "otp_challenges"."attempts" <= "otp_challenges"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "passenger_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"eligibility_status" "eligibility_status" DEFAULT 'PENDING' NOT NULL,
	"eligibility_method" text,
	"eligibility_decided_at" timestamp with time zone,
	"terms_version_accepted" text,
	"terms_accepted_at" timestamp with time zone,
	"privacy_version_accepted" text,
	"safety_intro_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"platform" "push_platform" NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" "client_app" NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_name" text,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "staff_role_assignments" (
	"staff_user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_role_assignments_staff_user_id_role_pk" PRIMARY KEY("staff_user_id","role")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"mfa_enrolled_at" timestamp with time zone,
	"status" "staff_status" DEFAULT 'ACTIVE' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"full_name" text,
	"email" text,
	"date_of_birth" date,
	"profile_photo_key" text,
	"preferred_language" text DEFAULT 'en-IN' NOT NULL,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_phone_e164_ck" CHECK ("users"."phone_e164" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "driver_availability" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"vehicle_id" uuid,
	"active_ride_id" uuid,
	"went_online_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"type" "document_type" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" "document_status" DEFAULT 'UPLOADED' NOT NULL,
	"expires_on" date,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_documents_size_ck" CHECK ("driver_documents"."size_bytes" > 0 AND "driver_documents"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"location" geography(point, 4326) NOT NULL,
	"heading_deg" real,
	"speed_mps" real,
	"accuracy_m" real,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" "driver_status" DEFAULT 'ONBOARDING' NOT NULL,
	"home_zone_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"status_reason" text,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_rating_ck" CHECK ("driver_profiles"."rating_sum" >= 0 AND "driver_profiles"."rating_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "driver_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"check" "verification_check" NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"provider_reference" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"notes" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"seats" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"boundary" geography(multipolygon, 4326) NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"registration_number" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"colour" text NOT NULL,
	"manufacture_year" smallint,
	"status" "vehicle_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fare_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"pickup" geography(point, 4326) NOT NULL,
	"pickup_address" text NOT NULL,
	"dropoff" geography(point, 4326) NOT NULL,
	"dropoff_address" text NOT NULL,
	"distance_meters" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"route_provider" text NOT NULL,
	"surge_multiplier_bps" integer DEFAULT 10000 NOT NULL,
	"promotion_id" uuid,
	"breakdown" jsonb NOT NULL,
	"total_paise" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fare_quotes_total_ck" CHECK ("fare_quotes"."total_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"base_fare_paise" integer NOT NULL,
	"included_distance_meters" integer NOT NULL,
	"per_km_paise" integer NOT NULL,
	"per_minute_paise" integer NOT NULL,
	"minimum_fare_paise" integer NOT NULL,
	"booking_fee_paise" integer NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"waiting_free_seconds" integer NOT NULL,
	"waiting_per_minute_paise" integer NOT NULL,
	"commission_rate_bps" integer NOT NULL,
	"max_surge_bps" integer DEFAULT 10000 NOT NULL,
	"cancellation_fee_paise" integer NOT NULL,
	"cancellation_free_window_seconds" integer NOT NULL,
	"cancellation_arrived_grace_seconds" integer NOT NULL,
	"created_by" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_amounts_ck" CHECK ("pricing_rules"."base_fare_paise" >= 0 AND "pricing_rules"."per_km_paise" >= 0 AND "pricing_rules"."per_minute_paise" >= 0
        AND "pricing_rules"."minimum_fare_paise" >= 0 AND "pricing_rules"."booking_fee_paise" >= 0
        AND "pricing_rules"."waiting_per_minute_paise" >= 0 AND "pricing_rules"."cancellation_fee_paise" >= 0
        AND "pricing_rules"."included_distance_meters" >= 0 AND "pricing_rules"."waiting_free_seconds" >= 0),
	CONSTRAINT "pricing_rules_tax_ck" CHECK ("pricing_rules"."tax_rate_bps" BETWEEN 0 AND 5000),
	CONSTRAINT "pricing_rules_commission_ck" CHECK ("pricing_rules"."commission_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "pricing_rules_surge_ck" CHECK ("pricing_rules"."max_surge_bps" BETWEEN 10000 AND 30000)
);
--> statement-breakpoint
CREATE TABLE "ride_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"dispatch_round" smallint NOT NULL,
	"status" "assignment_status" DEFAULT 'OFFERED' NOT NULL,
	"pickup_distance_meters" integer NOT NULL,
	"score" integer NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ride_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ride_id" uuid NOT NULL,
	"from_status" "ride_status",
	"to_status" "ride_status" NOT NULL,
	"actor_type" "ride_actor" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_location_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ride_id" uuid NOT NULL,
	"location" geography(point, 4326) NOT NULL,
	"accuracy_m" integer,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"zone_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"status" "ride_status" DEFAULT 'REQUESTED' NOT NULL,
	"pickup" geography(point, 4326) NOT NULL,
	"pickup_address" text NOT NULL,
	"dropoff" geography(point, 4326) NOT NULL,
	"dropoff_address" text NOT NULL,
	"pickup_pin" text NOT NULL,
	"pickup_pin_attempts" smallint DEFAULT 0 NOT NULL,
	"pickup_verified_at" timestamp with time zone,
	"quoted_total_paise" integer NOT NULL,
	"final_breakdown" jsonb,
	"final_total_paise" integer,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"cancelled_by" "ride_actor",
	"cancellation_reason" text,
	"cancellation_fee_paise" integer DEFAULT 0 NOT NULL,
	"dispatch_round" smallint DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"driver_assigned_at" timestamp with time zone,
	"driver_arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_pin_ck" CHECK ("rides"."pickup_pin" ~ '^[0-9]{4}$'),
	CONSTRAINT "rides_amounts_ck" CHECK ("rides"."quoted_total_paise" >= 0 AND "rides"."cancellation_fee_paise" >= 0
        AND ("rides"."final_total_paise" IS NULL OR "rides"."final_total_paise" >= 0)),
	CONSTRAINT "rides_driver_required_ck" CHECK ("rides"."status" IN ('REQUESTED','SEARCHING','NO_DRIVER_FOUND','CANCELLED') OR "rides"."driver_id" IS NOT NULL),
	CONSTRAINT "rides_started_verified_ck" CHECK ("rides"."started_at" IS NULL OR "rides"."pickup_verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" "place_label" NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"location" geography(point, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text,
	"provider_reference" text,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_payouts_amount_ck" CHECK ("driver_payouts"."amount_paise" > 0),
	CONSTRAINT "driver_payouts_period_ck" CHECK ("driver_payouts"."period_end" >= "driver_payouts"."period_start")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "financial_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_paise" integer NOT NULL,
	"owner_user_id" uuid,
	"ride_id" uuid,
	"payment_id" uuid,
	"refund_id" uuid,
	"payout_id" uuid,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_amount_ck" CHECK ("financial_ledger_entries"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"amount_paise" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_currency_ck" CHECK ("payments"."currency" = 'INR')
);
--> statement-breakpoint
CREATE TABLE "promotion_redemptions" (
	"promotion_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"discount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_redemptions_promotion_id_ride_id_pk" PRIMARY KEY("promotion_id","ride_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"max_discount_paise" integer,
	"min_ride_fare_paise" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"total_redemption_limit" integer,
	"per_user_limit" smallint DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_window_ck" CHECK ("promotions"."ends_at" > "promotions"."starts_at"),
	CONSTRAINT "promotions_value_ck" CHECK ("promotions"."discount_value" > 0 AND ("promotions"."discount_type" = 'FLAT' OR "promotions"."discount_value" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" "refund_status" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"provider_refund_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_ck" CHECK ("refunds"."amount_paise" > 0),
	CONSTRAINT "refunds_four_eyes_ck" CHECK ("refunds"."approved_by" IS NULL OR "refunds"."requested_by" IS NULL OR "refunds"."approved_by" <> "refunds"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"ip" "inet",
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"staff_user_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"recipient_phone_e164" text,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_recipient_ck" CHECK ("notifications"."user_id" IS NOT NULL OR "notifications"."recipient_phone_e164" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"rater_user_id" uuid NOT NULL,
	"ratee_user_id" uuid NOT NULL,
	"rater_role" "user_role" NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_stars_ck" CHECK ("ratings"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "ratings_not_self_ck" CHECK ("ratings"."rater_user_id" <> "ratings"."ratee_user_id")
);
--> statement-breakpoint
CREATE TABLE "safety_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid,
	"reporter_user_id" uuid NOT NULL,
	"reporter_role" "user_role" NOT NULL,
	"type" "incident_type" NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'OPEN' NOT NULL,
	"location" geography(point, 4326),
	"description" text,
	"assigned_staff_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"response_initiated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_staff_id" uuid,
	"body" text NOT NULL,
	"internal_note" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_author_ck" CHECK (("support_messages"."author_user_id" IS NULL) <> ("support_messages"."author_staff_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ride_id" uuid,
	"category" text NOT NULL,
	"priority" "ticket_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"subject" text NOT NULL,
	"assigned_staff_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"relationship" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_contacts_phone_ck" CHECK ("trusted_contacts"."phone_e164" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
ALTER TABLE "passenger_profiles" ADD CONSTRAINT "passenger_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_granted_by_staff_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_home_zone_id_service_zones_id_fk" FOREIGN KEY ("home_zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_approved_by_staff_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_verifications" ADD CONSTRAINT "driver_verifications_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_verifications" ADD CONSTRAINT "driver_verifications_reviewed_by_staff_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_code_service_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."service_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_zone_id_service_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_category_code_service_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."service_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_zone_id_service_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_code_service_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."service_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_assignments" ADD CONSTRAINT "ride_assignments_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_assignments" ADD CONSTRAINT "ride_assignments_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_location_points" ADD CONSTRAINT "ride_location_points_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_zone_id_service_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_category_code_service_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."service_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_quote_id_fare_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."fare_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driver_id_driver_profiles_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_payout_id_driver_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."driver_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_safety_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."safety_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_user_id_users_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_user_id_users_id_fk" FOREIGN KEY ("ratee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_assigned_staff_id_staff_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_staff_id_staff_users_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_staff_id_staff_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_created_idx" ON "otp_challenges" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_ip_created_idx" ON "otp_challenges" USING btree ("request_ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_token_uq" ON "push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_refresh_hash_uq" ON "staff_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_uq" ON "staff_users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "driver_availability_online_idx" ON "driver_availability" USING btree ("is_online") WHERE "driver_availability"."is_online";--> statement-breakpoint
CREATE INDEX "driver_documents_driver_idx" ON "driver_documents" USING btree ("driver_id","type");--> statement-breakpoint
CREATE INDEX "driver_documents_expiry_idx" ON "driver_documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "driver_locations_gix" ON "driver_locations" USING gist ("location");--> statement-breakpoint
CREATE INDEX "driver_locations_recorded_idx" ON "driver_locations" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "driver_profiles_status_idx" ON "driver_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "driver_verifications_driver_check_idx" ON "driver_verifications" USING btree ("driver_id","check","created_at");--> statement-breakpoint
CREATE INDEX "service_zones_boundary_gix" ON "service_zones" USING gist ("boundary");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration_uq" ON "vehicles" USING btree (upper("registration_number"));--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "fare_quotes_passenger_idx" ON "fare_quotes" USING btree ("passenger_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_version_uq" ON "pricing_rules" USING btree ("zone_id","category_code","version");--> statement-breakpoint
CREATE INDEX "pricing_rules_lookup_idx" ON "pricing_rules" USING btree ("zone_id","category_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_assignments_round_uq" ON "ride_assignments" USING btree ("ride_id","driver_id","dispatch_round");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_assignments_one_accepted_uq" ON "ride_assignments" USING btree ("ride_id") WHERE "ride_assignments"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "ride_assignments_driver_idx" ON "ride_assignments" USING btree ("driver_id","offered_at");--> statement-breakpoint
CREATE INDEX "ride_assignments_open_idx" ON "ride_assignments" USING btree ("expires_at") WHERE "ride_assignments"."status" = 'OFFERED';--> statement-breakpoint
CREATE INDEX "ride_events_ride_idx" ON "ride_events" USING btree ("ride_id","id");--> statement-breakpoint
CREATE INDEX "ride_location_points_ride_idx" ON "ride_location_points" USING btree ("ride_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_quote_uq" ON "rides" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_one_active_per_passenger_uq" ON "rides" USING btree ("passenger_id") WHERE "rides"."status" IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS');--> statement-breakpoint
CREATE UNIQUE INDEX "rides_one_engaged_per_driver_uq" ON "rides" USING btree ("driver_id") WHERE "rides"."status" IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "rides_passenger_idx" ON "rides" USING btree ("passenger_id","requested_at");--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id","requested_at");--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "saved_places_user_idx" ON "saved_places" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_places_home_work_uq" ON "saved_places" USING btree ("user_id","label") WHERE "saved_places"."label" IN ('HOME', 'WORK');--> statement-breakpoint
CREATE INDEX "driver_payouts_driver_idx" ON "driver_payouts" USING btree ("driver_id","period_end");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ledger_transaction_idx" ON "financial_ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_owner_account_idx" ON "financial_ledger_entries" USING btree ("owner_user_id","account","created_at");--> statement-breakpoint
CREATE INDEX "ledger_ride_idx" ON "financial_ledger_entries" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_order_uq" ON "payments" USING btree ("provider","provider_order_id") WHERE "payments"."provider_order_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("provider","provider_payment_id") WHERE "payments"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_ride_idx" ON "payments" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "promotion_redemptions_user_idx" ON "promotion_redemptions" USING btree ("promotion_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_code_uq" ON "promotions" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id","id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."status" = 'QUEUED';--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_one_per_rater_uq" ON "ratings" USING btree ("ride_id","rater_user_id");--> statement-breakpoint
CREATE INDEX "ratings_ratee_idx" ON "ratings" USING btree ("ratee_user_id");--> statement-breakpoint
CREATE INDEX "safety_incidents_open_idx" ON "safety_incidents" USING btree ("severity","created_at") WHERE "safety_incidents"."status" IN ('OPEN','ACKNOWLEDGED','RESPONDING');--> statement-breakpoint
CREATE INDEX "safety_incidents_ride_idx" ON "safety_incidents" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "safety_incidents_reporter_idx" ON "safety_incidents" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE INDEX "support_tickets_queue_idx" ON "support_tickets" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_shares_token_uq" ON "trip_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trip_shares_ride_idx" ON "trip_shares" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_contacts_user_phone_uq" ON "trusted_contacts" USING btree ("user_id","phone_e164");