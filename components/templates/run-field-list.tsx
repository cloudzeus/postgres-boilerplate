'use client';

// One row per template field of a run: colour dot, label, raw → value, source and page.
// The list is the run's readable face — the coloured boxes on the page image next to it are the
// same fields, keyed by `focusKey`.

import * as React from 'react';
import { FiChevronDown, FiChevronRight, FiEdit2 } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { SOURCE_LABEL } from '@/lib/templates/labels';
import type { FieldDef, FieldValue } from '@/lib/templates/schema';
import type { RunDto } from '@/lib/templates/run-dto';

const EMPTY = '—';

/** Greek-formatted display of a coerced value. Arrays report their size; the rows expand below. */
export function formatValue(v: FieldValue['value']): string {
  if (v == null || v === '') return EMPTY;
  if (typeof v === 'number') return v.toLocaleString('el-GR', { maximumFractionDigits: 4 });
  if (Array.isArray(v)) return `${v.length} γραμμ${v.length === 1 ? 'ή' : 'ές'}`;
  return String(v);
}

/**
 * Which fields a review message is about. The runner writes reasons as human text with the field's
 * LABEL in guillemets («…»), so that is what we match on — there is no key in the message.
 */
export function flaggedLabels(messages: string[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) for (const hit of m.matchAll(/«([^»]+)»/g)) out.add(hit[1]);
  return out;
}

function TableRows({ field, rows }: { field: FieldDef; rows: unknown[] }) {
  const cols = field.columns?.length ? field.columns : null;
  if (!cols) {
    return (
      <ul className="mt-1 space-y-0.5 rounded border border-border bg-muted/30 p-2 text-[11px]">
        {rows.map((r, i) => <li key={i} className="truncate font-mono">{typeof r === 'object' ? JSON.stringify(r) : String(r)}</li>)}
      </ul>
    );
  }
  return (
    <div className="mt-1 max-h-56 overflow-auto rounded border border-border">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>{cols.map((c) => <th key={c.key} className="px-2 py-1 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {cols.map((c) => {
                const cell = (r as Record<string, unknown>)?.[c.key];
                return <td key={c.key} className="px-2 py-1 align-top">{cell == null || cell === '' ? EMPTY : String(cell)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = {
  run: RunDto;
  focusKey: string | null;
  onFocus: (key: string | null) => void;
  editable: boolean;
  onEdit: (key: string, value: string) => void;
};

export function RunFieldList({ run, focusKey, onFocus, editable, onEdit }: Props) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const flagged = React.useMemo(() => flaggedLabels(run.flags.review), [run.flags.review]);

  const commit = React.useCallback((key: string) => {
    setEditing(null);
    onEdit(key, draft);
  }, [draft, onEdit]);

  if (run.template.fields.length === 0) {
    return <p className="rounded-lg border border-border bg-card p-3 text-[12px] text-muted-foreground">Το πρότυπο δεν έχει πεδία.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {run.template.fields.map((f) => {
        const v: FieldValue | undefined = run.values[f.key];
        const rows = Array.isArray(v?.value) ? (v!.value as unknown[]) : null;
        const isOpen = !!open[f.key];
        const isFocused = focusKey === f.key;
        const isFlagged = flagged.has(f.label);
        return (
          <li
            key={f.key}
            onMouseEnter={() => onFocus(f.key)}
            onClick={() => onFocus(isFocused ? null : f.key)}
            className={`cursor-pointer px-3 py-2 transition-colors ${isFocused ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
            style={isFlagged ? { borderLeft: '3px solid #B45309' } : { borderLeft: '3px solid transparent' }}
          >
            <div className="flex items-start gap-2">
              <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: v?.color ?? f.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[12px] font-medium">{f.label}</span>
                  {f.required && <span className="text-[10px] text-muted-foreground">υποχρεωτικό</span>}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{SOURCE_LABEL[v?.source ?? 'none']}</span>
                  {v?.page != null && <span className="text-[10px] text-muted-foreground">σ.{v.page + 1}</span>}
                </div>

                {editing === f.key ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commit(f.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commit(f.key); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                    }}
                    className="mt-1 h-7 text-[12px]"
                  />
                ) : (
                  <div className="mt-0.5 flex items-start gap-1.5">
                    <span className="min-w-0 flex-1 break-words text-[12px]">{formatValue(v?.value ?? null)}</span>
                    {editable && f.kind === 'SINGLE' && (
                      <button
                        type="button"
                        aria-label={`Διόρθωση «${f.label}»`}
                        onClick={(e) => { e.stopPropagation(); setDraft(v?.raw ?? (v?.value == null ? '' : String(v.value))); setEditing(f.key); }}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <FiEdit2 className="size-3" />
                      </button>
                    )}
                  </div>
                )}

                {v?.raw != null && v.raw !== '' && String(v.value ?? '') !== v.raw && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={v.raw}>raw: {v.raw}</p>
                )}

                {rows && rows.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [f.key]: !o[f.key] })); }}
                      className="mt-1 inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <FiChevronDown className="size-3" /> : <FiChevronRight className="size-3" />}
                      {isOpen ? 'Απόκρυψη γραμμών' : 'Εμφάνιση γραμμών'}
                    </button>
                    {isOpen && <div onClick={(e) => e.stopPropagation()}><TableRows field={f} rows={rows} /></div>}
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
