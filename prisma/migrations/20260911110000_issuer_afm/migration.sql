-- ΑΦΜ εκδότη ως στήλη με index: οι ουρές («Νέοι συναλλασσόμενοι», «Είδη & έξοδα») το
-- ρωτούσαν μέχρι τώρα σαρώνοντας το JSON `extractedData` κάθε εγγράφου.
ALTER TABLE "OcrDocument" ADD COLUMN "issuerAfm" TEXT;
CREATE INDEX "OcrDocument_issuerAfm_idx" ON "OcrDocument"("issuerAfm");

-- Backfill από τα ήδη εξαγμένα δεδομένα (μόνο ψηφία, όπως το `normalizeAfm`).
UPDATE "OcrDocument"
SET "issuerAfm" = regexp_replace(COALESCE("extractedData"->>'vatNumber',''), '\D', '', 'g')
WHERE "extractedData" IS NOT NULL;

-- Κενό ≠ «χωρίς ΑΦΜ»: τα κενά γίνονται NULL ώστε τα φίλτρα `issuerAfm IS NOT NULL` να είναι σωστά.
UPDATE "OcrDocument" SET "issuerAfm" = NULL WHERE "issuerAfm" = '';
