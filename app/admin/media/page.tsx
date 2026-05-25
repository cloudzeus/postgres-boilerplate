import { FiImage } from 'react-icons/fi';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { MediaBrowser } from '@/components/media/media-browser';

export default async function MediaPage() {
  await requirePermission('media.read');
  return (
    <div className="w-full">
      <PageHeader
        icon={<FiImage />}
        title="Media"
        description="Διαχείριση αρχείων και φακέλων. Εικόνες μετατρέπονται σε WebP (max 1920px). SVG διατηρούνται και ως WebP."
      />
      <MediaBrowser />
    </div>
  );
}
