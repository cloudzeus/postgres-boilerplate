-- CreateEnum
CREATE TYPE "OcrCategory" AS ENUM ('EXPENSE','INVOICE_IN','INVOICE_OUT','RECEIPT','CREDIT_NOTE','PAYROLL','TAX','OTHER');
CREATE TYPE "OcrPostStatus" AS ENUM ('NONE','PENDING','POSTED','FAILED');

-- AlterTable
ALTER TABLE "OcrDocument"
  ADD COLUMN "thumbKey"   TEXT,
  ADD COLUMN "thumbUrl"   TEXT,
  ADD COLUMN "category"   "OcrCategory",
  ADD COLUMN "notes"      TEXT,
  ADD COLUMN "postStatus" "OcrPostStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "postedAt"   TIMESTAMP(3),
  ADD COLUMN "postedRef"  TEXT,
  ADD COLUMN "postError"  TEXT;

CREATE INDEX "OcrDocument_category_idx"   ON "OcrDocument"("category");
CREATE INDEX "OcrDocument_postStatus_idx" ON "OcrDocument"("postStatus");
