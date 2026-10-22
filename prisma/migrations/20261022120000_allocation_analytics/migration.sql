-- Αναλυτικά ανά κομμάτι επιμερισμού (μοίρασμα σε κέντρα κόστους με τον ίδιο λογαριασμό).
-- Μόνο νέες, κενές στήλες — καμία αλλαγή σε υπάρχοντα δεδομένα.
ALTER TABLE "OcrInvoiceItemAllocation" ADD COLUMN "costCntr" INTEGER;
ALTER TABLE "OcrInvoiceItemAllocation" ADD COLUMN "prjc" INTEGER;
ALTER TABLE "OcrInvoiceItemAllocation" ADD COLUMN "prjcStage" INTEGER;
