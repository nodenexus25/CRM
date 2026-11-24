-- Normalise the legacy `ratePeriod` vocabulary (`HOUR` / `YEAR`) written by the
-- Phase 1 seeder onto the canonical values in `rateTypeSchema`
-- (`HOURLY` | `DAILY` | `MONTHLY` | `ANNUAL`) that `packages/types` validates and
-- the API/UI expect. Without this the period suffix is dropped on read and the
-- first edit of a row silently rewrites it to the form default.
UPDATE "jobs" SET "ratePeriod" = 'HOURLY' WHERE "ratePeriod" = 'HOUR';
UPDATE "jobs" SET "ratePeriod" = 'ANNUAL' WHERE "ratePeriod" = 'YEAR';

UPDATE "offers" SET "ratePeriod" = 'HOURLY' WHERE "ratePeriod" = 'HOUR';
UPDATE "offers" SET "ratePeriod" = 'ANNUAL' WHERE "ratePeriod" = 'YEAR';

UPDATE "placements" SET "ratePeriod" = 'HOURLY' WHERE "ratePeriod" = 'HOUR';
UPDATE "placements" SET "ratePeriod" = 'ANNUAL' WHERE "ratePeriod" = 'YEAR';

UPDATE "candidates" SET "ratePeriod" = 'HOURLY' WHERE "ratePeriod" = 'HOUR';
UPDATE "candidates" SET "ratePeriod" = 'ANNUAL' WHERE "ratePeriod" = 'YEAR';
