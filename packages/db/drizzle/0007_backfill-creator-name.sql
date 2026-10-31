-- Copy each series creator's pen name (or name) into series.creator_name so search can match it.
-- Safe to run once; the app keeps the column up to date for new series.
UPDATE "series" s
SET "creator_name" = COALESCE(
  (SELECT cp."pen_name" FROM "creator_profiles" cp WHERE cp."user_id" = s."creator_id"),
  (SELECT u."name" FROM "users" u WHERE u."id" = s."creator_id"),
  ''
)
WHERE s."creator_name" = '';
