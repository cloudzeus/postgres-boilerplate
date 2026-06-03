CREATE TABLE "SupplierFieldRule" (
  "id" TEXT NOT NULL,
  "vatNumber" TEXT NOT NULL,
  "docType" "OcrDocType" NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "regionHint" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "supplierName" TEXT,
  "timesUsed" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierFieldRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierFieldRule_vatNumber_docType_key_key" ON "SupplierFieldRule"("vatNumber", "docType", "key");
CREATE INDEX "SupplierFieldRule_vatNumber_docType_idx" ON "SupplierFieldRule"("vatNumber", "docType");
