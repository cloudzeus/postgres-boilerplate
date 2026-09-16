-- Πότε ρωτήθηκε ΤΕΛΕΥΤΑΙΑ ο πάροχος για αυτή τη διεύθυνση.
-- Οι αστοχίες (found = false) ξαναρωτιούνται μετά από ένα παράθυρο (MISS_RETRY_DAYS)·
-- οι επιτυχίες δεν λήγουν ποτέ. Το `usedAt` δεν κάνει για μέτρο: χτυπιέται σε κάθε ανάγνωση.
ALTER TABLE "GeocodeCache" ADD COLUMN "checkedAt" TIMESTAMP(3);
-- Υπάρχουσες γραμμές: κληρονομούν τη στιγμή που γράφτηκαν, ώστε μια παλιά
-- αστοχία να μην ξαναπάρει καθαρή προθεσμία.
UPDATE "GeocodeCache" SET "checkedAt" = "createdAt" WHERE "checkedAt" IS NULL;
ALTER TABLE "GeocodeCache" ALTER COLUMN "checkedAt" SET NOT NULL;
ALTER TABLE "GeocodeCache" ALTER COLUMN "checkedAt" SET DEFAULT CURRENT_TIMESTAMP;
