CREATE INDEX "episodes_published_at_idx" ON "episodes" USING btree ("published_at" DESC NULLS LAST) WHERE "episodes"."status" = 'published';--> statement-breakpoint
CREATE INDEX "series_published_updated_idx" ON "series" USING btree ("updated_at" DESC NULLS LAST) WHERE "series"."is_published";--> statement-breakpoint
CREATE INDEX "series_genres_idx" ON "series" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "series_search_idx" ON "series" USING gin (to_tsvector('simple', "title" || ' ' || "description"));