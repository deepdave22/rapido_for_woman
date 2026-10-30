ALTER TABLE "push_tokens" ADD COLUMN "session_family_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "app" "client_app" NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "push_tokens_family_idx" ON "push_tokens" USING btree ("session_family_id");