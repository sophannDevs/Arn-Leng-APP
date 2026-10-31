ALTER TYPE "public"."payment_provider" ADD VALUE 'fake';--> statement-breakpoint
ALTER TYPE "public"."payment_provider" ADD VALUE 'complimentary';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_next_plan_id_plans_id_fk" FOREIGN KEY ("next_plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;