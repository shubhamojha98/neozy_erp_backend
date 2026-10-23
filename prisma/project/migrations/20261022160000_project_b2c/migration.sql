-- Project (B2C) naye workflow ke hisaab se. Purane project rows bache rehte hain.
-- Survey / EngineeringDesign purane design me khaali the — naye sire se bante hain.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Survey") OR EXISTS (SELECT 1 FROM "EngineeringDesign") THEN
    RAISE EXCEPTION 'Survey / EngineeringDesign me purana data hai — migration rok di (pehle data ka backup lo)';
  END IF;
END $$;

-- Purane Survey / Engineering hatao
DROP TABLE "EngineeringDesign";
DROP TABLE "Survey";
DROP TYPE "SurveyStatus";
DROP TYPE "EngineeringStatus";

-- Naye enums
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'LOAN');
CREATE TYPE "ProjectActivityType" AS ENUM ('CREATED', 'UPDATED', 'STAGE', 'SURVEY', 'ENGINEERING', 'NOTE');
CREATE TYPE "SurveyStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "EngineeringStatus" AS ENUM ('DRAFT', 'APPROVED');

-- Stage: SERVICE → HANDOVER, baaki naam same
ALTER TYPE "ProjectStage" RENAME TO "ProjectStage_old";
CREATE TYPE "ProjectStage" AS ENUM ('SURVEY', 'ENGINEERING', 'QUOTATION', 'LOAN', 'REGISTRATION', 'INVOICE', 'ORDER', 'DISPATCH', 'INSTALLATION', 'QC', 'COMMISSIONING', 'NET_METERING', 'SUBSIDY', 'HANDOVER');
ALTER TABLE "Project" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "stage" TYPE "ProjectStage"
  USING (CASE WHEN "stage"::text = 'SERVICE' THEN 'HANDOVER' ELSE "stage"::text END)::"ProjectStage";
ALTER TABLE "Project" ALTER COLUMN "stage" SET DEFAULT 'SURVEY';
DROP TYPE "ProjectStage_old";

-- Status: ARCHIVED → CANCELLED, ON_HOLD naya
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus"
  USING (CASE WHEN "status"::text = 'ARCHIVED' THEN 'CANCELLED' ELSE "status"::text END)::"ProjectStatus";
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "ProjectStatus_old";

-- Naye columns, purana data inme
ALTER TABLE "Project"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "assignedTo" INTEGER,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "paymentMode" "PaymentMode";

UPDATE "Project" SET
  "address" = NULLIF(concat_ws(', ', NULLIF("addressLine1", ''), NULLIF("addressLine2", ''), NULLIF("district", '')), ''),
  "assignedTo" = COALESCE("managerId", "salesOwnerId"),
  "deletedAt" = CASE WHEN "recStatus" <> 1 THEN "updatedAt" END;

-- Purane columns / indexes hatao
DROP INDEX "Project_createdAt_idx";
DROP INDEX "Project_installerId_idx";
DROP INDEX "Project_managerId_idx";
DROP INDEX "Project_projectCode_key";
DROP INDEX "Project_salesOwnerId_idx";
DROP INDEX "Project_stage_idx";
DROP INDEX "Project_status_idx";
DROP INDEX "Project_surveyorId_idx";

ALTER TABLE "Project"
  DROP COLUMN "addressLine1",
  DROP COLUMN "addressLine2",
  DROP COLUMN "country",
  DROP COLUMN "district",
  DROP COLUMN "groupId",
  DROP COLUMN "installerName",
  DROP COLUMN "leadId",
  DROP COLUMN "managerId",
  DROP COLUMN "managerName",
  DROP COLUMN "recStatus",
  DROP COLUMN "salesOwnerId",
  DROP COLUMN "salesOwnerName",
  DROP COLUMN "surveyorName",
  DROP COLUMN "updatedBy";

CREATE UNIQUE INDEX "Project_companyId_projectCode_key" ON "Project"("companyId", "projectCode");
CREATE INDEX "Project_companyId_stage_idx" ON "Project"("companyId", "stage");
CREATE INDEX "Project_assignedTo_idx" ON "Project"("assignedTo");

-- Survey
CREATE TABLE "Survey" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "surveyorId" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "roofType" TEXT,
    "roofAreaSqft" DECIMAL(10,2),
    "shadowFreeAreaSqft" DECIMAL(10,2),
    "meterPhase" TEXT,
    "sanctionLoadKw" DECIMAL(10,2),
    "recommendedKw" DECIMAL(10,2),
    "shadingNotes" TEXT,
    "structureNotes" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "remarks" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Survey_projectId_idx" ON "Survey"("projectId");
CREATE INDEX "Survey_surveyorId_idx" ON "Survey"("surveyorId");
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Engineering design
CREATE TABLE "EngineeringDesign" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "panelBrand" TEXT,
    "panelWattage" INTEGER NOT NULL,
    "panelCount" INTEGER NOT NULL,
    "systemKw" DECIMAL(10,2) NOT NULL,
    "inverterBrand" TEXT,
    "inverterKw" DECIMAL(10,2) NOT NULL,
    "structureType" TEXT,
    "notes" TEXT,
    "status" "EngineeringStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EngineeringDesign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EngineeringDesign_projectId_key" ON "EngineeringDesign"("projectId");
ALTER TABLE "EngineeringDesign" ADD CONSTRAINT "EngineeringDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Timeline
CREATE TABLE "ProjectActivity" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "type" "ProjectActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectActivity_projectId_idx" ON "ProjectActivity"("projectId");
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
