import { FiPlayCircle } from 'react-icons/fi';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { listJobs } from '@/lib/templates/jobs';
import { PageHeader } from '@/components/admin/page-header';
import { JobsClient } from './jobs-client';

export const dynamic = 'force-dynamic';

// Εργασίες μαζικής σάρωσης (spec §12). Η πρώτη σελίδα έρχεται από τον server· από κει και πέρα ο
// πελάτης ανανεώνει μόνος του όσο κάτι τρέχει — μια εργασία που προχωρά πρέπει να φαίνεται να προχωρά.
export default async function TemplateJobsPage() {
  await requirePermission('ocr.read');
  const [jobs, canManage] = await Promise.all([listJobs({}), hasPermission('ocr.categorize')]);

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiPlayCircle />}
        title="Εργασίες σάρωσης"
        description={`Μαζική ανάγνωση αρχείων με ένα πρότυπο (${jobs.length} εργασίες).`}
        helpAnchor="template-jobs"
      />
      <JobsClient initial={jobs} canManage={canManage} />
    </div>
  );
}
