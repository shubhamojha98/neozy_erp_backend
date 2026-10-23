-- Project 2C: Dispatch, Serials, Installation, QC, Commissioning, Net Metering, Subsidy, Handover (sirf nayi tables, purana data safe)
-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('DISPATCHED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "SerialType" AS ENUM ('PANEL', 'INVERTER');

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('SCHEDULED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NetMeteringStatus" AS ENUM ('SUBMITTED', 'METER_INSTALLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubsidyStatus" AS ENUM ('SUBMITTED', 'DISBURSED', 'REJECTED', 'NOT_APPLICABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectActivityType" ADD VALUE 'DISPATCH';
ALTER TYPE "ProjectActivityType" ADD VALUE 'INSTALLATION';
ALTER TYPE "ProjectActivityType" ADD VALUE 'QC';
ALTER TYPE "ProjectActivityType" ADD VALUE 'COMMISSIONING';
ALTER TYPE "ProjectActivityType" ADD VALUE 'NET_METERING';
ALTER TYPE "ProjectActivityType" ADD VALUE 'SUBSIDY';
ALTER TYPE "ProjectActivityType" ADD VALUE 'HANDOVER';

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "dispatchNo" TEXT NOT NULL,
    "dispatchDate" DATE NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "lrNumber" TEXT,
    "notes" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'DISPATCHED',
    "deliveredAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentSerial" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "type" "SerialType" NOT NULL,
    "serialNo" TEXT NOT NULL,
    "stage" "ProjectStage" NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentSerial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "installerId" INTEGER NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "status" "InstallationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCheck" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "status" "QcStatus" NOT NULL,
    "remarks" TEXT,
    "checkedBy" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commissioning" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "commissionedOn" DATE NOT NULL,
    "generationKwh" DECIMAL(10,2) NOT NULL,
    "warrantyStart" DATE NOT NULL,
    "warrantyMonths" INTEGER NOT NULL,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commissioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetMetering" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "discom" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "submittedOn" DATE NOT NULL,
    "status" "NetMeteringStatus" NOT NULL DEFAULT 'SUBMITTED',
    "meterNo" TEXT,
    "installedOn" DATE,
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetMetering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subsidy" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "scheme" TEXT NOT NULL,
    "applicationNo" TEXT,
    "amount" DECIMAL(14,2),
    "appliedOn" DATE,
    "status" "SubsidyStatus" NOT NULL DEFAULT 'SUBMITTED',
    "disbursedAmount" DECIMAL(14,2),
    "disbursedOn" DATE,
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subsidy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "handoverDate" DATE NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_projectId_key" ON "Dispatch"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_companyId_dispatchNo_key" ON "Dispatch"("companyId", "dispatchNo");

-- CreateIndex
CREATE INDEX "EquipmentSerial_projectId_idx" ON "EquipmentSerial"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentSerial_companyId_serialNo_key" ON "EquipmentSerial"("companyId", "serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_projectId_key" ON "Installation"("projectId");

-- CreateIndex
CREATE INDEX "QualityCheck_projectId_idx" ON "QualityCheck"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Commissioning_projectId_key" ON "Commissioning"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "NetMetering_projectId_key" ON "NetMetering"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Subsidy_projectId_key" ON "Subsidy"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_projectId_key" ON "Handover"("projectId");

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentSerial" ADD CONSTRAINT "EquipmentSerial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commissioning" ADD CONSTRAINT "Commissioning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetMetering" ADD CONSTRAINT "NetMetering_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subsidy" ADD CONSTRAINT "Subsidy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

