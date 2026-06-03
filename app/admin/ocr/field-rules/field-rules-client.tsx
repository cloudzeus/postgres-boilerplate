'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';

export type FieldRuleRow = {
  id: string; vatNumber: string; supplierName: string | null;
  docType: 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT';
  label: string; description: string | null; isActive: boolean; timesUsed: number;
  scope: string; valueType: string;
};

const DOC_LABEL: Record<string, string> = { INVOICE: 'Τιμολόγιο', RECEIPT: 'Απόδειξη', GENERAL_TEXT: '—' };
const SCOPE_LABEL: Record<string, string> = { document: 'Έγγραφο', line: 'Γραμμή' };
const VALUE_LABEL: Record<string, string> = { text: 'Μία τιμή', list: 'Λίστα' };

export function FieldRulesClient({ rows, canManage }: { rows: FieldRuleRow[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<FieldRuleRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/ocr/field-rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε'); setEditing(null); router.refresh();
    } catch (e) { toast.error(`Σφάλμα: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusyId(null); }
  }
  async function remove(id: string) {
    if (!confirm('Διαγραφή κανόνα;')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/ocr/field-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Διαγράφηκε'); router.refresh();
    } catch (e) { toast.error(`Σφάλμα: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusyId(null); }
  }

  if (rows.length === 0) {
    return <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Δεν υπάρχουν κανόνες ακόμη. Δημιούργησε έναν από τις ενέργειες ενός σκαναρισμένου παραστατικού.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Προμηθευτής</th>
            <th className="px-3 py-2">Τύπος</th>
            <th className="px-3 py-2">Εμβέλεια</th>
            <th className="px-3 py-2">Τιμή</th>
            <th className="px-3 py-2">Πεδίο</th>
            <th className="px-3 py-2">Οδηγία</th>
            <th className="px-3 py-2 text-right">Χρήσεις</th>
            <th className="px-3 py-2 text-center">Ενεργό</th>
            {canManage && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">{r.supplierName ?? '—'}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{r.vatNumber}</div>
              </td>
              <td className="px-3 py-2">{DOC_LABEL[r.docType]}</td>
              <td className="px-3 py-2">{SCOPE_LABEL[r.scope] ?? r.scope}</td>
              <td className="px-3 py-2">{VALUE_LABEL[r.valueType] ?? r.valueType}</td>
              <td className="px-3 py-2 font-semibold">
                {editing?.id === r.id
                  ? <input className="w-full rounded border border-input bg-background px-2 py-1 text-[12px]" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                  : r.label}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {editing?.id === r.id
                  ? <input className="w-full rounded border border-input bg-background px-2 py-1 text-[12px]" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                  : (r.description ?? '—')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.timesUsed}</td>
              <td className="px-3 py-2 text-center">
                <button type="button" disabled={!canManage || busyId === r.id}
                  onClick={() => patch(r.id, { isActive: !r.isActive })}
                  className={r.isActive ? 'text-emerald-600' : 'text-muted-foreground'} title={r.isActive ? 'Ενεργό' : 'Ανενεργό'}>
                  {r.isActive ? <FiCheck /> : <FiX />}
                </button>
              </td>
              {canManage && (
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {editing?.id === r.id ? (
                      <>
                        <button type="button" disabled={busyId === r.id} onClick={() => patch(r.id, { label: editing.label.trim(), description: (editing.description ?? '').trim() || null })}
                          className="rounded-md px-2 py-1 text-[12px] font-semibold text-emerald-600 hover:bg-emerald-500/10">Αποθήκευση</button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted">Άκυρο</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditing(r)} title="Επεξεργασία"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><FiEdit2 className="size-3.5" /></button>
                        <button type="button" disabled={busyId === r.id} onClick={() => remove(r.id)} title="Διαγραφή"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-500"><FiTrash2 className="size-3.5" /></button>
                      </>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
