ALTER TABLE "SupplierFieldRule" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'document';
ALTER TABLE "SupplierFieldRule" ADD COLUMN "valueType" TEXT NOT NULL DEFAULT 'text';
