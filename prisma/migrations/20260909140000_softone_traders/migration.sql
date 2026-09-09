-- CreateTable
CREATE TABLE "SoftoneTrader" (
    "id" SERIAL NOT NULL,
    "trdr" INTEGER NOT NULL,
    "sodtype" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "afm" TEXT,
    "doy" TEXT,
    "profession" TEXT,
    "address" TEXT,
    "district" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "webpage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SoftoneTrader_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoftoneTrader_trdr_key" ON "SoftoneTrader"("trdr");
CREATE INDEX "SoftoneTrader_sodtype_idx" ON "SoftoneTrader"("sodtype");
CREATE INDEX "SoftoneTrader_name_idx" ON "SoftoneTrader"("name");
CREATE INDEX "SoftoneTrader_code_idx" ON "SoftoneTrader"("code");
CREATE INDEX "SoftoneTrader_afm_idx" ON "SoftoneTrader"("afm");

-- DropTable (mirrors replaced by SoftoneTrader; re-populated by the SoftOne sync)
DROP TABLE "SoftoneCustomer";
DROP TABLE "SoftoneSupplier";
