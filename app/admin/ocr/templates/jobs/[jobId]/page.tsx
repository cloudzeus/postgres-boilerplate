import { notFound } from 'next/navigation';
import { FiPlayCircle } from 'react-icons/fi';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getJob } from '@/lib/templates/jobs';
import { PageHeader } from '@/components/admin/page-header';
import { JobDetailClient } from './job-detail-client';

export const dynamic = 'force-dynamic';

// Μία εργασία σάρωσης: η κεφαλίδα με ό,τι δήλωσε ο χρήστης, και ο πίνακας αρχεία × πεδία.
export default async function TemplateJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  await requirePermission('ocr.read');
  const { jobId } = await params;
  const [job, canManage] = await Promise.all([getJob(jobId), hasPermission('ocr.categorize')]);
  if (!job) notFound();
  // Η κεφαλίδα μένει στον server: το `PageHeader` σέρνει μαζί του το εικονίδιο βοήθειας, που διαβάζει
  // ρόλους — δηλαδή Prisma. Σε client component θα έσερνε τον `pg` οδηγό μέχρι τον browser.
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiPlayCircle />}
        title={job.title}
        description={`${job.templateName} · ${new Date(job.date).toLocaleDateString('el-GR')}${job.reference ? ` · ${job.reference}` : ''}`}
        helpAnchor="template-jobs"
      />
      <JobDetailClient initial={job} canManage={canManage} />
    </div>
  );
}
