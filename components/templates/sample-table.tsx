'use client';

// Ο πίνακας «δείγμα × πεδίο» της εκπαίδευσης (spec §11).
//
// Κάθε γραμμή είναι ένα αρχείο, κάθε στήλη ένα πεδίο, και κάθε κελί δείχνει ΤΙ ΔΙΑΒΑΣΕ το πρότυπο —
// στο χρώμα του πεδίου, όπως παντού αλλού στην εφαρμογή. Ο χρήστης διορθώνει ό,τι είναι λάθος και
// πατά «Επιβεβαίωση»: τα υπόλοιπα πεδία μπαίνουν ως σωστά αυτόματα, οπότε μια σωστή ανάγνωση
// επιβεβαιώνεται με ένα κλικ.
//
// Με 50 δείγματα × 12 πεδία ο πίνακας δεν χωράει πουθενά: η κεφαλίδα και η πρώτη στήλη μένουν
// κολλημένες και η οριζόντια κύλιση γίνεται ΜΕΣΑ στην κάρτα, ποτέ σε ολόκληρη τη σελίδα.

import * as React from 'react';
import { FiCheck, FiEye, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatValue } from '@/lib/templates/run-view';
import { agrees, autoValue, pctText, SCORE_STYLE, scoreTone } from '@/lib/templates/training-view';
import type { FieldScore } from '@/lib/templates/training';
import type { SampleDto } from '@/lib/templates/samples';
import type { FieldDef, FieldValue } from '@/lib/templates/schema';

const EMPTY = '—';

/** Κολλημένη πρώτη στήλη: το φόντο ΠΡΕΠΕΙ να είναι αδιαφανές, αλλιώς περνούν από κάτω τα κελιά. */
const STICKY_COL = 'sticky left-0 z-10 bg-card';
const STICKY_COL_HEAD = 'sticky left-0 z-30 bg-muted/95';

export const SAMPLE_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Δεν διαβάστηκε', READ: 'Διαβάστηκε', VERIFIED: 'Επιβεβαιωμένο',
};
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: '#F3F2F1', fg: '#5C5C5C' },
  READ: { bg: '#EAF4FC', fg: '#0078D4' },
  VERIFIED: { bg: '#E8F7F0', fg: '#047857' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[length:var(--fs-10)] font-medium" style={{ backgroundColor: s.bg, color: s.fg }}>
      {SAMPLE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Το chip βαθμού ενός πεδίου ή ενός δείγματος: ποσοστό + «σε πόσα», χρωματισμένο κατά κατώφλι. */
export function ScoreChip({ score, ok, total, title }: { score: number | null; ok?: number; total?: number; title?: string }) {
  if (score == null) return <span className="text-[length:var(--fs-10)] text-muted-foreground">{EMPTY}</span>;
  const tone = SCORE_STYLE[scoreTone(score)];
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[length:var(--fs-10)] font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      title={title ?? (total != null ? `${ok} από ${total} πεδία` : undefined)}
    >
      {pctText(score)}{total != null && <span className="ml-1 font-normal">{ok}/{total}</span>}
    </span>
  );
}

type Props = {
  fields: FieldDef[];
  samples: SampleDto[];
  perField: Record<string, FieldScore>;
  /** Διορθώσεις που πληκτρολογεί τώρα ο χρήστης, ανά δείγμα και πεδίο — δεν έχουν σταλεί ακόμη. */
  drafts: Record<string, Record<string, string>>;
  onDraft: (sampleId: string, key: string, value: string) => void;
  onVerify: (sampleId: string) => void;
  onRead: (sampleId: string) => void;
  onDelete: (sampleId: string) => void;
  onOpen: (sampleId: string) => void;
  openId: string | null;
  busyId: string | null;
  canManage: boolean;
};

export function SampleTable({
  fields, samples, perField, drafts, onDraft, onVerify, onRead, onDelete, onOpen, openId, busyId, canManage,
}: Props) {
  const [editing, setEditing] = React.useState<{ sampleId: string; key: string } | null>(null);

  return (
    <div className="max-h-[65vh] min-w-0 overflow-auto rounded-xl border border-border bg-card shadow-card">
      <table className="w-full border-separate border-spacing-0 text-[length:var(--fs-12)]">
        <thead className="text-left text-[length:var(--fs-11)] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className={cn('sticky top-0 z-30 border-b border-border bg-muted/95 px-3 py-2 font-medium', STICKY_COL_HEAD)}>Δείγμα</th>
            <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-2 font-medium">Κατάσταση</th>
            <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-2 font-medium">Βαθμός</th>
            {fields.map((f) => (
              <th key={f.key} className="sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted/95 px-3 py-2 font-medium">
                <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ backgroundColor: f.color }} aria-hidden />
                {f.label}
                {f.required && <span className="ml-1 text-dg-red-600" title="Υποχρεωτικό">*</span>}
                <div className="mt-0.5 font-normal normal-case">
                  <ScoreChip
                    score={perField[f.key]?.total ? perField[f.key].score : null}
                    ok={perField[f.key]?.ok}
                    total={perField[f.key]?.total}
                    title={`Σωστό σε ${perField[f.key]?.ok ?? 0} από ${perField[f.key]?.total ?? 0} επιβεβαιωμένα δείγματα`}
                  />
                </div>
              </th>
            ))}
            <th className="sticky top-0 z-20 border-b border-border bg-muted/95 px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => {
            const draft = drafts[s.id] ?? {};
            const busy = busyId === s.id;
            return (
              <tr key={s.id} className={cn('border-t border-border', openId === s.id && 'bg-muted/40')}>
                <td className={cn('max-w-[220px] border-b border-border px-3 py-2', STICKY_COL, openId === s.id && 'bg-muted/60')}>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    className="flex max-w-full cursor-pointer items-center gap-1.5 text-left hover:underline"
                    title="Προβολή της σελίδας"
                  >
                    <FiEye className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-medium">{s.fileName}</span>
                  </button>
                  {s.isPrimary && <span className="text-[length:var(--fs-10)] text-muted-foreground">κύριο δείγμα</span>}
                </td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2"><StatusPill status={s.status} /></td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2"><ScoreChip score={s.status === 'VERIFIED' ? s.score : null} /></td>
                {fields.map((f) => {
                  const auto = autoValue(s.lastResult, f.key);
                  const hasDraft = Object.prototype.hasOwnProperty.call(draft, f.key);
                  const confirmed = s.expected && Object.prototype.hasOwnProperty.call(s.expected, f.key) ? s.expected[f.key] : undefined;
                  const shown = hasDraft ? draft[f.key] : confirmed !== undefined ? confirmed : auto;
                  const differs = (hasDraft || confirmed !== undefined) && !agrees(shown, auto, f.valueType);
                  const isEditing = editing?.sampleId === s.id && editing.key === f.key;
                  const editable = canManage && f.kind !== 'TABLE';
                  const text = Array.isArray(shown)
                    ? formatValue(shown as FieldValue['value'], f.valueType)
                    : shown == null || shown === '' ? EMPTY : formatValue(shown as FieldValue['value'], f.valueType);
                  return (
                    <td key={f.key} className="border-b border-border px-1.5 py-1">
                      {isEditing ? (
                        <input
                          autoFocus
                          defaultValue={shown == null ? '' : String(shown)}
                          onBlur={(e) => { onDraft(s.id, f.key, e.target.value); setEditing(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onDraft(s.id, f.key, (e.target as HTMLInputElement).value); setEditing(null); }
                            if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                          }}
                          className="h-7 w-[140px] rounded-sm border border-sisyphus-500 px-1.5 text-[length:var(--fs-12)] outline-none"
                          aria-label={`${f.label} — ${s.fileName}`}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => setEditing({ sampleId: s.id, key: f.key })}
                          title={differs ? `Το πρότυπο διάβασε: ${auto == null ? EMPTY : String(auto)}` : editable ? 'Κλικ για διόρθωση' : 'Τα πεδία πίνακα δεν διορθώνονται εδώ'}
                          className={cn(
                            'block max-w-[200px] truncate rounded-sm px-1.5 py-1 text-left',
                            editable && 'cursor-pointer hover:bg-muted',
                            differs && 'underline decoration-dotted underline-offset-2',
                          )}
                          style={{ color: differs ? '#B45309' : auto == null ? undefined : f.color }}
                        >
                          {text}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap border-b border-border px-3 py-2 text-right">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRead(s.id)} title="Ανάγνωση αυτού του δείγματος">
                        <FiRefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy || s.lastResult == null} onClick={() => onVerify(s.id)} title="Οι τιμές που φαίνονται είναι οι σωστές">
                        <FiCheck className="mr-1 size-3.5" /> Επιβεβαίωση
                      </Button>
                      {!s.isPrimary && (
                        <Button size="sm" variant="ghost" className="text-dg-red-600" disabled={busy} onClick={() => onDelete(s.id)} title="Διαγραφή δείγματος">
                          <FiTrash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
