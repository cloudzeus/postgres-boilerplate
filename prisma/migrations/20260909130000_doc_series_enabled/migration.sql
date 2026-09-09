-- AlterTable
ALTER TABLE "SoftoneDocSeries" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseDocType" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false;
