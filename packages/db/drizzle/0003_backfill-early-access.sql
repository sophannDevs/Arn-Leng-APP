-- Episodes published before early_access_days existed: those with a free_after date were in the
-- subscribers-first mode (7 days, EARLY_ACCESS_DAYS in packages/shared). Fill the new column so
-- the studio shows their access correctly. Safe to run once; matches nothing on a fresh database.
UPDATE "episodes"
SET "early_access_days" = 7
WHERE "access_type" = 'subscriber'
  AND "free_after" IS NOT NULL
  AND "early_access_days" IS NULL;
