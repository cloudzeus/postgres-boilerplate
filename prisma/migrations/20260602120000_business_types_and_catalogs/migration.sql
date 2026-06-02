-- CreateTable
CREATE TABLE "BusinessType" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessType_code_key" ON "BusinessType"("code");
CREATE INDEX "BusinessType_active_idx" ON "BusinessType"("active");
CREATE INDEX "BusinessType_order_idx" ON "BusinessType"("order");

CREATE TABLE "DocumentCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentCategory_name_key" ON "DocumentCategory"("name");
CREATE INDEX "DocumentCategory_active_idx" ON "DocumentCategory"("active");

CREATE TABLE "PhaseTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhaseTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PhaseTemplate_name_key" ON "PhaseTemplate"("name");
CREATE INDEX "PhaseTemplate_active_idx" ON "PhaseTemplate"("active");
CREATE INDEX "PhaseTemplate_order_idx" ON "PhaseTemplate"("order");

CREATE TABLE "RequirementBusinessType" (
  "id" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "businessTypeId" TEXT NOT NULL,
  CONSTRAINT "RequirementBusinessType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequirementBusinessType_requirementId_businessTypeId_key" ON "RequirementBusinessType"("requirementId","businessTypeId");
CREATE INDEX "RequirementBusinessType_requirementId_idx" ON "RequirementBusinessType"("requirementId");
CREATE INDEX "RequirementBusinessType_businessTypeId_idx" ON "RequirementBusinessType"("businessTypeId");

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "businessTypeId" TEXT;
ALTER TABLE "Company" ADD COLUMN "businessTypeOverride" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Company_businessTypeId_idx" ON "Company"("businessTypeId");

ALTER TABLE "DocumentType" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "DocumentType_categoryId_idx" ON "DocumentType"("categoryId");

ALTER TABLE "PhaseDocumentRequirement" ADD COLUMN "appliesToAll" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProgramPhase" ADD COLUMN "phaseTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "RequirementBusinessType" ADD CONSTRAINT "RequirementBusinessType_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PhaseDocumentRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementBusinessType" ADD CONSTRAINT "RequirementBusinessType_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "BusinessType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "BusinessType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentType" ADD CONSTRAINT "DocumentType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocumentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgramPhase" ADD CONSTRAINT "ProgramPhase_phaseTemplateId_fkey" FOREIGN KEY ("phaseTemplateId") REFERENCES "PhaseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
