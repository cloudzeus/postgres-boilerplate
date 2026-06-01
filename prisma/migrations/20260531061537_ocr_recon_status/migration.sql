-- Reconciliation / εκκρεμότητα fields on OcrDocument.
-- Display status is derived in app code; reconOverride is the manual hybrid lock.
ALTER TABLE "OcrDocument" ADD COLUMN "reconOverride" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "itemsTotal" INTEGER;
ALTER TABLE "OcrDocument" ADD COLUMN "itemsMatched" INTEGER;
