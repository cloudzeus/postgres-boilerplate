-- Κανονικό JSON εγγράφου (spec §17.1, plan 5). Μία στήλη ανά έγγραφο για το πλήρες `document`
-- και μία ανά εκτέλεση προτύπου για τον φάκελο εξόδου (`{template, version, …, document}`).
-- Το `extractedData` ΜΕΝΕΙ: παράγεται πλέον από το `document` (συμβατότητα με λίστα/ουρές/posting).
ALTER TABLE "OcrDocument" ADD COLUMN "document" JSONB;
ALTER TABLE "TemplateRun" ADD COLUMN "output" JSONB;
