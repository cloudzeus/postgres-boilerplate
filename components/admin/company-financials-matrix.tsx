'use client';

import * as React from 'react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN' | string;

interface CompanyFinancialValue {
  id: string;
  fieldKey: string;
  templateId: string | null;
  year: number;
  kind: 'SINGLE' | 'SERIES' | 'TABLE';
  valueType: ValueType;
  value: string | null;
  valueText: string | null;
  valueJson: Record<string, string>[] | null;
  source: 'OCR' | 'MANUAL' | string;
  verified: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(raw: string | null, valueType: ValueType): string {
  if (raw == null || raw === '') return '—';
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
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
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toLocaleDateString('el-GR');
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

function displayValue(cell: CompanyFinancialValue): string {
  if (cell.kind === 'TABLE') return ''; // handled separately
  if (cell.value != null) return formatValue(cell.value, cell.valueType);
  if (cell.valueText != null) return cell.valueText;
  return '—';
}

function getBareKey(fieldKey: string): string {
  const parts = fieldKey.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : fieldKey;
}

// ─── TableExpandCell ──────────────────────────────────────────────────────────

function TableExpandCell({ cell }: { cell: CompanyFinancialValue }) {
  const [open, setOpen] = React.useState(false);
  const records = cell.valueJson ?? [];
  const cols = records.length > 0 ? Object.keys(records[0]) : [];

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted/80"
      >
        πίνακας ({records.length})
        <span className="text-[9px] text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>
      <span title={sourceTip(cell.source, cell.verified)} className="text-[10px]">
        {sourceBadge(cell.source, cell.verified)}
      </span>
      {open && records.length > 0 && (
        <div className="mt-1 max-h-48 w-max max-w-[360px] overflow-auto rounded border border-border bg-background shadow-sm">
          <table className="text-[10px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-1 whitespace-nowrap">
                      {r[c] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CompanyFinancialsMatrix({
  companyId,
  refreshKey,
}: {
  companyId: string;
  refreshKey?: number;
}) {
  const [data, setData] = React.useState<CompanyFinancialValue[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Inline edit state — only for SINGLE kind
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

  // Inline edit — only SINGLE cells
  function canInlineEdit(cell: CompanyFinancialValue): boolean {
    // SERIES: inline edit would silently drop other years — make read-only
    // TABLE: not applicable
    return cell.kind === 'SINGLE' && !!cell.templateId;
  }

  function startEdit(cell: CompanyFinancialValue) {
    if (!canInlineEdit(cell)) return;
    setEditingId(cell.id);
    setEditValue(cell.value ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function commitEdit(cell: CompanyFinancialValue) {
    if (!cell.templateId) return;
    setSaving(true);
    try {
      const bareKey = getBareKey(cell.fieldKey);
      const res = await fetch(`/api/admin/companies/${companyId}/financials/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: cell.templateId,
          fiscalYear: cell.year,
          sourceDocumentId: null,
          fields: [
            {
              kind: 'SINGLE' as const,
              fieldKey: bareKey,
              valueType: cell.valueType,
              raw: editValue === '' ? null : editValue,
              edited: true,
            },
          ],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`);
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
              <th
                key={y}
                className="px-3 py-2 text-right font-semibold text-muted-foreground tabular-nums"
              >
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {fieldKeys.map((fk) => {
            const label = getBareKey(fk);
            const prefix = fk.includes('.') ? fk.split('.')[0] : '';

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

                  // TABLE: show expand widget (read-only)
                  if (cell.kind === 'TABLE') {
                    return (
                      <td key={y} className="px-3 py-1.5 text-right">
                        <TableExpandCell cell={cell} />
                      </td>
                    );
                  }

                  // SERIES: show formatted value with a note (read-only inline edit)
                  if (cell.kind === 'SERIES') {
                    return (
                      <td
                        key={y}
                        className="px-3 py-1.5 text-right tabular-nums"
                        title="Σειρές ετών — επεξεργασία μόνο μέσω εισαγωγής"
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          <span className="text-muted-foreground/60 text-[9px] mr-0.5">≡</span>
                          <span>{displayValue(cell)}</span>
                          <span title={sourceTip(cell.source, cell.verified)} className="text-[10px]">
                            {sourceBadge(cell.source, cell.verified)}
                          </span>
                        </span>
                      </td>
                    );
                  }

                  // SINGLE: inline-editable
                  const isEditing = editingId === cell.id;
                  const editable = canInlineEdit(cell);

                  return (
                    <td
                      key={y}
                      className={`px-3 py-1.5 text-right tabular-nums ${editable ? 'cursor-pointer hover:bg-muted/60' : ''}`}
                      onClick={() => {
                        if (!isEditing && editable) startEdit(cell);
                      }}
                      title={editable ? 'Κλικ για επεξεργασία' : 'Μόνο ανάγνωση'}
                    >
                      {isEditing ? (
                        <span
                          className="inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                cancelledRef.current = false;
                                void commitEdit(cell);
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
                              void commitEdit(cell);
                            }}
                            disabled={saving}
                            className="h-6 w-24 rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
                          />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1">
                          <span>{displayValue(cell)}</span>
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
