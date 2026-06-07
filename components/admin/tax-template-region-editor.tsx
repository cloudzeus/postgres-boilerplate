'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiTarget } from 'react-icons/fi';
import { RegionMarker } from '@/components/ui/region-marker';
import type { NormBox } from '@/app/admin/ocr/[id]/use-marquee';
import type { TemplateField } from '@/app/admin/tax-templates/[id]/editor';

type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';

const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  CURRENCY: 'Ποσό (€)',
  NUMBER: 'Αριθμός',
  PERCENT: 'Ποσοστό (%)',
  INTEGER: 'Ακέραιος',
  DATE: 'Ημερομηνία',
  BOOLEAN: 'Ναι/Όχι',
};

interface LocalField {
  localId: string;
  id?: string;
  fieldKey: string;
  label: string;
  section: string;
  valueType: ValueType;
  regionHint: { page: number; bbox: [number, number, number, number] } | null;
  aiHint: string;
  required: boolean;
  order: number;
}

function makeLocal(f: TemplateField, idx: number): LocalField {
  return {
    localId: f.id ?? crypto.randomUUID(),
    id: f.id,
    fieldKey: f.fieldKey,
    label: f.label,
    section: f.section ?? '',
    valueType: f.valueType,
    regionHint: f.regionHint ?? null,
    aiHint: f.aiHint ?? '',
    required: f.required,
    order: f.order ?? idx,
  };
}

interface Props {
  templateId: string;
  initialFields: TemplateField[];
  samplePageCount: number | null;
}

export function TaxTemplateRegionEditor({ templateId, initialFields, samplePageCount }: Props) {
  const [fields, setFields] = React.useState<LocalField[]>(() =>
    initialFields.map((f, i) => makeLocal(f, i))
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [isMarking, setIsMarking] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const pageCount = samplePageCount ?? 1;

  const pageImageUrl = React.useCallback(
    (p: number) => `/api/admin/tax-templates/${templateId}/page-image?scale=2&page=${p}`,
    [templateId]
  );

  function addField() {
    const localId = crypto.randomUUID();
    setFields((prev) => [
      ...prev,
      {
        localId,
        fieldKey: '',
        label: '',
        section: '',
        valueType: 'CURRENCY',
        regionHint: null,
        aiHint: '',
        required: false,
        order: prev.length,
      },
    ]);
    setSelectedId(localId);
  }

  function removeField(localId: string) {
    setFields((prev) => prev.filter((f) => f.localId !== localId));
    if (selectedId === localId) { setSelectedId(null); setIsMarking(false); }
  }

  function updateField(localId: string, patch: Partial<LocalField>) {
    setFields((prev) => prev.map((f) => f.localId === localId ? { ...f, ...patch } : f));
  }

  function onRegionComplete(box: NormBox, completedPage: number) {
    if (!selectedId) return;
    updateField(selectedId, { regionHint: { page: completedPage, bbox: [box.x, box.y, box.w, box.h] } });
    setIsMarking(false);
    toast.success('Η περιοχή αποθηκεύτηκε στο πεδίο.');
  }

  // savedRegions for current page: non-selected in green, selected in red
  const savedRegions = fields
    .filter((f) => f.regionHint?.page === page)
    .map((f) => ({
      bbox: f.regionHint!.bbox,
      active: f.localId === selectedId,
    }));

  async function saveFields() {
    const toSave = fields.filter((f) => f.fieldKey.trim() && f.label.trim());
    if (toSave.length !== fields.length) {
      toast.error('Συμπλήρωσε fieldKey και label σε όλα τα πεδία πριν αποθηκεύσεις.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          toSave.map((f, i) => ({
            fieldKey: f.fieldKey.trim(),
            label: f.label.trim(),
            section: f.section.trim() || undefined,
            valueType: f.valueType,
            regionHint: f.regionHint ?? undefined,
            aiHint: f.aiHint.trim() || undefined,
            required: f.required,
            order: i,
          }))
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      // Re-sync IDs from server
      if (Array.isArray(json)) {
        setFields((prev) =>
          prev.map((f, i) => ({
            ...f,
            id: (json[i] as { id?: string } | undefined)?.id ?? f.id,
            localId: (json[i] as { id?: string } | undefined)?.id ?? f.localId,
          }))
        );
      }
      toast.success('Τα πεδία αποθηκεύτηκαν.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  const selected = fields.find((f) => f.localId === selectedId);

  return (
    <div className="rounded-lg border border-border bg-card shadow-fluent-2">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Πεδία εντύπου & χαρτογράφηση περιοχών</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addField}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-[11px] font-semibold hover:bg-muted"
          >
            <FiPlus className="size-3" /> Προσθήκη πεδίου
          </button>
          <button
            type="button"
            onClick={saveFields}
            disabled={saving || fields.length === 0}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[11px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50"
          >
            <FiSave className="size-3" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση πεδίων'}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)]">
        {/* Field list + editor */}
        <div className="flex flex-col divide-y divide-border overflow-auto border-r border-border">
          {fields.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              Δεν υπάρχουν πεδία. Πατήστε &ldquo;Προσθήκη πεδίου&rdquo;.
            </p>
          )}
          {fields.map((f) => (
            <div
              key={f.localId}
              onClick={() => setSelectedId(f.localId === selectedId ? null : f.localId)}
              className={`cursor-pointer px-3 py-2 transition-colors hover:bg-muted/50 ${f.localId === selectedId ? 'bg-muted' : ''}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-foreground">
                    {f.label || <span className="text-muted-foreground italic">Χωρίς όνομα</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{f.fieldKey || '—'} · {VALUE_TYPE_LABELS[f.valueType]}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {f.regionHint && (
                    <span className="inline-flex h-4 items-center rounded px-1 text-[9px] font-bold uppercase" style={{ background: '#16a34a22', color: '#16a34a' }}>
                      p{f.regionHint.page + 1}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeField(f.localId); }}
                    className="rounded p-0.5 text-muted-foreground hover:text-dg-red-500"
                  >
                    <FiTrash2 className="size-3" />
                  </button>
                </div>
              </div>

              {f.localId === selectedId && (
                <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">fieldKey</span>
                      <input
                        value={f.fieldKey}
                        onChange={(e) => updateField(f.localId, { fieldKey: e.target.value })}
                        placeholder="net_revenue"
                        className="h-7 rounded border border-input bg-background px-2 text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">Ετικέτα</span>
                      <input
                        value={f.label}
                        onChange={(e) => updateField(f.localId, { label: e.target.value })}
                        placeholder="Καθαρά έσοδα"
                        className="h-7 rounded border border-input bg-background px-2 text-[11px]"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">Τύπος</span>
                      <select
                        value={f.valueType}
                        onChange={(e) => updateField(f.localId, { valueType: e.target.value as ValueType })}
                        className="h-7 rounded border border-input bg-background px-1.5 text-[11px]"
                      >
                        {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => (
                          <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">Ενότητα</span>
                      <input
                        value={f.section}
                        onChange={(e) => updateField(f.localId, { section: e.target.value })}
                        placeholder="π.χ. Α. Έσοδα"
                        className="h-7 rounded border border-input bg-background px-2 text-[11px]"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground">AI Hint</span>
                    <textarea
                      value={f.aiHint}
                      onChange={(e) => updateField(f.localId, { aiHint: e.target.value })}
                      rows={2}
                      placeholder="Πού βρίσκεται αυτό το πεδίο στο έντυπο…"
                      className="rounded border border-input bg-background p-1.5 text-[11px]"
                    />
                  </label>
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => updateField(f.localId, { required: e.target.checked })}
                        className="size-3.5"
                      />
                      <span className="text-muted-foreground">Υποχρεωτικό</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsMarking((m) => !m)}
                      className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-semibold transition-colors ${
                        isMarking
                          ? 'border-sisyphus-500 bg-sisyphus-500/10 text-sisyphus-700'
                          : 'border-input bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <FiTarget className="size-3" />
                      {isMarking ? 'Σύρε πλαίσιο…' : f.regionHint ? 'Επανεπιλογή περιοχής' : 'Επιλογή περιοχής'}
                    </button>
                  </div>
                  {f.regionHint && (
                    <p className="text-[10px] text-muted-foreground">
                      Περιοχή: σελ. {f.regionHint.page + 1}, bbox [{f.regionHint.bbox.map((v) => v.toFixed(3)).join(', ')}]
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Region marker */}
        <div className="relative flex flex-col">
          {samplePageCount != null ? (
            <>
              <div className="relative min-h-[500px] flex-1 overflow-auto bg-muted">
                <RegionMarker
                  pageImageUrl={pageImageUrl}
                  pageCount={pageCount}
                  page={page}
                  onPageChange={setPage}
                  isMarking={isMarking && !!selected}
                  savedRegions={savedRegions}
                  onRegionComplete={onRegionComplete}
                  onError={() => toast.error('Σφάλμα φόρτωσης εικόνας σελίδας.')}
                  className="w-full"
                />
              </div>
              {!selected && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
                  <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] font-semibold text-muted-foreground shadow-fluent-4">
                    Επιλέξτε πεδίο για να σημειώσετε περιοχή
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-[12px] text-muted-foreground">
              <div>
                <p className="font-semibold">Δεν υπάρχει δείγμα PDF.</p>
                <p className="mt-1">Ανεβάστε ένα δείγμα για να ενεργοποιηθεί η χαρτογράφηση περιοχών.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
