import { FiTag } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { Card } from '@/components/ui/card';
import { KadDecoder } from '@/components/kad/kad-decoder';
import { KadTree } from '@/components/kad/kad-tree';

export const dynamic = 'force-dynamic';

export default async function KadCodesPage() {
  await requirePermission('kad.read');

  const [roots, total, lastImport] = await Promise.all([
    prisma.kadCode.findMany({
      where: { level: 1 },
      orderBy: { code: 'asc' },
      select: {
        code: true, title: true, description: true,
        level: true, sector: true, parentCode: true, path: true,
        _count: { select: { children: true } },
      },
    }),
    prisma.kadCode.count(),
    prisma.kadImportLog.findFirst({ orderBy: { importedAt: 'desc' } }).catch(() => null),
  ]);

  const descendants = await Promise.all(
    roots.map((r) =>
      r.path
        ? prisma.kadCode.count({ where: { path: { startsWith: `${r.path}>` } } })
        : Promise.resolve(0),
    ),
  );

  const initialRoots = roots.map((r, i) => ({
    code: r.code,
    title: r.title ?? r.description,
    level: r.level,
    sector: r.sector,
    parentCode: r.parentCode,
    directChildren: r._count.children,
    descendants: descendants[i],
    hasChildren: r._count.children > 0,
  }));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<FiTag />}
        title="Μητρώο ΚΑΔ"
        description={
          `Ιεραρχικός κατάλογος ΚΑΔ (${total.toLocaleString('el-GR')} κωδικοί` +
          (lastImport ? `, ενημέρωση ${lastImport.importedAt.toLocaleDateString('el-GR')} v${lastImport.sourceVersion}` : '') +
          ')'
        }
      />

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Αποκωδικοποίηση ΚΑΔ</h2>
        <KadDecoder />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Ιεραρχικό δέντρο</h2>
        <Card className="p-3">
          {initialRoots.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              Δεν υπάρχουν δεδομένα. Εκτελέστε το seed:{' '}
              <code className="bg-muted px-2 py-0.5 rounded">npx tsx prisma/seeds/kad2026.ts</code>
            </div>
          ) : (
            <KadTree initialRoots={initialRoots} />
          )}
        </Card>
      </section>
    </div>
  );
}
