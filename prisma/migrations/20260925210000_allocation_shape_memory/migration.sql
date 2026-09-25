-- Μνήμη ΣΧΗΜΑΤΟΣ επιμερισμού: ο ίδιος προμηθευτής με την ίδια γραμμή σπάει κάθε μήνα με τον ίδιο
-- τρόπο. Το `LineMatchRule` θυμάται έναν λογαριασμό· αυτό θυμάται ολόκληρη την αναλογία.
CREATE TABLE "AllocationShapeRule" (
    "id"          TEXT NOT NULL,
    "afm"         TEXT NOT NULL DEFAULT '',
    "pattern"     TEXT NOT NULL,
    "kind"        TEXT NOT NULL DEFAULT 'LINEITEM',
    "parts"       JSONB NOT NULL,
    "timesUsed"   INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt"  TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AllocationShapeRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllocationShapeRule_afm_pattern_kind_key"
    ON "AllocationShapeRule"("afm", "pattern", "kind");

CREATE INDEX "AllocationShapeRule_pattern_idx"
    ON "AllocationShapeRule"("pattern");
