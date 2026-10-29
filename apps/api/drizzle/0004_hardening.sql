ALTER TABLE "users" DROP CONSTRAINT "users_phone_e164_ck";--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_ck" CHECK ("users"."phone_e164" ~ '^\+91[6-9][0-9]{9}$' OR ("users"."status" = 'DELETED' AND "users"."phone_e164" LIKE 'deleted:%'));