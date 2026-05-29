import { FiMapPin } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { Card } from '@/components/ui/card';
import { RegionDecoder } from '@/components/regions/region-decoder';
import { RegionTree } from '@/components/regions/region-tree';

export const dynamic = 'force-dynamic';

export default async function RegionsPage() {
  await requirePermission('metadata.read');

  const [roots, total] = await Promise.all([
    prisma.region.findMany({
      where: { level: 3 },
      orderBy: { nameEL: 'asc' },
      select: {
        code: true, nameEL: true, level: true, parentCode: true, path: true,
        _count: { select: { children: true } },
      },
    }),
    prisma.region.count(),
  ]);

  const descendants = await Promise.all(
    roots.map((r) =>
      r.path ? prisma.region.count({ where: { path: { startsWith: `${r.path}>` } } }) : Promise.resolve(0),
    ),
  );

  const initialRoots = roots.map((r, i) => ({
    code: r.code,
    nameEL: r.nameEL,
    level: r.level,
    parentCode: r.parentCode,
    directChildren: r._count.children,
    descendants: descendants[i],
    hasChildren: r._count.children > 0,
  }));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<FiMapPin />}
        title="Μητρώο Περιφερειών"
        helpAnchor="perifereies"
        description={`Δενδροειδής δομή Καλλικράτη — Περιφέρεια › Περιφερειακή Ενότητα/Νομός › Δήμος (${total.toLocaleString('el-GR')} εγγραφές)`}
      />

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Αναζήτηση περιοχής</h2>
        <RegionDecoder />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Ιεραρχικό δέντρο</h2>
        <Card className="p-3">
          {initialRoots.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              Δεν υπάρχουν δεδομένα. Εκτελέστε:{' '}
              <code className="bg-muted px-2 py-0.5 rounded">npm run seed:regions</code>
            </div>
          ) : (
            <RegionTree initialRoots={initialRoots} />
          )}
        </Card>
      </section>
    </div>
  );
}
