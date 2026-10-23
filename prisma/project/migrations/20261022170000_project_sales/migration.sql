-- Project 2B: Quotation, Bank Loan, Registration, Invoice, Payment, Order (sirf nayi tables / columns, purana data safe)
-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('APPLIED', 'SANCTIONED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'LOAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectActivityType" ADD VALUE 'QUOTATION';
ALTER TYPE "ProjectActivityType" ADD VALUE 'LOAN';
ALTER TYPE "ProjectActivityType" ADD VALUE 'REGISTRATION';
ALTER TYPE "ProjectActivityType" ADD VALUE 'INVOICE';
ALTER TYPE "ProjectActivityType" ADD VALUE 'PAYMENT';
ALTER TYPE "ProjectActivityType" ADD VALUE 'ORDER';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "contractValue" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "validUntil" DATE,
    "deliveryTimeline" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL,
    "installationCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transportCharges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" SERIAL NOT NULL,
    "quotationId" INTEGER NOT NULL,
    "productId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsn" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "qty" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "bankName" TEXT NOT NULL,
    "branch" TEXT,
    "applicationNo" TEXT,
    "loanAmount" DECIMAL(14,2) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'APPLIED',
    "sanctionedAmount" DECIMAL(14,2),
    "sanctionDate" DATE,
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "portal" TEXT NOT NULL,
    "discom" TEXT,
    "applicationNo" TEXT NOT NULL,
    "registrationDate" DATE NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "quotationId" INTEGER NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOrder" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "orderNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "paidPercent" DECIMAL(5,2) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quotation_projectId_idx" ON "Quotation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_companyId_quotationNo_key" ON "Quotation"("companyId", "quotationNo");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplication_projectId_key" ON "LoanApplication"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_projectId_key" ON "Registration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_projectId_key" ON "Invoice"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_quotationId_key" ON "Invoice"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_invoiceNo_key" ON "Invoice"("companyId", "invoiceNo");

-- CreateIndex
CREATE INDEX "Payment_projectId_idx" ON "Payment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrder_projectId_key" ON "ProjectOrder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOrder_companyId_orderNo_key" ON "ProjectOrder"("companyId", "orderNo");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

