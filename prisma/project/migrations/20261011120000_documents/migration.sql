-- Documents: Lead / Customer / Project ki files (disk par uploads/ me, yahan sirf record)
-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "customerId" INTEGER,
    "projectId" INTEGER,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_companyId_leadId_idx" ON "Document"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "Document_companyId_customerId_idx" ON "Document"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Document_companyId_projectId_idx" ON "Document"("companyId", "projectId");

