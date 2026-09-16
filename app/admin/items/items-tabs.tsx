'use client';

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ItemsTableClient, type ItemRecord } from '@/components/admin/items-table-client';
import { ExpensesTableClient, type ExpenseRecord } from '@/components/admin/expenses-table-client';
import { LineItemsTableClient, type LineItemRecord } from '@/components/admin/lineitems-table-client';
import { LineCategoriesTableClient, type LineCategoryRecord } from '@/components/admin/line-categories-table-client';
import { MyDataClassesTableClient, type MyDataClassRecord } from '@/components/admin/mydata-classes-table-client';
import { AnalyticsTableClient, type AnalyticsRecord } from '@/components/admin/analytics-tables-client';

/**
 * Μητρώα SoftOne που τροφοδοτούν την αντιστοίχιση γραμμών: είδη (MTRL 51), υπηρεσίες (MTRL 52),
 * έξοδα (EXPN), ΧΡΕΟΠΙΣΤΩΣΕΙΣ (MTRL 53 — οι γραμμές «Ειδικών συναλλαγών») και οι κατηγορίες
 * δαπανών τους (MTRCATEGORY 53), μαζί με τις λίστες χαρακτηρισμού myDATA.
 * Κάθε tab έχει τον δικό του συγχρονισμό — όλοι μόνο ΑΝΑΓΝΩΣΗ από το SoftOne.
 */
export function ItemsTabs({
  products,
  services,
  expenses,
  lineItems,
  lineCategories,
  myDataClasses,
  costCenters,
  projects,
  projectStages,
  canManage,
  itemsLastSync,
  expensesLastSync,
  lineItemsLastSync,
  lineCategoriesLastSync,
  myDataClassesLastSync,
  costCentersLastSync,
  projectsLastSync,
  projectStagesLastSync,
}: {
  products: ItemRecord[];
  services: ItemRecord[];
  expenses: ExpenseRecord[];
  lineItems: LineItemRecord[];
  lineCategories: LineCategoryRecord[];
  myDataClasses: MyDataClassRecord[];
  costCenters: AnalyticsRecord[];
  projects: AnalyticsRecord[];
  projectStages: AnalyticsRecord[];
  canManage: boolean;
  itemsLastSync: string | null;
  expensesLastSync: string | null;
  lineItemsLastSync: string | null;
  lineCategoriesLastSync: string | null;
  myDataClassesLastSync: string | null;
  costCentersLastSync: string | null;
  projectsLastSync: string | null;
  projectStagesLastSync: string | null;
}) {
  const [tab, setTab] = React.useState('products');
  const count = (n: number) => n.toLocaleString('el-GR');

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList>
        <TabsTrigger value="products" className="cursor-pointer">Είδη ({count(products.length)})</TabsTrigger>
        <TabsTrigger value="services" className="cursor-pointer">Υπηρεσίες ({count(services.length)})</TabsTrigger>
        <TabsTrigger value="expenses" className="cursor-pointer">Έξοδα ({count(expenses.length)})</TabsTrigger>
        <TabsTrigger value="lineitems" className="cursor-pointer">Χρεοπιστώσεις ({count(lineItems.length)})</TabsTrigger>
        <TabsTrigger value="linecategories" className="cursor-pointer">Κατηγορίες δαπανών ({count(lineCategories.length)})</TabsTrigger>
        <TabsTrigger value="mydata" className="cursor-pointer">Χαρακτηρισμοί myDATA ({count(myDataClasses.length)})</TabsTrigger>
        <TabsTrigger value="costcenters" className="cursor-pointer">Κέντρα κόστους ({count(costCenters.length)})</TabsTrigger>
        <TabsTrigger value="projects" className="cursor-pointer">Έργα ({count(projects.length)})</TabsTrigger>
        <TabsTrigger value="projectstages" className="cursor-pointer">Δραστηριότητες ({count(projectStages.length)})</TabsTrigger>
      </TabsList>
      <TabsContent value="products">
        <ItemsTableClient rows={products} variant="products" canManage={canManage} lastSync={itemsLastSync} />
      </TabsContent>
      <TabsContent value="services">
        <ItemsTableClient rows={services} variant="services" canManage={canManage} lastSync={itemsLastSync} />
      </TabsContent>
      <TabsContent value="expenses">
        <ExpensesTableClient rows={expenses} canManage={canManage} lastSync={expensesLastSync} />
      </TabsContent>
      <TabsContent value="lineitems">
        <LineItemsTableClient rows={lineItems} canManage={canManage} lastSync={lineItemsLastSync} />
      </TabsContent>
      <TabsContent value="linecategories">
        <LineCategoriesTableClient rows={lineCategories} canManage={canManage} lastSync={lineCategoriesLastSync} />
      </TabsContent>
      <TabsContent value="mydata">
        <MyDataClassesTableClient rows={myDataClasses} canManage={canManage} lastSync={myDataClassesLastSync} />
      </TabsContent>
      <TabsContent value="costcenters">
        <AnalyticsTableClient
          rows={costCenters} canManage={canManage} lastSync={costCentersLastSync}
          endpoint="sync-costcenters-softone" title="Κέντρα κόστους" subHeader="Ιεραρχία / Λογ/σμός"
          hint="Μπαίνουν ανά γραμμή σε Είδη, Υπηρεσίες και Ειδικές συναλλαγές. Η «Ανάλυση εξόδων» δεν έχει κέντρο κόστους."
        />
      </TabsContent>
      <TabsContent value="projects">
        <AnalyticsTableClient
          rows={projects} canManage={canManage} lastSync={projectsLastSync}
          endpoint="sync-projects-softone" title="Έργα" subHeader="Συναλλασσόμενος"
          hint="Στην ουρά εμφανίζονται πρώτα τα έργα του εκδότη του παραστατικού· με ένα κλικ βλέπεις όλα."
        />
      </TabsContent>
      <TabsContent value="projectstages">
        <AnalyticsTableClient
          rows={projectStages} canManage={canManage} lastSync={projectStagesLastSync}
          endpoint="sync-projectstages-softone" title="Δραστηριότητες" subHeader="—"
          hint="Στη γραμμή παραστατικού λέγεται «Κατηγορία δραστηριότητας»."
        />
      </TabsContent>
    </Tabs>
  );
}
