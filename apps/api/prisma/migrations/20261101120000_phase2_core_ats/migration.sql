-- CreateEnum
CREATE TYPE "StageCategory" AS ENUM ('ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SkillProficiency" AS ENUM ('BASIC', 'CONVERSATIONAL', 'PROFESSIONAL', 'NATIVE');

-- CreateEnum
CREATE TYPE "BulkOperationType" AS ENUM ('CANDIDATE_TAGS', 'CANDIDATE_OWNER', 'CANDIDATE_STATUS', 'CANDIDATE_ADD_TO_JOB', 'CANDIDATE_ADD_TO_LIST', 'CANDIDATE_DELETE', 'CANDIDATE_EXPORT', 'JOB_STATUS', 'JOB_PRIORITY', 'JOB_ASSIGN_RECRUITERS');

-- CreateEnum
CREATE TYPE "BulkOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "ResumeParseStatus" ADD VALUE 'NEEDS_OCR';

-- DropIndex
DROP INDEX "job_pipeline_stages_tenantId_key_key";

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "candidate_resumes" ADD COLUMN     "parseDurationMs" INTEGER,
ADD COLUMN     "parserConfidence" DOUBLE PRECISION,
ADD COLUMN     "parserUsed" TEXT,
ALTER COLUMN "candidateId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "availabilityDate" TIMESTAMP(3),
ADD COLUMN     "currentRateCents" INTEGER,
ADD COLUMN     "emailNormalized" TEXT,
ADD COLUMN     "expectedRateCents" INTEGER,
ADD COLUMN     "linkedinNormalized" TEXT,
ADD COLUMN     "phoneNormalized" TEXT,
ADD COLUMN     "rateCurrency" TEXT,
ADD COLUMN     "ratePeriod" TEXT,
ADD COLUMN     "workAuthorizationExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "job_pipeline_stages" ADD COLUMN     "category" "StageCategory" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "slaDays" INTEGER;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "billRateType" TEXT,
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "jobCodeSeq" INTEGER,
ADD COLUMN     "marginCents" INTEGER,
ADD COLUMN     "marginPercentage" DECIMAL(6,2),
ADD COLUMN     "rateType" TEXT,
ADD COLUMN     "workAuthorizations" "WorkAuthorization"[] DEFAULT ARRAY[]::"WorkAuthorization"[];

-- AlterTable
ALTER TABLE "skills" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "rejection_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rejection_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_emails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_phones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_certifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "credentialId" TEXT,
    "credentialUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_languages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "proficiency" "SkillProficiency" NOT NULL DEFAULT 'PROFESSIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#6366f1',
    "visibility" "Visibility" NOT NULL DEFAULT 'TENANT',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "candidate_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_list_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidate_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "ImportEntityType" NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "BulkOperationType" NOT NULL,
    "status" "BulkOperationStatus" NOT NULL DEFAULT 'PENDING',
    "selection" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "succeededItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "resultKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rejection_reasons_tenantId_order_idx" ON "rejection_reasons"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "rejection_reasons_tenantId_key_key" ON "rejection_reasons"("tenantId", "key");

-- CreateIndex
CREATE INDEX "candidate_emails_tenantId_candidateId_idx" ON "candidate_emails"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "candidate_emails_tenantId_address_idx" ON "candidate_emails"("tenantId", "address");

-- CreateIndex
CREATE INDEX "candidate_phones_tenantId_candidateId_idx" ON "candidate_phones"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "candidate_phones_tenantId_number_idx" ON "candidate_phones"("tenantId", "number");

-- CreateIndex
CREATE INDEX "candidate_certifications_tenantId_candidateId_idx" ON "candidate_certifications"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "candidate_languages_tenantId_candidateId_idx" ON "candidate_languages"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "candidate_lists_tenantId_deletedAt_idx" ON "candidate_lists"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_lists_tenantId_name_key" ON "candidate_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "candidate_list_members_tenantId_candidateId_idx" ON "candidate_list_members"("tenantId", "candidateId");

-- CreateIndex
CREATE INDEX "candidate_list_members_tenantId_listId_idx" ON "candidate_list_members"("tenantId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_list_members_listId_candidateId_key" ON "candidate_list_members"("listId", "candidateId");

-- CreateIndex
CREATE INDEX "import_templates_tenantId_entity_idx" ON "import_templates"("tenantId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_tenantId_entity_name_key" ON "import_templates"("tenantId", "entity", "name");

-- CreateIndex
CREATE INDEX "bulk_operations_tenantId_status_idx" ON "bulk_operations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "bulk_operations_tenantId_createdAt_idx" ON "bulk_operations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "applications_tenantId_stageId_stageEnteredAt_idx" ON "applications"("tenantId", "stageId", "stageEnteredAt");

-- CreateIndex
CREATE INDEX "candidate_resumes_tenantId_createdAt_idx" ON "candidate_resumes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "candidates_tenantId_status_createdAt_idx" ON "candidates"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "candidates_tenantId_ownerId_status_idx" ON "candidates"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "candidates_tenantId_emailNormalized_idx" ON "candidates"("tenantId", "emailNormalized");

-- CreateIndex
CREATE INDEX "candidates_tenantId_phoneNormalized_idx" ON "candidates"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "candidates_tenantId_linkedinNormalized_idx" ON "candidates"("tenantId", "linkedinNormalized");

-- CreateIndex
CREATE INDEX "job_pipeline_stages_tenantId_jobId_order_idx" ON "job_pipeline_stages"("tenantId", "jobId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "job_pipeline_stages_tenantId_jobId_key_key" ON "job_pipeline_stages"("tenantId", "jobId", "key");

-- CreateIndex
CREATE INDEX "jobs_tenantId_status_priority_idx" ON "jobs"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "jobs_tenantId_clientId_status_idx" ON "jobs"("tenantId", "clientId", "status");

-- AddForeignKey
ALTER TABLE "job_pipeline_stages" ADD CONSTRAINT "job_pipeline_stages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejection_reasons" ADD CONSTRAINT "rejection_reasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_emails" ADD CONSTRAINT "candidate_emails_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_emails" ADD CONSTRAINT "candidate_emails_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_phones" ADD CONSTRAINT "candidate_phones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_phones" ADD CONSTRAINT "candidate_phones_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_languages" ADD CONSTRAINT "candidate_languages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_languages" ADD CONSTRAINT "candidate_languages_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_lists" ADD CONSTRAINT "candidate_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_list_members" ADD CONSTRAINT "candidate_list_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_list_members" ADD CONSTRAINT "candidate_list_members_listId_fkey" FOREIGN KEY ("listId") REFERENCES "candidate_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_list_members" ADD CONSTRAINT "candidate_list_members_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
