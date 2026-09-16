import { FiBox } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { getSetting } from '@/lib/settings';
import { PageHeader } from '@/components/admin/page-header';
import { classificationLabeller } from '@/lib/ocr/mydata-labels';
import { ItemsTabs } from './items-tabs';

export const dynamic = 'force-dynamic';

export default async function ItemsPage() {
  await requirePermission('metadata.read');
  const [
    items, expenses, lineItems, lineCategories, classTypes, classCategories,
    costCenters, projects, projectStages,
    canManage, itemsLastSync, expensesLastSync, lineItemsLastSync, lineCategoriesLastSync, myDataClassesLastSync,
    costCentersLastSync, projectsLastSync, projectStagesLastSync,
  ] = await Promise.all([
    prisma.softoneItem.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneExpense.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneLineItem.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneLineCategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneMyDataClassType.findMany({ orderBy: [{ sotype: 'asc' }, { code: 'asc' }] }),
    prisma.softoneMyDataClassCategory.findMany({ orderBy: [{ sotype: 'asc' }, { code: 'asc' }] }),
    prisma.softoneCostCenter.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneProject.findMany({ orderBy: { name: 'asc' } }),
    prisma.softoneProjectStage.findMany({ orderBy: { name: 'asc' } }),
    hasPermission('metadata.manage'),
    getSetting<string>('integrations.softoneItemsLastSync'),
    getSetting<string>('integrations.softoneExpensesLastSync'),
    getSetting<string>('integrations.softoneLineItemsLastSync'),
    getSetting<string>('integrations.softoneLineCategoriesLastSync'),
    getSetting<string>('integrations.softoneMyDataClassesLastSync'),
    getSetting<string>('integrations.softoneCostCentersLastSync'),
    getSetting<string>('integrations.softoneProjectsLastSync'),
    getSetting<string>('integrations.softoneProjectStagesLastSync'),
  ]);
  const products = items.filter((i) => !i.isService);
  const services = items.filter((i) => i.isService);

  // Ο χαρακτηρισμός myDATA μεταφράζεται ΕΔΩ (server): οι λίστες είναι μικρές και το UI δείχνει
  // ελληνικά, όχι κωδικούς. Είναι ιδιότητα του μητρώου — η εφαρμογή δεν τον γράφει ποτέ.
  const label = await classificationLabeller();
  const categoryName = new Map(lineCategories.map((c) => [c.mtrCategory, c.name || c.code]));
  const lineItemsPerCategory = new Map<number, number>();
  for (const l of lineItems) {
    if (l.mtrCategory == null) continue;
    lineItemsPerCategory.set(l.mtrCategory, (lineItemsPerCategory.get(l.mtrCategory) ?? 0) + 1);
  }

  return (
    <div className="w-full">
      <PageHeader
        icon={<FiBox />}
        title="Είδη"
        description={`Μητρώα SoftOne: ${products.length.toLocaleString('el-GR')} είδη, ${services.length.toLocaleString('el-GR')} υπηρεσίες, ${expenses.length.toLocaleString('el-GR')} έξοδα, ${lineItems.length.toLocaleString('el-GR')} χρεοπιστώσεις.`}
        helpAnchor="items"
      />
      <ItemsTabs
        products={products}
        services={services}
        expenses={expenses.map((e) => ({ expn: e.expn, code: e.code, name: e.name, vat: e.vat, isActive: e.isActive }))}
        lineItems={lineItems.map((l) => ({
          mtrl: l.mtrl, code: l.code, name: l.name, vat: l.vat,
          category: l.mtrCategory != null ? categoryName.get(l.mtrCategory) ?? null : null,
          myData: label({ classType: l.classType, classCategory: l.classCategory, myDataCode: l.myDataCode }).label,
          isActive: l.isActive,
        }))}
        lineCategories={lineCategories.map((c) => ({
          mtrCategory: c.mtrCategory, code: c.code, name: c.name, vat: c.vat, acnmsk: c.acnmsk,
          sodtypeFiltered: c.sodtypeFiltered,
          lineItems: lineItemsPerCategory.get(c.mtrCategory) ?? 0,
          isActive: c.isActive,
        }))}
        myDataClasses={[
          ...classTypes.map((t) => ({ kind: 'type' as const, sotype: t.sotype, code: t.code, myDataCode: t.myDataCode, name: t.name })),
          ...classCategories.map((c) => ({ kind: 'category' as const, sotype: c.sotype, code: c.code, myDataCode: c.myDataCode, name: c.name })),
        ]}
        costCenters={costCenters.map((c) => ({
          id: c.costcntr, code: c.code, name: c.name,
          sub: [c.sohCode, c.acnmsk].filter(Boolean).join(' · ') || null,
        }))}
        projects={projects.map((c) => ({
          id: c.prjc, code: c.code, name: c.name, sub: c.trdr ? `TRDR ${c.trdr}` : null,
        }))}
        projectStages={projectStages.map((c) => ({ id: c.prjcStage, code: c.code, name: c.name, sub: null }))}
        canManage={canManage}
        itemsLastSync={itemsLastSync ?? null}
        expensesLastSync={expensesLastSync ?? null}
        lineItemsLastSync={lineItemsLastSync ?? null}
        lineCategoriesLastSync={lineCategoriesLastSync ?? null}
        myDataClassesLastSync={myDataClassesLastSync ?? null}
        costCentersLastSync={costCentersLastSync ?? null}
        projectsLastSync={projectsLastSync ?? null}
        projectStagesLastSync={projectStagesLastSync ?? null}
      />
    </div>
  );
}
