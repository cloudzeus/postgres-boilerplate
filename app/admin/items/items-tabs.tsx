'use client';

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ItemsTableClient, type ItemRecord } from '@/components/admin/items-table-client';
import { ExpensesTableClient, type ExpenseRecord } from '@/components/admin/expenses-table-client';

/**
 * Μητρώα SoftOne που τροφοδοτούν την αντιστοίχιση γραμμών: είδη (MTRL 51),
 * υπηρεσίες (MTRL 52) και έξοδα (EXPN). Κάθε tab έχει τον δικό του συγχρονισμό.
 */
export function ItemsTabs({
  products,
  services,
  expenses,
  canManage,
  itemsLastSync,
  expensesLastSync,
}: {
  products: ItemRecord[];
  services: ItemRecord[];
  expenses: ExpenseRecord[];
  canManage: boolean;
  itemsLastSync: string | null;
  expensesLastSync: string | null;
}) {
  const [tab, setTab] = React.useState('products');
  const count = (n: number) => n.toLocaleString('el-GR');

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList>
        <TabsTrigger value="products" className="cursor-pointer">Είδη ({count(products.length)})</TabsTrigger>
        <TabsTrigger value="services" className="cursor-pointer">Υπηρεσίες ({count(services.length)})</TabsTrigger>
        <TabsTrigger value="expenses" className="cursor-pointer">Έξοδα ({count(expenses.length)})</TabsTrigger>
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
    </Tabs>
  );
}
