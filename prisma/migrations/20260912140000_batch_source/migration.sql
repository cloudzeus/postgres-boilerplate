-- Ένα σαρωμένο PDF με πολλά παραστατικά κόβεται σε παιδιά, αλλά το ΠΡΩΤΟΤΥΠΟ δεν χάνεται: μένει
-- ανεβασμένο μία φορά κάτω από τον φάκελο (`ocr/batches/{id}/source.pdf`), ώστε ο χρήστης να
-- μπορεί πάντα να γυρίσει σε αυτό — και να ξανακοπεί αν τα κοψίματα ήταν λάθος.
ALTER TABLE "OcrBatch"
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourcePages" INTEGER;
