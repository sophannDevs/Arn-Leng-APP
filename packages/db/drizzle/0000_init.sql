CREATE TYPE "public"."age_rating" AS ENUM('all', 'teen', 'mature');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('visible', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."episode_access_type" AS ENUM('free', 'subscriber');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('draft', 'processing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('payway');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('series', 'episode', 'comment', 'user');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('ongoing', 'completed', 'hiatus');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('reader', 'creator', 'admin');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_txn_id" text,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_txn_id_unique" UNIQUE("provider_txn_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_nonnegative" CHECK ("payments"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"interval" "plan_interval" NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code"),
	CONSTRAINT "plans_price_nonnegative" CHECK ("plans"."price_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"payment_token" text,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_period_order" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "episode_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"key_prefix" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"blur_data_url" text NOT NULL,
	"bytes" integer NOT NULL,
	CONSTRAINT "episode_images_episode_position_unique" UNIQUE("episode_id","position"),
	CONSTRAINT "episode_images_dimensions_positive" CHECK ("episode_images"."width" > 0 and "episode_images"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "episode_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"thumbnail_key" text,
	"status" "episode_status" DEFAULT 'draft' NOT NULL,
	"access_type" "episode_access_type" DEFAULT 'subscriber' NOT NULL,
	"free_after" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	CONSTRAINT "episodes_series_number_unique" UNIQUE("series_id","number"),
	CONSTRAINT "episodes_number_positive" CHECK ("episodes"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "episodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_key" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "series_status" DEFAULT 'ongoing' NOT NULL,
	"age_rating" "age_rating" DEFAULT 'all' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "episode_views_daily" (
	"episode_id" uuid NOT NULL,
	"date" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "episode_views_daily_pk" PRIMARY KEY("episode_id","date"),
	CONSTRAINT "episode_views_daily_views_nonnegative" CHECK ("episode_views_daily"."views" >= 0)
);
--> statement-breakpoint
ALTER TABLE "episode_views_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
ALTER TABLE "likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"scroll_position" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_pk" PRIMARY KEY("user_id","series_id"),
	CONSTRAINT "reading_progress_scroll_range" CHECK ("reading_progress"."scroll_position" >= 0 and "reading_progress"."scroll_position" <= 1)
);
--> statement-breakpoint
ALTER TABLE "reading_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pen_name" text NOT NULL,
	"bio" text
);
--> statement-breakpoint
ALTER TABLE "creator_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_key" text,
	"role" "user_role" DEFAULT 'reader' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_images" ADD CONSTRAINT "episode_images_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_views_daily" ADD CONSTRAINT "episode_views_daily_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_user_created_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "series_creator_idx" ON "series" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "comments_episode_created_idx" ON "comments" USING btree ("episode_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_user_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "follows_series_idx" ON "follows" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "likes_episode_idx" ON "likes" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_updated_idx" ON "reading_progress" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("processed_at","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));