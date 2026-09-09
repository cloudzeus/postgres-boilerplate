-- CreateTable
CREATE TABLE "SoftoneDocSeries" (
    "id" SERIAL NOT NULL,
    "sosource" INTEGER NOT NULL,
    "family" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "abbrev" TEXT,
    "name" TEXT NOT NULL,
    "section" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SoftoneDocSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SoftoneDocSeries_sosource_idx" ON "SoftoneDocSeries"("sosource");

-- CreateIndex
CREATE UNIQUE INDEX "SoftoneDocSeries_sosource_code_key" ON "SoftoneDocSeries"("sosource", "code");
