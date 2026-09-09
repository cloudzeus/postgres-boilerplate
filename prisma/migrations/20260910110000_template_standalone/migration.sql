-- Templates become standalone (spec §14): slug is the identity, the supplier link is optional, docType goes away.
ALTER TABLE "ExtractionTemplate" ADD COLUMN "slug" TEXT;
-- Backfill: Latin-only slug + id fragment (Greek names of the few test rows collapse to "_<id>"; they get renamed in the UI).
UPDATE "ExtractionTemplate"
SET "slug" = trim(both '_' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '_', 'g'))) || '_' || left("id", 6);
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "ExtractionTemplate_slug_key" ON "ExtractionTemplate"("slug");

DROP INDEX IF EXISTS "ExtractionTemplate_vatNumber_docType_name_key";
DROP INDEX IF EXISTS "ExtractionTemplate_vatNumber_docType_status_idx";
ALTER TABLE "ExtractionTemplate" DROP COLUMN "docType";
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "vatNumber" DROP NOT NULL;
ALTER TABLE "ExtractionTemplate" ADD COLUMN "department" TEXT;
ALTER TABLE "ExtractionTemplate" ALTER COLUMN "mode" SET DEFAULT 'MANUAL';
CREATE INDEX "ExtractionTemplate_vatNumber_status_idx" ON "ExtractionTemplate"("vatNumber", "status");
