-- Έλεγχος λογαριασμού γενικής λογιστικής πριν την καταχώριση. ΜΟΝΟ ΠΡΟΣΘΗΚΕΣ: ένας νέος πίνακας
-- και δύο νέες nullable στήλες. Κανένα DROP, καμία μετονομασία, καμία αλλαγή τύπου, καμία
-- ενημέρωση υπαρχόντων δεδομένων.

-- Λογαριασμός γενικής της χρεοπίστωσης (MTRL.ACNMSK) και πότε διαβάστηκε. Και τα δύο κενά μέχρι
-- τον επόμενο συγχρονισμό χρεοπιστώσεων — τότε ο έλεγχος τα διαβάζει ως «άγνωστο», όχι «λείπει».
ALTER TABLE "SoftoneLineItem" ADD COLUMN "acnmsk" TEXT;
ALTER TABLE "SoftoneLineItem" ADD COLUMN "acnmskSyncedAt" TIMESTAMP(3);

-- Λογιστικό σχέδιο (ACNT) — καθρέφτης μόνο για ανάγνωση.
CREATE TABLE "SoftoneAccount" (
  "id"         SERIAL NOT NULL,
  "acnt"       INTEGER NOT NULL,
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "grade"      INTEGER,
  "parentCode" TEXT,
  "sodtype"    INTEGER,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SoftoneAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SoftoneAccount_acnt_key" ON "SoftoneAccount"("acnt");
CREATE UNIQUE INDEX "SoftoneAccount_code_key" ON "SoftoneAccount"("code");
CREATE INDEX "SoftoneAccount_parentCode_idx" ON "SoftoneAccount"("parentCode");
