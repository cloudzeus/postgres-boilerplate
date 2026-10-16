-- Ιστορικό ελέγχων ξένου ΑΦΜ (cache + αποδεικτικό). Μόνο νέος πίνακας.
CREATE TABLE "VatCheck" (
    "id" TEXT NOT NULL,
    "vat" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "valid" BOOLEAN,
    "name" TEXT,
    "address" TEXT,
    "provider" TEXT,
    "source" TEXT,
    "consultationNumber" TEXT,
    "requester" TEXT,
    "match" JSONB,
    "error" TEXT,
    "message" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VatCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VatCheck_vat_createdAt_idx" ON "VatCheck"("vat", "createdAt");
