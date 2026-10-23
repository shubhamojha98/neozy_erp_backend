-- B2B sales order ke documents (PO, challan, delivery proof). Purana data safe — sirf naya nullable column.
ALTER TABLE "project"."Document" ADD COLUMN "salesOrderId" INTEGER;

CREATE INDEX "Document_companyId_salesOrderId_idx" ON "project"."Document"("companyId", "salesOrderId");
