CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploaded');--> statement-breakpoint
CREATE TABLE "episode_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"position" integer NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_uploads_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "episode_uploads_bytes_positive" CHECK ("episode_uploads"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "episode_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "early_access_days" integer;--> statement-breakpoint
ALTER TABLE "episode_uploads" ADD CONSTRAINT "episode_uploads_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_uploads_episode_position_idx" ON "episode_uploads" USING btree ("episode_id","position");--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_early_access_days_range" CHECK ("episodes"."early_access_days" is null or "episodes"."early_access_days" between 1 and 90);