-- CreateTable
CREATE TABLE "SupplierTemplate" (
    "id" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "docType" "OcrDocType" NOT NULL,
    "supplierName" TEXT,
    "example" JSONB NOT NULL,
    "fieldHints" JSONB,
    "sampleDocId" TEXT,
    "thumbUrl" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierTemplate_vatNumber_idx" ON "SupplierTemplate"("vatNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierTemplate_vatNumber_docType_key" ON "SupplierTemplate"("vatNumber", "docType");
