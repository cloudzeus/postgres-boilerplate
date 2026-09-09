-- CreateEnum
CREATE TYPE "TemplateMode" AS ENUM ('AUTO', 'SEMI_AUTO', 'MANUAL');
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'ACTIVE');
CREATE TYPE "TemplateFieldKind" AS ENUM ('SINGLE', 'TABLE');
CREATE TYPE "TemplateValueType" AS ENUM ('TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'LIST');
CREATE TYPE "MappingTarget" AS ENUM ('INVOICE', 'EXCEL');
CREATE TYPE "TemplateRunStatus" AS ENUM ('EXTRACTED', 'REVIEW', 'BLOCKED', 'POSTED', 'FAILED');
CREATE TYPE "TemplateSampleStatus" AS ENUM ('PENDING', 'READ', 'VERIFIED');
CREATE TYPE "TemplateJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
CREATE TYPE "TemplateJobItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ExtractionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "traderTrdr" INTEGER,
    "supplierName" TEXT,
    "docType" "OcrDocType" NOT NULL DEFAULT 'INVOICE',
    "mode" "TemplateMode" NOT NULL DEFAULT 'SEMI_AUTO',
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sampleStorageKey" TEXT,
    "sampleMimeType" TEXT,
    "samplePageCount" INTEGER,
    "sampleThumbUrl" TEXT,
    "notifyEmails" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExtractionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "TemplateFieldKind" NOT NULL DEFAULT 'SINGLE',
    "valueType" "TemplateValueType" NOT NULL DEFAULT 'TEXT',
    "color" TEXT NOT NULL,
    "region" JSONB,
    "columns" JSONB,
    "aiHint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "target" "MappingTarget" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "rows" JSONB NOT NULL,
    CONSTRAINT "TemplateMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateCondition" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logic" TEXT NOT NULL DEFAULT 'AND',
    "clauses" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    CONSTRAINT "TemplateCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "TemplateRunStatus" NOT NULL,
    "values" JSONB NOT NULL,
    "matched" JSONB NOT NULL,
    "flags" JSONB,
    "mappingName" TEXT NOT NULL,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateSample" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "TemplateSampleStatus" NOT NULL DEFAULT 'PENDING',
    "expected" JSONB,
    "lastResult" JSONB,
    "score" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TemplateSample_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateJob" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "TemplateJobStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TemplateJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "TemplateJobItemStatus" NOT NULL DEFAULT 'QUEUED',
    "values" JSONB,
    "matched" JSONB,
    "flags" JSONB,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TemplateJobItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ExtractionTemplate_vatNumber_docType_name_key" ON "ExtractionTemplate"("vatNumber", "docType", "name");
CREATE INDEX "ExtractionTemplate_vatNumber_docType_status_idx" ON "ExtractionTemplate"("vatNumber", "docType", "status");
CREATE UNIQUE INDEX "TemplateField_templateId_key_key" ON "TemplateField"("templateId", "key");
CREATE INDEX "TemplateField_templateId_idx" ON "TemplateField"("templateId");
CREATE UNIQUE INDEX "TemplateMapping_templateId_name_key" ON "TemplateMapping"("templateId", "name");
CREATE INDEX "TemplateCondition_templateId_order_idx" ON "TemplateCondition"("templateId", "order");
CREATE INDEX "TemplateRun_documentId_idx" ON "TemplateRun"("documentId");
CREATE INDEX "TemplateRun_templateId_createdAt_idx" ON "TemplateRun"("templateId", "createdAt");
CREATE INDEX "TemplateSample_templateId_idx" ON "TemplateSample"("templateId");
CREATE INDEX "TemplateJob_status_createdAt_idx" ON "TemplateJob"("status", "createdAt");
CREATE INDEX "TemplateJob_templateId_createdAt_idx" ON "TemplateJob"("templateId", "createdAt");
CREATE INDEX "TemplateJobItem_jobId_order_idx" ON "TemplateJobItem"("jobId", "order");
CREATE INDEX "TemplateJobItem_status_idx" ON "TemplateJobItem"("status");

-- Foreign keys
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateMapping" ADD CONSTRAINT "TemplateMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateCondition" ADD CONSTRAINT "TemplateCondition_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateSample" ADD CONSTRAINT "TemplateSample_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateJob" ADD CONSTRAINT "TemplateJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateJobItem" ADD CONSTRAINT "TemplateJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TemplateJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateRun" ADD CONSTRAINT "TemplateRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExtractionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateRun" ADD CONSTRAINT "TemplateRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
