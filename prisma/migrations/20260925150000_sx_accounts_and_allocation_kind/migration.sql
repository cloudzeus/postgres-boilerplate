-- Καθρέφτης των λογαριασμών ΕΣΟΔΩΝ / ΕΞΟΔΩΝ του SoftOne (object `SXACNT` → `MTRL` SODTYPE 61).
--
-- ΓΙΑΤΙ: είναι το μητρώο της ενότητας 1261 «Παραστατικά εξόδων» (object `SXDOCSEX`) — η φυσική
-- ενότητα των δαπανών, που η εφαρμογή δεν υποστήριζε καθόλου. Εκεί ο επιμερισμός μιας γραμμής σε
-- πολλούς λογαριασμούς είναι NATIVE (πίνακας `SXEXPANAL`), σε αντίθεση με τη σειρά πιστωτών όπου
-- τον εκφράζουμε ως N γραμμές `LINLINES`.
--
-- ΜΟΝΟ ΠΡΟΣΘΗΚΗ: ένας νέος πίνακας καθρέφτη, γεμάτος αποκλειστικά από συγχρονισμό. Καμία υπάρχουσα
-- στήλη δεν αλλάζει και καμία γραμμή δεν πειράζεται. Όσο ο πίνακας είναι άδειος, τίποτα στην
-- εφαρμογή δεν αλλάζει συμπεριφορά.
--
-- Μετρημένο στο tenant (2026-09-25): 542 λογαριασμοί, όλοι ενεργοί —
--   MTRTYPE 1: 208 έσοδα · 2: 167 ΕΞΟΔΑ · 3: 14 δημοτικός φόρος · 4: 1 ΕΛΓΑ ·
--   5: 94 ΦΠΑ πωλήσεων · 6: 54 ΦΠΑ αγορών · 8: 4 ταμειακές κινήσεις.

CREATE TABLE "SoftoneSxAccount" (
    "id"         SERIAL NOT NULL,
    "mtrl"       INTEGER NOT NULL,
    "code"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "mtrType"    INTEGER,
    "soClmns"    INTEGER,
    "vat"        TEXT,
    "myDataCode" TEXT,
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "syncedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftoneSxAccount_pkey" PRIMARY KEY ("id")
);

-- Το `MTRL` είναι η ταυτότητα του λογαριασμού στο SoftOne: ο συγχρονισμός κάνει upsert πάνω του.
CREATE UNIQUE INDEX "SoftoneSxAccount_mtrl_key" ON "SoftoneSxAccount"("mtrl");

CREATE INDEX "SoftoneSxAccount_name_idx"    ON "SoftoneSxAccount"("name");
CREATE INDEX "SoftoneSxAccount_code_idx"    ON "SoftoneSxAccount"("code");
-- Ο επιλογέας δαπανών ζητά ΜΟΝΟ τους λογαριασμούς εξόδων (MTRTYPE 2), όχι και τους 542.
CREATE INDEX "SoftoneSxAccount_mtrType_idx" ON "SoftoneSxAccount"("mtrType");

-- ------------------------------------------------------------------
-- Ο ΕΠΙΜΕΡΙΣΜΟΣ γίνεται ΑΝΕΞΑΡΤΗΤΟΣ λογιστικού κόσμου.
--
-- Η εφαρμογή δίνεται σε ΠΟΛΛΟΥΣ πελάτες: άλλος τηρεί διπλογραφικά (ΕΓΛΣ → χρεοπιστώσεις,
-- `MTRL` SODTYPE 53) και άλλος απλογραφικά (βιβλία Β' → λογαριασμοί εσόδων/εξόδων,
-- `MTRL` SODTYPE 61). Και τα δύο μητρώα είναι `MTRL`, άρα ΣΚΕΤΟΣ ο αριθμός είναι ΔΙΦΟΡΟΥΜΕΝΟΣ:
-- χωρίς `kind` κανείς δεν μπορεί να πει σε ποιο μητρώο δείχνει μια αποθηκευμένη γραμμή.
--
-- Το παλιό όνομα `linMtrl` υπέθετε τον έναν κόσμο. Γίνεται τώρα, όσο ο πίνακας είναι ΑΔΕΙΟΣ —
-- με δεδομένα πελατών μέσα θα ήταν πολύ ακριβότερο.
ALTER TABLE "OcrInvoiceItemAllocation" RENAME COLUMN "linMtrl" TO "registryMtrl";

-- `LINEITEM` = χρεοπίστωση (SODTYPE 53) · `SXACCOUNT` = λογαριασμός εσόδων/εξόδων (SODTYPE 61).
-- Το default υπάρχει μόνο για να περάσει το NOT NULL σε άδειο πίνακα· ο κώδικας γράφει ΠΑΝΤΑ ρητό kind.
ALTER TABLE "OcrInvoiceItemAllocation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'LINEITEM';

ALTER INDEX "OcrInvoiceItemAllocation_linMtrl_idx" RENAME TO "OcrInvoiceItemAllocation_registryMtrl_idx";
