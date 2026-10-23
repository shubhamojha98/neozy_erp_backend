-- B2B Sales Orders. Quotation / Invoice / Payment / Dispatch / Activity ab project YA sales order ke (projectId NULL ho sakta hai). Purana data safe.
-- CreateEnum
CREATE TYPE "SalesOrderStage" AS ENUM ('QUOTATION', 'INVOICE', 'ORDER', 'DISPATCH');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "Dispatch" DROP CONSTRAINT "Dispatch_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectActivity" DROP CONSTRAINT "ProjectActivity_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_projectId_fkey";

-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "salesOrderId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "salesOrderId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "salesOrderId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProjectActivity" ADD COLUMN     "salesOrderId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "salesOrderId" INTEGER,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "stage" "SalesOrderStage" NOT NULL DEFAULT 'QUOTATION',
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'OPEN',
    "contractValue" DECIMAL(14,2),
    "confirmedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "assignedTo" INTEGER,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_stage_idx" ON "SalesOrder"("companyId", "stage");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_orderNo_key" ON "SalesOrder"("companyId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_salesOrderId_key" ON "Dispatch"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_salesOrderId_key" ON "Invoice"("salesOrderId");

-- CreateIndex
CREATE INDEX "Payment_salesOrderId_idx" ON "Payment"("salesOrderId");

-- CreateIndex
CREATE INDEX "ProjectActivity_salesOrderId_idx" ON "ProjectActivity"("salesOrderId");

-- CreateIndex
CREATE INDEX "Quotation_salesOrderId_idx" ON "Quotation"("salesOrderId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

