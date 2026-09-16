'use client';

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ItemsTableClient, type ItemRecord } from '@/components/admin/items-table-client';
import { ExpensesTableClient, type ExpenseRecord } from '@/components/admin/expenses-table-client';
import { LineItemsTableClient, type LineItemRecord } from '@/components/admin/lineitems-table-client';
import { LineCategoriesTableClient, type LineCategoryRecord } from '@/components/admin/line-categories-table-client';
import { MyDataClassesTableClient, type MyDataClassRecord } from '@/components/admin/mydata-classes-table-client';

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
  canManage,
  itemsLastSync,
  expensesLastSync,
  lineItemsLastSync,
  lineCategoriesLastSync,
  myDataClassesLastSync,
}: {
  products: ItemRecord[];
  services: ItemRecord[];
  expenses: ExpenseRecord[];
  lineItems: LineItemRecord[];
  lineCategories: LineCategoryRecord[];
  myDataClasses: MyDataClassRecord[];
  canManage: boolean;
  itemsLastSync: string | null;
  expensesLastSync: string | null;
  lineItemsLastSync: string | null;
  lineCategoriesLastSync: string | null;
  myDataClassesLastSync: string | null;
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
    </Tabs>
  );
}
