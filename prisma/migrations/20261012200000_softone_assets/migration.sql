-- Πάγια: καθρέφτης μητρώου παγίων SoftOne και αντιστοίχιση γραμμής σε πάγιο (ASSLINES).
ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softoneAsset" INTEGER;
CREATE INDEX "OcrInvoiceItem_softoneAsset_idx" ON "OcrInvoiceItem"("softoneAsset");

CREATE TABLE "SoftoneAsset" (
    "id" SERIAL NOT NULL,
    "mtrl" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vat" TEXT,
    "mtrAcn" INTEGER,
    "mtrCategory" INTEGER,
    "acnmsk" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SoftoneAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SoftoneAsset_mtrl_key" ON "SoftoneAsset"("mtrl");
CREATE INDEX "SoftoneAsset_name_idx" ON "SoftoneAsset"("name");
CREATE INDEX "SoftoneAsset_code_idx" ON "SoftoneAsset"("code");
