'use server';

import * as React from 'react';
import { FiFileText } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { TaxTemplateNewButton } from './new-button';

export const dynamic = 'force-dynamic';

export default async function TaxTemplatesPage() {
  await requirePermission('programs.read');

  const templates = await prisma.taxFormTemplate.findMany({
    orderBy: [{ code: 'asc' }, { year: 'desc' }],
    include: { _count: { select: { fields: true } } },
  });

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Πρότυπα Φορολογικών Εντύπων"
        description="Ορισμός πεδίων φορολογικών εντύπων (Ε1, Ε3, κ.λπ.) με χαρτογράφηση περιοχών OCR."
        icon={<FiFileText />}
        helpAnchor="tax-templates"
        actions={<TaxTemplateNewButton />}
      />

      <div className="rounded-lg border border-border bg-card shadow-fluent-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Κωδικός</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Όνομα</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Έτος</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Πεδία</th>
              <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Κατάσταση</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Δεν υπάρχουν πρότυπα. Δημιουργήστε το πρώτο.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="group border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                <td className="px-4 py-2.5">
                  <a href={`/admin/tax-templates/${t.id}`} className="font-semibold text-sisyphus-600 hover:underline">
                    {t.code}
                  </a>
                </td>
                <td className="px-4 py-2.5 text-foreground">{t.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.year ?? '—'}</td>
                <td className="px-4 py-2.5 tabular-nums">{t._count.fields}</td>
                <td className="px-4 py-2.5">
                  {t.status === 'READY' ? (
                    <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">READY</Badge>
                  ) : (
                    <Badge variant="outline" className="border-border bg-muted text-muted-foreground text-[10px]">DRAFT</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
