-- Πότε ΑΝΘΡΩΠΟΣ επιβεβαίωσε την ανάγνωση ενός εγγράφου, και ποιος. Ένα τέτοιο έγγραφο είναι το
-- μόνο που επιτρέπεται να γίνει «παράδειγμα αναφοράς» για τον ίδιο εκδότη (few-shot): ό,τι βγήκε
-- αυτόματα δεν έχει καμία εγγύηση ότι είναι σωστό, και ένα λάθος παράδειγμα διδάσκει το λάθος.
ALTER TABLE "OcrDocument"
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT;

-- Η μία ερώτηση που κάνει το feature: «το νεότερο επιβεβαιωμένο έγγραφο αυτού του ΑΦΜ».
CREATE INDEX "OcrDocument_issuerAfm_verifiedAt_idx" ON "OcrDocument"("issuerAfm", "verifiedAt");
