import { FiUpload } from 'react-icons/fi';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { ExcelImportWizard } from '@/components/imports/excel-import-wizard';

export const dynamic = 'force-dynamic';

export default async function ImportsPage() {
  await requirePermission('imports.read');
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiUpload />}
        title="Excel Imports"
        description="Μαζική εισαγωγή δεδομένων από Excel. Επίλεξε αρχείο, κεφαλίδες/δεδομένα, καθάρισμα, οντότητα και mapping."
      />
      <ExcelImportWizard />
    </div>
  );
}
