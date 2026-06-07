'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RegionMarker } from '@/components/ui/region-marker';

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface TemplateField {
  id: string;
  fieldKey: string;
  label: string;
  valueType: string;
  regionHint?: RegionHint | null;
  aiHint?: string | null;
  section?: string | null;
  required: boolean;
}

interface ExtractResponse {
  documentId: string;
  values: Record<string, string | null>;
  fields: TemplateField[];
}

interface ReviewedValues {
  [fieldKey: string]: { raw: string; edited: boolean };
}

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
  const [reviewValues, setReviewValues] = React.useState<ReviewedValues>({});
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
    setReviewValues({});
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
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      const data: ExtractResponse = await res.json();
      // Initialise review state
      const initial: ReviewedValues = {};
      for (const f of data.fields) {
        initial[f.fieldKey] = { raw: data.values[f.fieldKey] ?? '', edited: false };
      }
      setExtractResult(data);
      setReviewValues(initial);
      setSelectedFieldKey(data.fields[0]?.fieldKey ?? null);
      setCurrentPage(0);
      setPhase('review');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractError(msg);
      setPhase('select');
    }
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
          year: fiscalYear,
          sourceDocumentId: extractResult.documentId,
          reviewed: reviewValues,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Αποθηκεύτηκαν ${json.count ?? 0} τιμές.`);
      onConfirmed?.(json.count ?? 0);
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
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_380px]">
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

          {/* RIGHT — editable field table */}
          <div className="flex flex-col overflow-auto">
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Πεδία ({fields.length})
              </p>
            </div>
            <div className="flex-1 divide-y divide-border">
              {fields.map((f) => {
                const rv = reviewValues[f.fieldKey];
                const isSelected = selectedFieldKey === f.fieldKey;
                const isEdited = rv?.edited ?? false;

                return (
                  <div
                    key={f.fieldKey}
                    onClick={() => {
                      setSelectedFieldKey(f.fieldKey);
                      // Navigate to the field's page if it has a regionHint
                      if (f.regionHint != null) {
                        setCurrentPage(f.regionHint.page);
                      }
                    }}
                    className={`cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50 ${isSelected ? 'bg-muted' : ''}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-foreground">
                          {f.label}
                          {f.required && (
                            <span className="ml-1 text-dg-red-500">*</span>
                          )}
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
                    <input
                      type="text"
                      value={rv?.raw ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const newVal = e.target.value;
                        setReviewValues((prev) => ({
                          ...prev,
                          [f.fieldKey]: {
                            raw: newVal,
                            edited: newVal !== (extractResult.values[f.fieldKey] ?? ''),
                          },
                        }));
                      }}
                      className="h-7 w-full rounded border border-input bg-background px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-sisyphus-500"
                    />
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
