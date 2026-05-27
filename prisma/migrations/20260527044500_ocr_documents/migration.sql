-- CreateEnum
CREATE TYPE "OcrDocType" AS ENUM ('INVOICE', 'RECEIPT', 'GENERAL_TEXT');
CREATE TYPE "OcrPdfSource" AS ENUM ('DIGITAL', 'SCANNED');
CREATE TYPE "OcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "OcrDocument" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "docType" "OcrDocType" NOT NULL,
    "pdfSource" "OcrPdfSource",
    "language" TEXT NOT NULL DEFAULT 'el',
    "status" "OcrStatus" NOT NULL DEFAULT 'PENDING',
    "rawText" TEXT,
    "extractedData" JSONB,
    "errorMessage" TEXT,
    "model" TEXT,
    "tokensUsed" INTEGER,
    "durationMs" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "OcrDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OcrDocument_storageKey_key" ON "OcrDocument"("storageKey");
CREATE INDEX "OcrDocument_status_idx" ON "OcrDocument"("status");
CREATE INDEX "OcrDocument_docType_idx" ON "OcrDocument"("docType");
CREATE INDEX "OcrDocument_createdAt_idx" ON "OcrDocument"("createdAt");

CREATE TABLE "OcrInvoiceItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "price" DECIMAL(18,4),
    "discount" DECIMAL(18,4),
    "total" DECIMAL(18,4),
    CONSTRAINT "OcrInvoiceItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OcrInvoiceItem_documentId_idx" ON "OcrInvoiceItem"("documentId");

ALTER TABLE "OcrInvoiceItem" ADD CONSTRAINT "OcrInvoiceItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
