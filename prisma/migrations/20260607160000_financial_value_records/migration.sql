-- AlterTable: allow non-numeric financial values (dates, text, table records)
ALTER TABLE "CompanyFinancialValue" ALTER COLUMN "value" DROP NOT NULL;
ALTER TABLE "CompanyFinancialValue" ADD COLUMN "valueText" TEXT;
ALTER TABLE "CompanyFinancialValue" ADD COLUMN "valueJson" JSONB;
ALTER TABLE "CompanyFinancialValue" ADD COLUMN "kind" "TaxFieldKind" NOT NULL DEFAULT 'SINGLE';
