-- AlterTable
ALTER TABLE "jobs" ALTER COLUMN "ratePeriod" SET DEFAULT 'ANNUAL';

-- AlterTable
ALTER TABLE "offers" ALTER COLUMN "ratePeriod" SET DEFAULT 'ANNUAL';

-- AlterTable
ALTER TABLE "placements" ALTER COLUMN "ratePeriod" SET DEFAULT 'ANNUAL';
