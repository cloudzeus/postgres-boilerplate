import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/admin/page-header';
import { OutboxTable } from './outbox-table';

export const dynamic = 'force-dynamic';

/**
 * Η ΟΥΡΑ ΕΡΓΑΣΙΩΝ ΠΡΟΣ ΤΟ SOFTONE.
 *
 * Υπάρχει ώστε «η σύνδεση έπεσε» να μην σημαίνει πια «έχασες τη δουλειά σου»: ό,τι δεν μπόρεσε
 * να φύγει φαίνεται εδώ ονομαστικά, με το τι του συνέβη και τι μπορεί να γίνει.
 */
export default async function SoftoneOutboxPage() {
  await requirePermission('metadata.manage');
  const items = await prisma.softoneOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, kind: true, label: true, status: true, attempts: true,
      lastError: true, createdAt: true, sentAt: true, tenantKey: true,
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Ουρά SoftOne"
        description="Εργασίες που δεν μπόρεσαν να φύγουν — και τι περιμένει η καθεμία."
      />
      <OutboxTable initial={items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), sentAt: i.sentAt?.toISOString() ?? null }))} />
    </div>
  );
}
