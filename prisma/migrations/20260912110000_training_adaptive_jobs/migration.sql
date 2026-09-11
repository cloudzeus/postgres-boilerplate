-- Plan 4: εκπαίδευση με δείγματα (§11), προσαρμοστικές περιοχές (§17.2), αναγνώριση (§14.7), jobs (§12).
-- Όλα προσθετικά: nullable ή με default, καμία στήλη δεν αλλάζει/σβήνεται.

-- §17.2 — η τελευταία επιτυχημένη θέση του πεδίου: { page, bbox, at, n } (κινητός μέσος όρος).
ALTER TABLE "TemplateField" ADD COLUMN "lastGood" JSONB;

-- §14.7 — αποτύπωμα διάταξης ανά δείγμα· «κύριο δείγμα» = αυτό πάνω στο οποίο σχεδιάστηκαν οι περιοχές.
ALTER TABLE "TemplateSample" ADD COLUMN "fingerprint" JSONB,
                             ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- §11 + §14.7 — αποτύπωμα του κύριου δείγματος και τα κατώφλια/βαθμοί εκπαίδευσης.
ALTER TABLE "ExtractionTemplate" ADD COLUMN "fingerprint" JSONB,
                                 ADD COLUMN "minTrainingScore" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
                                 ADD COLUMN "minTrainingSamples" INTEGER NOT NULL DEFAULT 3,
                                 ADD COLUMN "trainingScore" DOUBLE PRECISION,
                                 ADD COLUMN "verifiedSamples" INTEGER NOT NULL DEFAULT 0;

-- §12 — πλήθος σελίδων του αρχείου της εργασίας (για το page-image του detail panel).
ALTER TABLE "TemplateJobItem" ADD COLUMN "page" INTEGER;
