-- Στόχος καταχώρισης ανά σειρά + μητρώα χρεοπιστώσεων / κατηγοριών δαπανών.
-- Όλα προσθετικά και nullable: καμία υπάρχουσα γραμμή δεν αλλάζει συμπεριφορά (NULL = η προεπιλογή).

-- 1) Ποιο SoftOne object και ποιον πίνακα γραμμών καταχωρεί κάθε σειρά.
ALTER TABLE "PurchaseDocType"  ADD COLUMN "postObject" TEXT;
ALTER TABLE "PurchaseDocType"  ADD COLUMN "postLines"  TEXT;
ALTER TABLE "SoftoneDocSeries" ADD COLUMN "postObject" TEXT;
ALTER TABLE "SoftoneDocSeries" ADD COLUMN "postLines"  TEXT;

-- 2) Χρεοπιστώσεις (LINEITEM → MTRL SODTYPE 53) — το MTRL μιας γραμμής LINLINES.
CREATE TABLE "SoftoneLineItem" (
  "id"          SERIAL PRIMARY KEY,
  "mtrl"        INTEGER NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "vat"         TEXT,
  "mtrType"     INTEGER,
  "mtrCategory" INTEGER,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "syncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneLineItem_mtrl_key" ON "SoftoneLineItem"("mtrl");
CREATE INDEX "SoftoneLineItem_name_idx" ON "SoftoneLineItem"("name");
CREATE INDEX "SoftoneLineItem_code_idx" ON "SoftoneLineItem"("code");
CREATE INDEX "SoftoneLineItem_mtrCategory_idx" ON "SoftoneLineItem"("mtrCategory");

-- 3) Κατηγορίες δαπανών (LINCATEGORY → MTRCATEGORY SODTYPE 53) — η ομαδοποίηση πάνω από τις χρεοπιστώσεις.
CREATE TABLE "SoftoneLineCategory" (
  "id"          SERIAL PRIMARY KEY,
  "mtrCategory" INTEGER NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "vat"         TEXT,
  "acnmsk"      TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "syncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneLineCategory_mtrCategory_key" ON "SoftoneLineCategory"("mtrCategory");
CREATE INDEX "SoftoneLineCategory_name_idx" ON "SoftoneLineCategory"("name");
CREATE INDEX "SoftoneLineCategory_code_idx" ON "SoftoneLineCategory"("code");

-- 4) Αντιστοίχιση γραμμής σε χρεοπίστωση + μνήμη κανόνα.
ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softoneLinMtrl" INTEGER;
CREATE INDEX "OcrInvoiceItem_softoneLinMtrl_idx" ON "OcrInvoiceItem"("softoneLinMtrl");
ALTER TABLE "LineMatchRule" ADD COLUMN "lin" INTEGER;
