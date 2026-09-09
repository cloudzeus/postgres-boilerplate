-- Plan 3: runs record what triggered them and why they failed; documents cache the latest run's flags for the list.
ALTER TABLE "TemplateRun" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "TemplateRun" ADD COLUMN "error" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "reviewFlags" JSONB;
