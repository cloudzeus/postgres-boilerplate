'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RegionMarker } from '@/components/ui/region-marker';

// ─── Types ───────────────────────────────────────────────────────────────────

type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';

interface TaxTemplate {
  id: string;
  code: string;
  name: string;
  year: number | null;
}

interface RegionHint {
  page: number;
  bbox: [number, number, number, number];
}

// FieldExtract variants (new API shape)
interface FieldExtractSingle {
  fieldKey: string;
  label: string;
  kind: 'SINGLE';
  valueType: ValueType;
  raw: string | null;
  // region hint is optional — may come from server alongside
  regionHint?: RegionHint | null;
}
interface FieldExtractSeries {
  fieldKey: string;
  label: string;
  kind: 'SERIES';
  valueType: ValueType;
  series: { year: number | null; raw: string | null }[];
  regionHint?: RegionHint | null;
}
interface FieldExtractTable {
  fieldKey: string;
  label: string;
  kind: 'TABLE';
  columns: string[];
  records: Record<string, string>[];
  regionHint?: RegionHint | null;
}

type FieldExtract = FieldExtractSingle | FieldExtractSeries | FieldExtractTable;

interface ExtractResponse {
  documentId: string;
  fiscalYear: number;
  fields: FieldExtract[];
}

// ReviewedAny — the shape POST /confirm expects
type ReviewedSingle = {
  kind: 'SINGLE';
  fieldKey: string;
  valueType: ValueType;
  raw: string | null;
  edited: boolean;
};
type ReviewedSeries = {
  kind: 'SERIES';
  fieldKey: string;
  valueType: ValueType;
  series: { year: number | null; raw: string | null }[];
  edited: boolean;
};
type ReviewedTable = {
  kind: 'TABLE';
  fieldKey: string;
  records: Record<string, string>[];
  edited: boolean;
};
type ReviewedAny = ReviewedSingle | ReviewedSeries | ReviewedTable;

// Mutable review state per-field (keyed by fieldKey)
type ReviewStateSingle = { kind: 'SINGLE'; valueType: ValueType; raw: string; edited: boolean };
type ReviewStateSeries = {
  kind: 'SERIES';
  valueType: ValueType;
  series: { year: number | null; raw: string }[];
  edited: boolean;
};
type ReviewStateTable = {
  kind: 'TABLE';
  columns: string[];
  records: Record<string, string>[];
  edited: boolean;
};
type ReviewState = ReviewStateSingle | ReviewStateSeries | ReviewStateTable;

export type TaxFormCaptureProps = {
  companyId: string;
  programId?: string;
  taskId?: string;
  templateId?: string;
  fiscalYear?: number;
  onConfirmed?: (count: number) => void;
};

// ─── State machine phases ─────────────────────────────────────────────────────
type Phase = 'select' | 'extracting' | 'review' | 'confirming' | 'done';

// ─── Component ───────────────────────────────────────────────────────────────

export function TaxFormCapture({
  companyId,
  templateId: presetTemplateId,
  fiscalYear: presetFiscalYear,
  onConfirmed,
}: TaxFormCaptureProps) {
  // ── Phase ──
  const [phase, setPhase] = React.useState<Phase>('select');
  const [extractError, setExtractError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);

  // ── Select phase state ──
  const [templates, setTemplates] = React.useState<TaxTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = React.useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState(presetTemplateId ?? '');
  const [fiscalYear, setFiscalYear] = React.useState<number>(
    presetFiscalYear ?? new Date().getFullYear(),
  );
  const [file, setFile] = React.useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Review phase state ──
  const [extractResult, setExtractResult] = React.useState<ExtractResponse | null>(null);
  const [reviewMap, setReviewMap] = React.useState<Record<string, ReviewState>>({});
  const [selectedFieldKey, setSelectedFieldKey] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(0);

  // ── Load templates (only when picker is shown) ──
  React.useEffect(() => {
    if (presetTemplateId) return;
    setTemplatesLoading(true);
    fetch('/api/admin/tax-templates')
      .then((r) => r.json())
      .then((j) => setTemplates(Array.isArray(j?.data) ? j.data : []))
      .catch(() => toast.error('Αποτυχία φόρτωσης προτύπων.'))
      .finally(() => setTemplatesLoading(false));
  }, [presetTemplateId]);

  // ── Reset when back to select ──
  function resetToSelect() {
    setPhase('select');
    setExtractResult(null);
    setReviewMap({});
    setSelectedFieldKey(null);
    setCurrentPage(0);
    setExtractError(null);
    setConfirmError(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Extract ──
  async function handleExtract() {
    if (!selectedTemplateId || !file) return;
    setPhase('extracting');
    setExtractError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('templateId', selectedTemplateId);
      fd.append('fiscalYear', String(fiscalYear));
      const res = await fetch(`/api/admin/companies/${companyId}/financials/extract`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`);
      }
      const data: ExtractResponse = await res.json();

      // Initialise mutable review state from the extract response
      const initial: Record<string, ReviewState> = {};
      for (const f of data.fields) {
        if (f.kind === 'SINGLE') {
          initial[f.fieldKey] = {
            kind: 'SINGLE',
            valueType: f.valueType,
            raw: f.raw ?? '',
            edited: false,
          };
        } else if (f.kind === 'SERIES') {
          initial[f.fieldKey] = {
            kind: 'SERIES',
            valueType: f.valueType,
            series: f.series.map((s) => ({ year: s.year, raw: s.raw ?? '' })),
            edited: false,
          };
        } else {
          initial[f.fieldKey] = {
            kind: 'TABLE',
            columns: f.columns,
            records: f.records.map((r) => ({ ...r })),
            edited: false,
          };
        }
      }

      setExtractResult(data);
      setReviewMap(initial);
      setSelectedFieldKey(data.fields[0]?.fieldKey ?? null);
      setCurrentPage(0);
      setFiscalYear(data.fiscalYear); // use the server-confirmed fiscal year
      setPhase('review');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractError(msg);
      setPhase('select');
    }
  }

  // ── Build ReviewedAny[] from current reviewMap ──
  function buildReviewed(): ReviewedAny[] {
    return Object.entries(reviewMap).map(([fieldKey, state]): ReviewedAny => {
      if (state.kind === 'SINGLE') {
        return {
          kind: 'SINGLE',
          fieldKey,
          valueType: state.valueType,
          raw: state.raw === '' ? null : state.raw,
          edited: state.edited,
        };
      } else if (state.kind === 'SERIES') {
        return {
          kind: 'SERIES',
          fieldKey,
          valueType: state.valueType,
          series: state.series.map((s) => ({ year: s.year, raw: s.raw === '' ? null : s.raw })),
          edited: state.edited,
        };
      } else {
        return {
          kind: 'TABLE',
          fieldKey,
          records: state.records,
          edited: state.edited,
        };
      }
    });
  }

  // ── Confirm ──
  async function handleConfirm() {
    if (!extractResult) return;
    setPhase('confirming');
    setConfirmError(null);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/financials/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          fiscalYear,
          sourceDocumentId: extractResult.documentId,
          fields: buildReviewed(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`);
      const count = (json as { count?: number }).count ?? 0;
      toast.success(`Αποθηκεύτηκαν ${count} τιμές.`);
      onConfirmed?.(count);
      setPhase('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConfirmError(msg);
      setPhase('review');
    }
  }

  // ─── Derived values for review phase ────────────────────────────────────────

  const pageCount = React.useMemo(() => {
    if (!extractResult) return 1;
    const maxPage = extractResult.fields.reduce((max, f) => {
      const p = f.regionHint?.page ?? 0;
      return Math.max(max, p);
    }, 0);
    return Math.max(1, maxPage + 1);
  }, [extractResult]);

  const pageImageUrl = React.useCallback(
    (p: number) => `/api/admin/ocr/${extractResult?.documentId}/page-image?scale=2&page=${p}`,
    [extractResult?.documentId],
  );

  const savedRegions = React.useMemo(() => {
    if (!extractResult) return [];
    return extractResult.fields
      .filter((f) => f.regionHint?.page === currentPage)
      .map((f) => ({
        bbox: f.regionHint!.bbox,
        active: f.fieldKey === selectedFieldKey,
      }));
  }, [extractResult, currentPage, selectedFieldKey]);

  // ─── Render helpers ──────────────────────────────────────────────────────────

  function renderSelectPhase() {
    const canExtract = !!selectedTemplateId && !!file;
    return (
      <div className="space-y-4 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Εισαγωγή φορολογικού εντύπου
        </p>

        {!presetTemplateId && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Πρότυπο εντύπου</span>
            {templatesLoading ? (
              <p className="text-[12px] text-muted-foreground">Φόρτωση προτύπων…</p>
            ) : (
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
              >
                <option value="">— Επιλέξτε πρότυπο —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.code}{t.year ? `/${t.year}` : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground">Χρήση</span>
          <input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            min={2000}
            max={2100}
            className="h-8 w-28 rounded-md border border-input bg-background px-2 text-[12px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-muted-foreground">Αρχείο (PDF ή εικόνα)</span>
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/40 px-4 py-6 text-center transition-colors hover:bg-muted/70"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
          >
            {file ? (
              <>
                <span className="text-[12px] font-semibold text-foreground">{file.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-[11px] text-dg-red-500 hover:underline"
                >
                  Αφαίρεση
                </button>
              </>
            ) : (
              <>
                <span className="text-[13px] text-muted-foreground">Σύρετε αρχείο ή κάντε κλικ</span>
                <span className="text-[11px] text-muted-foreground">PDF, PNG, JPG</span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {extractError && (
          <div className="rounded-md border border-dg-red-500/40 bg-dg-red-500/10 p-2 text-[12px] text-dg-red-700 dark:text-dg-red-400">
            Σφάλμα: {extractError}
          </div>
        )}

        <button
          type="button"
          disabled={!canExtract}
          onClick={handleExtract}
          className="inline-flex h-8 items-center rounded-md bg-sisyphus-500 px-4 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Εξαγωγή
        </button>
      </div>
    );
  }

  function renderExtractingPhase() {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="size-8 animate-spin rounded-full border-4 border-border border-t-sisyphus-500" />
        <p className="text-[12px] text-muted-foreground">Εξαγωγή δεδομένων από το έντυπο…</p>
      </div>
    );
  }

  // ── Field review renderers by kind ──────────────────────────────────────────

  function renderSingleField(f: FieldExtractSingle, state: ReviewStateSingle) {
    return (
      <input
        type="text"
        value={state.raw}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const newVal = e.target.value;
          setReviewMap((prev) => ({
            ...prev,
            [f.fieldKey]: {
              ...state,
              raw: newVal,
              edited: newVal !== (f.raw ?? ''),
            },
          }));
        }}
        className="h-7 w-full rounded border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
      />
    );
  }

  function renderSeriesField(f: FieldExtractSeries, state: ReviewStateSeries) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Χρήση</th>
              <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Τιμή</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {state.series.map((row, idx) => (
              <tr key={idx}>
                <td className="px-2 py-1 tabular-nums text-muted-foreground">
                  {row.year ?? '—'}
                </td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={row.raw}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      const origRow = f.series[idx];
                      setReviewMap((prev) => {
                        const prevState = prev[f.fieldKey] as ReviewStateSeries;
                        const newSeries = prevState.series.map((s, i) =>
                          i === idx ? { ...s, raw: newVal } : s,
                        );
                        const anyEdited = newSeries.some(
                          (s, i) => s.raw !== (f.series[i]?.raw ?? ''),
                        );
                        return {
                          ...prev,
                          [f.fieldKey]: { ...prevState, series: newSeries, edited: anyEdited },
                        };
                      });
                      void origRow; // used above via f.series[idx]
                    }}
                    className="h-6 w-full rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderTableField(f: FieldExtractTable, state: ReviewStateTable) {
    if (state.columns.length === 0 && state.records.length === 0) {
      return <p className="text-[11px] text-muted-foreground">Κενός πίνακας</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {state.columns.map((col) => (
                <th key={col} className="px-2 py-1 text-left font-semibold text-muted-foreground whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {state.records.map((rec, rIdx) => (
              <tr key={rIdx}>
                {state.columns.map((col) => (
                  <td key={col} className="px-2 py-1">
                    <input
                      type="text"
                      value={rec[col] ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const newVal = e.target.value;
                        setReviewMap((prev) => {
                          const prevState = prev[f.fieldKey] as ReviewStateTable;
                          const newRecords = prevState.records.map((r, i) =>
                            i === rIdx ? { ...r, [col]: newVal } : r,
                          );
                          const anyEdited = newRecords.some((r, i) =>
                            Object.keys(r).some((k) => r[k] !== (f.records[i]?.[k] ?? '')),
                          );
                          return {
                            ...prev,
                            [f.fieldKey]: { ...prevState, records: newRecords, edited: anyEdited },
                          };
                        });
                      }}
                      className="h-6 min-w-[80px] rounded border border-input bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderReviewPhase() {
    if (!extractResult) return null;
    const { fields } = extractResult;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Έλεγχος εξαγόμενων τιμών
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetToSelect}
              className="inline-flex h-7 items-center rounded-md border border-input bg-background px-3 text-[11px] font-semibold hover:bg-muted"
            >
              ← Πίσω
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="inline-flex h-7 items-center rounded-md bg-emerald-600 px-3.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              Επιβεβαίωση
            </button>
          </div>
        </div>

        {confirmError && (
          <div className="border-b border-dg-red-500/30 bg-dg-red-500/10 px-4 py-2 text-[12px] text-dg-red-700 dark:text-dg-red-400">
            Σφάλμα επιβεβαίωσης: {confirmError}
          </div>
        )}

        {/* Split view */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_420px]">
          {/* LEFT — document preview */}
          <div className="relative min-h-[400px] overflow-auto border-b border-border bg-muted md:border-b-0 md:border-r">
            <RegionMarker
              pageImageUrl={pageImageUrl}
              pageCount={pageCount}
              page={currentPage}
              onPageChange={setCurrentPage}
              isMarking={false}
              savedRegions={savedRegions}
              onRegionComplete={() => {}}
              className="w-full"
            />
          </div>

          {/* RIGHT — field list by kind */}
          <div className="flex flex-col overflow-auto">
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Πεδία ({fields.length})
              </p>
            </div>
            <div className="flex-1 divide-y divide-border">
              {fields.map((f) => {
                const state = reviewMap[f.fieldKey];
                if (!state) return null;
                const isSelected = selectedFieldKey === f.fieldKey;
                const isEdited = state.edited;
                const kindBadge = f.kind === 'SINGLE' ? null : (
                  <span className="ml-1 rounded-sm bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {f.kind === 'SERIES' ? 'σειρά' : 'πίνακας'}
                  </span>
                );

                return (
                  <div
                    key={f.fieldKey}
                    onClick={() => {
                      setSelectedFieldKey(f.fieldKey);
                      if (f.regionHint != null) {
                        setCurrentPage(f.regionHint.page);
                      }
                    }}
                    className={`cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50 ${isSelected ? 'bg-muted' : ''}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-foreground">
                          {f.label}
                          {kindBadge}
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">{f.fieldKey}</p>
                      </div>
                      <span
                        title={isEdited ? 'Τροποποιήθηκε χειροκίνητα' : 'OCR (μη επιβεβαιωμένο)'}
                        className="shrink-0 text-[13px]"
                      >
                        {isEdited ? '✋' : '🟡'}
                      </span>
                    </div>

                    {/* Render field control by kind */}
                    {state.kind === 'SINGLE' && renderSingleField(f as FieldExtractSingle, state)}
                    {state.kind === 'SERIES' && renderSeriesField(f as FieldExtractSeries, state)}
                    {state.kind === 'TABLE' && renderTableField(f as FieldExtractTable, state)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderConfirmingPhase() {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="size-8 animate-spin rounded-full border-4 border-border border-t-emerald-500" />
        <p className="text-[12px] text-muted-foreground">Αποθήκευση τιμών…</p>
      </div>
    );
  }

  function renderDonePhase() {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15">
          <span className="text-2xl">✓</span>
        </div>
        <p className="text-[13px] font-semibold text-foreground">Οι τιμές αποθηκεύτηκαν!</p>
        <button
          type="button"
          onClick={resetToSelect}
          className="inline-flex h-8 items-center rounded-md border border-input bg-background px-4 text-[12px] font-semibold hover:bg-muted"
        >
          Νέα εισαγωγή
        </button>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-[400px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
      {phase === 'select' && renderSelectPhase()}
      {phase === 'extracting' && renderExtractingPhase()}
      {(phase === 'review' || phase === 'confirming') && (
        phase === 'confirming' ? renderConfirmingPhase() : renderReviewPhase()
      )}
      {phase === 'done' && renderDonePhase()}
    </div>
  );
}
