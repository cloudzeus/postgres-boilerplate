-- Χαρακτηρισμός myDATA: ζει στο ΜΗΤΡΩΟ (είδος / υπηρεσία / χρεοπίστωση / έξοδο), όχι στη γραμμή
-- του παραστατικού. Προσθετικά, nullable — καμία υπάρχουσα συμπεριφορά δεν αλλάζει.

ALTER TABLE "SoftoneItem" ADD COLUMN "myDataCode" TEXT;

ALTER TABLE "SoftoneExpense" ADD COLUMN "classType"      INTEGER;
ALTER TABLE "SoftoneExpense" ADD COLUMN "classTypeX"     INTEGER;
ALTER TABLE "SoftoneExpense" ADD COLUMN "classCategory"  INTEGER;
ALTER TABLE "SoftoneExpense" ADD COLUMN "classCategoryX" INTEGER;
ALTER TABLE "SoftoneExpense" ADD COLUMN "myDataVprc"     INTEGER;

ALTER TABLE "SoftoneLineItem" ADD COLUMN "classType"     INTEGER;
ALTER TABLE "SoftoneLineItem" ADD COLUMN "classCategory" INTEGER;
ALTER TABLE "SoftoneLineItem" ADD COLUMN "myDataCode"    TEXT;
ALTER TABLE "SoftoneLineItem" ADD COLUMN "myDataVprc"    INTEGER;

CREATE TABLE "SoftoneMyDataClassType" (
  "id"         SERIAL PRIMARY KEY,
  "sotype"     INTEGER NOT NULL,
  "code"       INTEGER NOT NULL,
  "myDataCode" TEXT,
  "sohCode"    TEXT,
  "name"       TEXT NOT NULL,
  "isVat"      BOOLEAN NOT NULL DEFAULT false,
  "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneMyDataClassType_sotype_code_key" ON "SoftoneMyDataClassType"("sotype", "code");
CREATE INDEX "SoftoneMyDataClassType_name_idx" ON "SoftoneMyDataClassType"("name");

CREATE TABLE "SoftoneMyDataClassCategory" (
  "id"         SERIAL PRIMARY KEY,
  "sotype"     INTEGER NOT NULL,
  "code"       INTEGER NOT NULL,
  "myDataCode" TEXT,
  "sohCode"    TEXT,
  "name"       TEXT NOT NULL,
  "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneMyDataClassCategory_sotype_code_key" ON "SoftoneMyDataClassCategory"("sotype", "code");
CREATE INDEX "SoftoneMyDataClassCategory_name_idx" ON "SoftoneMyDataClassCategory"("name");
