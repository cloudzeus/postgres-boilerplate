-- CreateTable
CREATE TABLE "Region" (
    "code" TEXT NOT NULL,
    "nameEL" TEXT NOT NULL,
    "nameEN" TEXT,
    "level" INTEGER NOT NULL,
    "parentCode" TEXT,
    "path" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("code")
);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "regionCode" TEXT;

-- AlterTable
ALTER TABLE "CompanyBranch" ADD COLUMN "regionCode" TEXT;

-- CreateIndex
CREATE INDEX "Region_parentCode_idx" ON "Region"("parentCode");

-- CreateIndex
CREATE INDEX "Region_level_idx" ON "Region"("level");

-- CreateIndex
CREATE INDEX "Region_nameEL_idx" ON "Region"("nameEL");

-- CreateIndex
CREATE INDEX "Company_regionCode_idx" ON "Company"("regionCode");

-- CreateIndex
CREATE INDEX "CompanyBranch_regionCode_idx" ON "CompanyBranch"("regionCode");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "Region"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "Region"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBranch" ADD CONSTRAINT "CompanyBranch_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "Region"("code") ON DELETE SET NULL ON UPDATE CASCADE;
