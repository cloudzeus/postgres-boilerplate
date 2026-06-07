-- CreateEnum
CREATE TYPE "TaxTemplateStatus" AS ENUM ('DRAFT', 'READY');
CREATE TYPE "FinancialValueType" AS ENUM ('CURRENCY', 'NUMBER', 'PERCENT', 'INTEGER', 'DATE', 'BOOLEAN');
CREATE TYPE "FinancialValueSource" AS ENUM ('OCR', 'MANUAL');
CREATE TYPE "FinancialYearMode" AS ENUM ('REFERENCE', 'PRIOR_1', 'PRIOR_2', 'PRIOR_3');

-- AlterEnum: extend pre-existing AiScope with the tax-form extraction scope
ALTER TYPE "AiScope" ADD VALUE IF NOT EXISTS 'TAX_FORM';

-- CreateTable
CREATE TABLE "TaxFormTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "year" INTEGER,
  "description" TEXT,
  "status" "TaxTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "sampleStorageKey" TEXT,
  "samplePageCount" INTEGER,
  "sampleThumbUrl" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxFormTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxFormTemplate_code_year_key" ON "TaxFormTemplate"("code", "year");
CREATE INDEX "TaxFormTemplate_status_idx" ON "TaxFormTemplate"("status");

CREATE TABLE "TaxFormTemplateField" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "section" TEXT,
  "valueType" "FinancialValueType" NOT NULL DEFAULT 'CURRENCY',
  "regionHint" JSONB,
  "aiHint" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxFormTemplateField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxFormTemplateField_templateId_fieldKey_key" ON "TaxFormTemplateField"("templateId", "fieldKey");
CREATE INDEX "TaxFormTemplateField_templateId_idx" ON "TaxFormTemplateField"("templateId");

CREATE TABLE "CompanyFinancialValue" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "templateId" TEXT,
  "year" INTEGER NOT NULL,
  "value" DECIMAL(18,2) NOT NULL,
  "valueType" "FinancialValueType" NOT NULL,
  "source" "FinancialValueSource" NOT NULL DEFAULT 'OCR',
  "sourceDocumentId" TEXT,
  "confidence" DOUBLE PRECISION,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyFinancialValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyFinancialValue_companyId_fieldKey_year_key" ON "CompanyFinancialValue"("companyId", "fieldKey", "year");
CREATE INDEX "CompanyFinancialValue_companyId_idx" ON "CompanyFinancialValue"("companyId");
CREATE INDEX "CompanyFinancialValue_fieldKey_year_idx" ON "CompanyFinancialValue"("fieldKey", "year");

CREATE TABLE "ProgramRequiredField" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "yearsBack" INTEGER NOT NULL DEFAULT 1,
  "mandatory" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgramRequiredField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProgramRequiredField_programId_templateId_fieldKey_key" ON "ProgramRequiredField"("programId", "templateId", "fieldKey");
CREATE INDEX "ProgramRequiredField_programId_idx" ON "ProgramRequiredField"("programId");

-- AlterTable
ALTER TABLE "OcrDocument" ADD COLUMN "companyId" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "taxTemplateId" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "fiscalYear" INTEGER;
CREATE INDEX "OcrDocument_companyId_idx" ON "OcrDocument"("companyId");

-- AddForeignKey
ALTER TABLE "TaxFormTemplateField" ADD CONSTRAINT "TaxFormTemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaxFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyFinancialValue" ADD CONSTRAINT "CompanyFinancialValue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramRequiredField" ADD CONSTRAINT "ProgramRequiredField_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramRequiredField" ADD CONSTRAINT "ProgramRequiredField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaxFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OcrDocument" ADD CONSTRAINT "OcrDocument_taxTemplateId_fkey" FOREIGN KEY ("taxTemplateId") REFERENCES "TaxFormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
