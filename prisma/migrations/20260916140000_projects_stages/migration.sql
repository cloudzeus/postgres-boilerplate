-- Έργα (PRJC) και κατηγορίες δραστηριότητας (PRJCSTAGE) ανά γραμμή, δίπλα στο κέντρο κόστους.
-- Προσθετικά/nullable: και τα τρία είναι προαιρετικά στο SoftOne.
CREATE TABLE "SoftoneProject" (
  "id"       SERIAL PRIMARY KEY,
  "prjc"     INTEGER NOT NULL,
  "code"     TEXT NOT NULL,
  "name"     TEXT NOT NULL,
  "trdr"     INTEGER,
  "prjType"  INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneProject_prjc_key" ON "SoftoneProject"("prjc");
CREATE INDEX "SoftoneProject_name_idx" ON "SoftoneProject"("name");
CREATE INDEX "SoftoneProject_code_idx" ON "SoftoneProject"("code");
CREATE INDEX "SoftoneProject_trdr_idx" ON "SoftoneProject"("trdr");

CREATE TABLE "SoftoneProjectStage" (
  "id"        SERIAL PRIMARY KEY,
  "prjcStage" INTEGER NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "syncedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneProjectStage_prjcStage_key" ON "SoftoneProjectStage"("prjcStage");
CREATE INDEX "SoftoneProjectStage_name_idx" ON "SoftoneProjectStage"("name");
CREATE INDEX "SoftoneProjectStage_code_idx" ON "SoftoneProjectStage"("code");

ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softonePrjc" INTEGER;
ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softonePrjcStage" INTEGER;
ALTER TABLE "LineMatchRule" ADD COLUMN "prjc" INTEGER;
ALTER TABLE "LineMatchRule" ADD COLUMN "prjcStage" INTEGER;
