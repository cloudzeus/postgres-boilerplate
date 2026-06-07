-- CreateEnum
CREATE TYPE "TaxFieldKind" AS ENUM ('SINGLE', 'SERIES');

-- AlterTable
ALTER TABLE "TaxFormTemplateField" ADD COLUMN "kind" "TaxFieldKind" NOT NULL DEFAULT 'SINGLE';
