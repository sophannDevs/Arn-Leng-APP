CREATE TABLE "account_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "account_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "known_devices" (
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_pk" PRIMARY KEY("user_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "known_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_flags_open_idx" ON "account_flags" USING btree ("reviewed_at","created_at");--> statement-breakpoint
CREATE INDEX "account_flags_user_idx" ON "account_flags" USING btree ("user_id");