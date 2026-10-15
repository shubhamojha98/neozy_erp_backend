-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'FOLLOW_UP', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'NOTE', 'STATUS', 'ASSIGN', 'CONVERT');

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "leadNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternateName" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "lostReason" TEXT,
    "assignedTo" INTEGER,
    "nextFollowupDate" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "convertedCustomerId" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" SERIAL NOT NULL,
    "leadId" INTEGER NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "connected" BOOLEAN,
    "outcome" TEXT,
    "remarks" TEXT,
    "nextFollowupDate" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_companyId_status_idx" ON "leads"("companyId", "status");

-- CreateIndex
CREATE INDEX "leads_companyId_phone_idx" ON "leads"("companyId", "phone");

-- CreateIndex
CREATE INDEX "leads_assignedTo_idx" ON "leads"("assignedTo");

-- CreateIndex
CREATE INDEX "leads_nextFollowupDate_idx" ON "leads"("nextFollowupDate");

-- CreateIndex
CREATE UNIQUE INDEX "leads_companyId_leadNo_key" ON "leads"("companyId", "leadNo");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Purana data naye tables me (lead_master → leads, lead_followup → lead_activities)
-- Status: har lead ke last followup ka statusId (1 New, 2 Follow-up, 3 Qualified, 4 Converted, 5 Lost)
-- ============================================================
INSERT INTO "leads" ("id", "companyId", "leadNo", "name", "phone", "email", "address", "city", "state", "pincode",
  "source", "status", "notes", "assignedTo", "nextFollowupDate", "lastContactedAt", "createdBy", "createdAt", "updatedAt", "deletedAt")
SELECT m."id", m."companyId", m."leadNo", m."customerName", m."mobileNo", m."email", m."address", m."city", m."state", m."pincode",
  COALESCE(s."name", 'Other'),
  CASE f."statusId" WHEN 2 THEN 'FOLLOW_UP' WHEN 3 THEN 'QUALIFIED' WHEN 4 THEN 'CONVERTED' WHEN 5 THEN 'LOST' ELSE 'NEW' END::"LeadStatus",
  m."remarks", m."assignedTo", m."nextFollowupDate", m."lastFollowupDate", COALESCE(m."createdBy", 0), m."createdAt", m."updatedAt",
  CASE WHEN m."recStatus" = 1 THEN NULL ELSE m."updatedAt" END
FROM "lead_master" m
LEFT JOIN "lead_source_master" s ON s."id" = m."leadSourceId"
LEFT JOIN LATERAL (SELECT "statusId" FROM "lead_followup" WHERE "leadId" = m."id" ORDER BY "followupDate" DESC LIMIT 1) f ON true;

INSERT INTO "lead_activities" ("leadId", "type", "outcome", "remarks", "nextFollowupDate", "createdBy", "createdAt")
SELECT "leadId", 'NOTE', NULL, "remarks", "nextFollowupDate", COALESCE("createdBy", 0), "followupDate" FROM "lead_followup";

SELECT setval(pg_get_serial_sequence('"leads"', 'id'), COALESCE((SELECT MAX("id") FROM "leads"), 0) + 1, false);

-- DropForeignKey
ALTER TABLE "lead_followup" DROP CONSTRAINT "lead_followup_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_master" DROP CONSTRAINT "lead_master_leadSourceId_fkey";

-- DropTable
DROP TABLE "lead_followup";

-- DropTable
DROP TABLE "lead_master";

-- DropTable
DROP TABLE "lead_source_master";

