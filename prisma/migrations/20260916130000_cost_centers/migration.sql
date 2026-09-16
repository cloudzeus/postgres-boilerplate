-- Κέντρα κόστους ανά γραμμή παραστατικού (PRSCOSTCNTR → DB COSTCNTR). Όλα προσθετικά/nullable:
-- το κέντρο κόστους είναι ΠΡΟΑΙΡΕΤΙΚΟ στο SoftOne και δεν εμποδίζει ποτέ μια καταχώριση.
CREATE TABLE "SoftoneCostCenter" (
  "id"       SERIAL PRIMARY KEY,
  "costcntr" INTEGER NOT NULL,
  "code"     TEXT NOT NULL,
  "name"     TEXT NOT NULL,
  "name2"    TEXT,
  "sohCode"  TEXT,
  "acnmsk"   TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneCostCenter_costcntr_key" ON "SoftoneCostCenter"("costcntr");
CREATE INDEX "SoftoneCostCenter_name_idx" ON "SoftoneCostCenter"("name");
CREATE INDEX "SoftoneCostCenter_code_idx" ON "SoftoneCostCenter"("code");

ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softoneCostCntr" INTEGER;
ALTER TABLE "LineMatchRule"  ADD COLUMN "costCntr" INTEGER;
