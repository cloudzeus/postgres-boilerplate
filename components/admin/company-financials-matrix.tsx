'use client';

import * as React from 'react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyFinancialValue {
  id: string;
  fieldKey: string;
  templateId: string | null;
  year: number;
  value: string;
  valueType: 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN' | string;
  source: 'OCR' | 'MANUAL' | 'API' | string;
  verified: boolean;
}

function formatValue(raw: string, valueType: string): string {
  const num = parseFloat(raw);
  if (isNaN(num)) return raw || '—';
  if (valueType === 'CURRENCY') {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(num);
  }
  if (valueType === 'NUMBER') {
    return new Intl.NumberFormat('el-GR').format(num);
  }
  if (valueType === 'PERCENT') {
    return `${new Intl.NumberFormat('el-GR', { maximumFractionDigits: 2 }).format(num)}%`;
  }
  if (valueType === 'INTEGER') {
    return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 }).format(num);
  }
  if (valueType === 'BOOLEAN') {
    return num !== 0 ? 'Ναι' : 'Όχι';
  }
  if (valueType === 'DATE') {
    const d = new Date(num);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('el-GR');
  }
  return raw;
}

function sourceBadge(source: string, verified: boolean): string {
  if (verified) return '🟢';
  if (source === 'OCR') return '🟡';
  return '✋';
}

function sourceTip(source: string, verified: boolean): string {
  if (verified) return 'Επαληθευμένο';
  if (source === 'OCR') return 'OCR (μη επαληθευμένο)';
  return 'Χειροκίνητη καταχώριση';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CompanyFinancialsMatrix({ companyId, refreshKey }: { companyId: string; refreshKey?: number }) {
  const [data, setData] = React.useState<CompanyFinancialValue[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Editing state
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const cancelledRef = React.useRef(false);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/companies/${companyId}/financials`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: CompanyFinancialValue[]) => {
        setData(rows);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [companyId]);

  React.useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Pivot: rows = distinct fieldKey (sorted), cols = distinct year (desc)
  const years = React.useMemo(
    () => [...new Set(data.map((d) => d.year))].sort((a, b) => b - a),
    [data],
  );

  const fieldKeys = React.useMemo(
    () => [...new Set(data.map((d) => d.fieldKey))].sort(),
    [data],
  );

  // Map for O(1) lookup: `${fieldKey}::${year}` → value row
  const cellMap = React.useMemo(() => {
    const m = new Map<string, CompanyFinancialValue>();
    for (const row of data) {
      m.set(`${row.fieldKey}::${row.year}`, row);
    }
    return m;
  }, [data]);

  // Inline edit handlers
  function startEdit(row: CompanyFinancialValue) {
    if (!row.templateId) return; // read-only if no templateId
    setEditingId(row.id);
    setEditValue(row.value ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function commitEdit(row: CompanyFinancialValue) {
    if (!row.templateId) return;
    setSaving(true);
    try {
      // fieldKey is "{code}.{bareKey}" — strip the leading "{code}." prefix.
      // Use split so template codes containing dots are handled correctly.
      const parts = row.fieldKey.split('.');
      const bareKey = parts.length > 1 ? parts.slice(1).join('.') : row.fieldKey;

      const res = await fetch(`/api/admin/companies/${companyId}/financials/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: row.templateId,
          year: row.year,
          sourceDocumentId: null,
          reviewed: {
            [bareKey]: { raw: editValue, edited: true },
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε');
      setEditingId(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="size-6 animate-spin rounded-full border-4 border-border border-t-sisyphus-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-dg-red-500/40 bg-dg-red-500/10 p-3 text-[12px] text-dg-red-700 dark:text-dg-red-400">
        Σφάλμα φόρτωσης: {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] text-muted-foreground">
        Δεν υπάρχουν οικονομικά στοιχεία ακόμη.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-[11px]">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Πεδίο</th>
            {years.map((y) => (
              <th key={y} className="px-3 py-2 text-right font-semibold text-muted-foreground tabular-nums">
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {fieldKeys.map((fk) => {
            // Derive a display label from the bare key part.
            // Split on first dot only so template codes with dots are handled correctly.
            const fkParts = fk.split('.');
            const label = fkParts.length > 1 ? fkParts.slice(1).join('.') : fk;
            const prefix = fkParts.length > 1 ? fkParts[0] : '';

            return (
              <tr key={fk} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 text-foreground">
                  <span className="font-medium">{label}</span>
                  {prefix && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{prefix}</span>
                  )}
                </td>
                {years.map((y) => {
                  const cell = cellMap.get(`${fk}::${y}`);
                  if (!cell) {
                    return (
                      <td key={y} className="px-3 py-1.5 text-right text-muted-foreground">
                        —
                      </td>
                    );
                  }

                  const isEditing = editingId === cell.id;
                  const canEdit = !!cell.templateId;

                  return (
                    <td
                      key={y}
                      className={`px-3 py-1.5 text-right tabular-nums ${canEdit ? 'cursor-pointer hover:bg-muted/60' : ''}`}
                      onClick={() => {
                        if (!isEditing && canEdit) startEdit(cell);
                      }}
                      title={canEdit ? 'Κλικ για επεξεργασία' : 'Μόνο ανάγνωση'}
                    >
                      {isEditing ? (
                        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                cancelledRef.current = false;
                                commitEdit(cell);
                              }
                              if (e.key === 'Escape') {
                                cancelledRef.current = true;
                                cancelEdit();
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={() => {
                              if (cancelledRef.current) {
                                cancelledRef.current = false;
                                return;
                              }
                              commitEdit(cell);
                            }}
                            disabled={saving}
                            className="h-6 w-24 rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
                          />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1">
                          <span>{formatValue(cell.value, cell.valueType)}</span>
                          <span
                            title={sourceTip(cell.source, cell.verified)}
                            className="text-[10px]"
                          >
                            {sourceBadge(cell.source, cell.verified)}
                          </span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
