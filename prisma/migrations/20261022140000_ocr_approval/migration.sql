-- Εγκρίσεις καταχώρισης παραστατικών (όρια ποσού, επίπεδα). Μόνο νέος πίνακας.
CREATE TABLE "OcrApproval" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "roleKey" TEXT,
    "comment" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OcrApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OcrApproval_documentId_idx" ON "OcrApproval"("documentId");
ALTER TABLE "OcrApproval" ADD CONSTRAINT "OcrApproval_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OcrDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
