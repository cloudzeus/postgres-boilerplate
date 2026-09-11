-- Doc-type classification result on the document; expense links on lines; new registries (spec 2026-09-11 §5).
ALTER TABLE "OcrDocument" ADD COLUMN "seriesSource" INTEGER;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesConfidence" DOUBLE PRECISION;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesReason" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesBy" TEXT;

ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softoneExpn" INTEGER;
CREATE INDEX "OcrInvoiceItem_softoneExpn_idx" ON "OcrInvoiceItem"("softoneExpn");

CREATE TABLE "SoftoneExpense" (
  "id" SERIAL PRIMARY KEY,
  "expn" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vat" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneExpense_expn_key" ON "SoftoneExpense"("expn");
CREATE INDEX "SoftoneExpense_name_idx" ON "SoftoneExpense"("name");
CREATE INDEX "SoftoneExpense_code_idx" ON "SoftoneExpense"("code");

-- Generic rules use afm = '' (never NULL): Postgres treats NULLs as distinct in a unique index.
CREATE TABLE "LineMatchRule" (
  "id" TEXT PRIMARY KEY,
  "afm" TEXT NOT NULL DEFAULT '',
  "pattern" TEXT NOT NULL,
  "mtrl" INTEGER,
  "expn" INTEGER,
  "isService" BOOLEAN NOT NULL DEFAULT false,
  "timesUsed" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "LineMatchRule_afm_pattern_key" ON "LineMatchRule"("afm", "pattern");
CREATE INDEX "LineMatchRule_pattern_idx" ON "LineMatchRule"("pattern");

CREATE TABLE "IgnoredIssuer" (
  "afm" TEXT PRIMARY KEY,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
