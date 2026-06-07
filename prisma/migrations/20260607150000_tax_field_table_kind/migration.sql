-- AlterEnum
ALTER TYPE "TaxFieldKind" ADD VALUE IF NOT EXISTS 'TABLE';

-- AlterTable
ALTER TABLE "TaxFormTemplateField" ADD COLUMN "config" JSONB;
