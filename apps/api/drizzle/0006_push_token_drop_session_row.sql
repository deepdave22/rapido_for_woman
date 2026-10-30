ALTER TABLE "push_tokens" DROP CONSTRAINT "push_tokens_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "push_tokens" DROP COLUMN "session_id";