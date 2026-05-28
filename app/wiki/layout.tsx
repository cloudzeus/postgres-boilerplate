import Link from 'next/link';
import { FiBookOpen, FiArrowLeft } from 'react-icons/fi';
import { requireUser } from '@/lib/rbac';
import { getModulesTree } from '@/lib/wiki/loader';
import { filterPagesForRole } from '@/lib/wiki/access';
import type { WikiRoleKey } from '@/lib/wiki/types';
import { WikiSidebar } from '@/components/wiki/wiki-sidebar';

export const metadata = { title: 'Οδηγός Χρήστη · DGEspa' };

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const roleKey = (user.role.key as WikiRoleKey | null) ?? null;

  const modules = getModulesTree()
    .map((m) => ({ ...m, pages: filterPagesForRole(m.pages, roleKey) }))
    .filter((m) => m.pages.length > 0);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <Link href="/admin" className="-m-1.5 flex items-center gap-2 rounded-md p-1.5 text-[12px] text-muted-foreground hover:text-foreground">
            <FiArrowLeft className="size-3.5" />
            Επιστροφή
          </Link>
          <span className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <FiBookOpen className="size-3" /> Wiki
          </span>
        </div>
        <div className="border-b border-sidebar-border px-4 py-2.5">
          <p className="cx-eyebrow">Οδηγός Χρήστη</p>
          <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{user.role.name}</p>
        </div>
        <WikiSidebar modules={modules} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-3xl flex-1 p-4 lg:p-8 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
