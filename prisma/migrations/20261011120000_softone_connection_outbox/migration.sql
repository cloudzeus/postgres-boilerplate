-- Σύνδεση SoftOne: ταυτότητα εγκατάστασης, εμπιστοσύνη καθρεφτών, ουρά εργασιών.
CREATE TYPE "SoftoneOutboxStatus" AS ENUM ('PENDING', 'SENT', 'NEEDS_REVIEW', 'REJECTED', 'CANCELLED');

CREATE TABLE "SoftoneOutbox" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SoftoneOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "result" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "SoftoneOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SoftoneOutbox_idempotencyKey_key" ON "SoftoneOutbox"("idempotencyKey");
CREATE INDEX "SoftoneOutbox_status_createdAt_idx" ON "SoftoneOutbox"("status", "createdAt");
CREATE INDEX "SoftoneOutbox_tenantKey_idx" ON "SoftoneOutbox"("tenantKey");

CREATE TABLE "SoftoneMirrorState" (
    "table" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SoftoneMirrorState_pkey" PRIMARY KEY ("table")
);
CREATE INDEX "SoftoneMirrorState_tenantKey_idx" ON "SoftoneMirrorState"("tenantKey");

CREATE TABLE "SoftoneConnectionEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "tenantKey" TEXT,
    "prevTenantKey" TEXT,
    "detail" JSONB,
    CONSTRAINT "SoftoneConnectionEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SoftoneConnectionEvent_at_idx" ON "SoftoneConnectionEvent"("at");
