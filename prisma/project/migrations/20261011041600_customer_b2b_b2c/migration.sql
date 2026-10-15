-- Customer: B2B / B2C fields. Purana data rakha jata hai (columns rename, type customerType se).

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('B2B', 'B2C');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- DropIndex
DROP INDEX "Customer_customerCode_key";
DROP INDEX "Customer_customerName_idx";
DROP INDEX "Customer_customerPhone_idx";
DROP INDEX "Customer_customerPhone_key";

-- Purane columns ke naye naam
ALTER TABLE "Customer" RENAME COLUMN "customerName" TO "name";
ALTER TABLE "Customer" RENAME COLUMN "customerPhone" TO "phone";
ALTER TABLE "Customer" RENAME COLUMN "customerEmail" TO "email";

-- Naye columns
ALTER TABLE "Customer"
ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'B2C',
ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "alternatePhone" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "pincode" TEXT,
ADD COLUMN "companyName" TEXT,
ADD COLUMN "gstin" TEXT,
ADD COLUMN "industryType" TEXT,
ADD COLUMN "aadhaarNumber" TEXT,
ADD COLUMN "projectType" TEXT,
ADD COLUMN "monthlyBill" DECIMAL(12,2),
ADD COLUMN "sanctionLoadKw" DECIMAL(10,2),
ADD COLUMN "consumerNumber" TEXT,
ADD COLUMN "roofType" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "assignedTo" INTEGER,
ADD COLUMN "sourceLeadId" INTEGER,
ADD COLUMN "notes" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Purana data: customerType → type, recStatus 0 → deletedAt
UPDATE "Customer" SET "type" = CASE WHEN upper(COALESCE("customerType", '')) = 'B2B' THEN 'B2B' ELSE 'B2C' END::"CustomerType";
UPDATE "Customer" SET "deletedAt" = "updatedAt" WHERE "recStatus" <> 1;
ALTER TABLE "Customer" ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "Customer"
DROP COLUMN "customerType",
DROP COLUMN "groupId",
DROP COLUMN "recStatus",
DROP COLUMN "updatedBy";

-- CreateIndex
CREATE INDEX "Customer_companyId_phone_idx" ON "Customer"("companyId", "phone");
CREATE INDEX "Customer_companyId_type_idx" ON "Customer"("companyId", "type");
CREATE INDEX "Customer_assignedTo_idx" ON "Customer"("assignedTo");
CREATE UNIQUE INDEX "Customer_companyId_customerCode_key" ON "Customer"("companyId", "customerCode");
