-- Λογιστική αρχικοποίηση: απαντήσεις λογιστή + θέματα integrator.
CREATE TABLE "AccountingAnswer" (
    "id" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingAnswer_questionKey_key" ON "AccountingAnswer"("questionKey");

CREATE TABLE "IntegratorItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'mid',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'accountant',
    "questionKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    CONSTRAINT "IntegratorItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegratorItem_status_idx" ON "IntegratorItem"("status");
