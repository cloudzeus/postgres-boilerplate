'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiTarget, FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut, FiCheckCircle } from 'react-icons/fi';
import { RegionMarker } from '@/components/ui/region-marker';
import type { NormBox } from '@/app/admin/ocr/[id]/use-marquee';
import type { TemplateField } from '@/app/admin/tax-templates/[id]/editor';

export type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';

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
  const [fields, setFields] = React.useState<LocalField[]>(() => initialFields.map((f, i) => makeLocal(f, i)));
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [isMarking, setIsMarking] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [scanResult, setScanResult] = React.useState<{ localId: string; raw: string | null; value: number | null } | null>(null);

  const pageCount = Math.max(1, samplePageCount ?? 1);
  const selected = fields.find((f) => f.localId === selectedId) ?? null;

  const pageImageUrl = React.useCallback(
    (p: number) => `/api/admin/tax-templates/${templateId}/page-image?scale=2&page=${p}`,
    [templateId],
  );

  function selectField(localId: string) {
    setSelectedId(localId);
    setScanResult(null);
    const f = fields.find((x) => x.localId === localId);
    if (f?.regionHint) setPage(f.regionHint.page); // jump to where its region lives
  }

  function addField() {
    const localId = crypto.randomUUID();
    setFields((prev) => [...prev, {
      localId, fieldKey: '', label: '', section: '', valueType: 'CURRENCY',
      regionHint: null, aiHint: '', required: false, order: prev.length,
    }]);
    setSelectedId(localId);
    setIsMarking(false);
    setScanResult(null);
  }

  async function scanRegion(f: LocalField) {
    if (!f.regionHint) return;
    if (!f.label.trim()) { toast.error('Δώσε πρώτα Ετικέτα για να σκαναριστεί η περιοχή.'); return; }
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/test-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: f.label.trim(),
          valueType: f.valueType,
          aiHint: f.aiHint.trim() || undefined,
          regionHint: f.regionHint,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setScanResult({ localId: f.localId, raw: json.raw ?? null, value: json.value ?? null });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  function removeField(localId: string) {
    setFields((prev) => prev.filter((f) => f.localId !== localId));
    if (selectedId === localId) { setSelectedId(null); setIsMarking(false); }
  }

  function updateField(localId: string, patch: Partial<LocalField>) {
    setFields((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));
  }

  function onRegionComplete(box: NormBox, completedPage: number) {
    if (!selectedId) return;
    const region = { page: completedPage, bbox: [box.x, box.y, box.w, box.h] as [number, number, number, number] };
    updateField(selectedId, { regionHint: region });
    setIsMarking(false);
    const f = fields.find((x) => x.localId === selectedId);
    if (f) void scanRegion({ ...f, regionHint: region }); // auto-scan the freshly drawn region
  }

  const savedRegions = fields
    .filter((f) => f.regionHint?.page === page)
    .map((f) => ({ bbox: f.regionHint!.bbox, active: f.localId === selectedId }));

  async function saveFields() {
    const incomplete = fields.filter((f) => !f.label.trim());
    if (incomplete.length) {
      toast.error('Κάθε πεδίο χρειάζεται Ετικέτα πριν την αποθήκευση (ο Κωδικός είναι προαιρετικός).');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields.map((f, i) => ({
          fieldKey: f.fieldKey.trim(), label: f.label.trim(),
          section: f.section.trim() || undefined, valueType: f.valueType,
          regionHint: f.regionHint ?? undefined, aiHint: f.aiHint.trim() || undefined,
          required: f.required, order: i,
        }))),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const savedFields = Array.isArray(json) ? json : json?.fields;
      if (Array.isArray(savedFields)) {
        setFields((prev) => prev.map((f, i) => {
          const s = savedFields[i] as { id?: string; fieldKey?: string } | undefined;
          return { ...f, id: s?.id ?? f.id, localId: s?.id ?? f.localId, fieldKey: s?.fieldKey ?? f.fieldKey };
        }));
      }
      toast.success('Τα πεδία αποθηκεύτηκαν.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const noSample = samplePageCount == null;
  const markedCount = fields.filter((f) => f.regionHint).length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Πεδία εντύπου & χαρτογράφηση περιοχών</p>
          <p className="text-[11px] text-muted-foreground">
            {fields.length} πεδία · {markedCount} με σημειωμένη περιοχή
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addField}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
            <FiPlus className="size-3.5" /> Προσθήκη πεδίου
          </button>
          <button type="button" onClick={saveFields} disabled={saving || fields.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
            <FiSave className="size-3.5" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση πεδίων'}
          </button>
        </div>
      </div>

      {/* How-to strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Πώς λειτουργεί:</span>
        <span>1. «Προσθήκη πεδίου»</span>
        <span>2. Διάλεξε το πεδίο αριστερά</span>
        <span>3. «Σχεδίασε περιοχή» & σύρε πάνω στην τιμή</span>
        <span>4. «Αποθήκευση πεδίων»</span>
      </div>

      {noSample ? (
        <div className="flex items-center justify-center p-10 text-center text-[12px] text-muted-foreground">
          <div>
            <p className="font-semibold">Δεν υπάρχει δείγμα PDF.</p>
            <p className="mt-1">Ανέβασε ένα δείγμα εντύπου (πιο πάνω) για να ξεκινήσεις τη χαρτογράφηση.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* LEFT: fields + properties */}
          <div className="flex max-h-[640px] flex-col overflow-auto border-b border-border lg:border-b-0 lg:border-r">
            {fields.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                <p>Δεν υπάρχουν πεδία ακόμη.</p>
                <button type="button" onClick={addField}
                  className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600">
                  <FiPlus className="size-3.5" /> Προσθήκη πρώτου πεδίου
                </button>
              </div>
            ) : (
              fields.map((f) => {
                const isSel = f.localId === selectedId;
                return (
                  <div key={f.localId} className={isSel ? 'bg-sisyphus-500/5' : ''}>
                    <button type="button" onClick={() => selectField(f.localId)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${isSel ? 'border-l-2 border-sisyphus-500' : 'border-l-2 border-transparent'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-foreground">
                          {f.label || <span className="italic text-muted-foreground">Χωρίς ετικέτα</span>}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {f.fieldKey || '—'} · {VALUE_TYPE_LABELS[f.valueType]}
                        </span>
                      </span>
                      {f.regionHint ? (
                        <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: '#16a34a1a', color: '#15803d' }}>
                          <FiCheckCircle className="size-3" /> σελ.{f.regionHint.page + 1}
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">χωρίς περιοχή</span>
                      )}
                      <FiTrash2 className="size-3.5 shrink-0 text-muted-foreground hover:text-dg-red-500"
                        onClick={(e) => { e.stopPropagation(); removeField(f.localId); }} />
                    </button>

                    {isSel && (
                      <div className="space-y-2.5 border-t border-border bg-background/60 px-3 py-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Κωδικός (προαιρ.)</span>
                            <input value={f.fieldKey} onChange={(e) => updateField(f.localId, { fieldKey: e.target.value })}
                              placeholder="αυτόματο αν κενό" className="h-8 rounded-md border border-input bg-background px-2 text-[12px]" />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Ετικέτα *</span>
                            <input value={f.label} onChange={(e) => updateField(f.localId, { label: e.target.value })}
                              placeholder="Κύκλος Εργασιών" className="h-8 rounded-md border border-input bg-background px-2 text-[12px]" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Τύπος τιμής</span>
                            <select value={f.valueType} onChange={(e) => updateField(f.localId, { valueType: e.target.value as ValueType })}
                              className="h-8 rounded-md border border-input bg-background px-1.5 text-[12px]">
                              {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => (
                                <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Ενότητα (προαιρ.)</span>
                            <input value={f.section} onChange={(e) => updateField(f.localId, { section: e.target.value })}
                              placeholder="π.χ. Πίνακας Ζ" className="h-8 rounded-md border border-input bg-background px-2 text-[12px]" />
                          </label>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                          <input type="checkbox" checked={f.required} onChange={(e) => updateField(f.localId, { required: e.target.checked })} className="size-4" />
                          <span className="text-muted-foreground">Υποχρεωτικό πεδίο</span>
                        </label>

                        {/* Mark region CTA */}
                        <button type="button" onClick={() => setIsMarking((m) => !m)}
                          className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
                            isMarking ? 'border-sisyphus-500 bg-sisyphus-500 text-white'
                              : 'border-sisyphus-500/50 bg-sisyphus-500/10 text-sisyphus-700 hover:bg-sisyphus-500/20'
                          }`}>
                          <FiTarget className="size-4" />
                          {isMarking ? 'Ακύρωση — σύρε πλαίσιο στο έγγραφο →' : f.regionHint ? 'Επανασχεδίαση περιοχής' : 'Σχεδίασε περιοχή στο έγγραφο'}
                        </button>
                        {f.regionHint && (
                          <div className="space-y-1.5">
                            <button type="button" onClick={() => scanRegion(f)} disabled={scanning}
                              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                              {scanning ? 'Σκανάρισμα…' : '🔍 Σκάναρε περιοχή & δες τιμή'}
                            </button>
                            {scanResult && scanResult.localId === f.localId && (
                              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 text-[11px]">
                                <p className="text-muted-foreground">Τιμή που διαβάστηκε:</p>
                                <p className="break-all font-mono text-[13px] font-bold text-emerald-700 dark:text-emerald-400">
                                  {scanResult.raw ?? '—'}
                                </p>
                                {scanResult.value != null && (
                                  <p className="text-[10px] text-muted-foreground">ως {VALUE_TYPE_LABELS[f.valueType]}: {scanResult.value}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* RIGHT: document viewer */}
          <div className="flex flex-col bg-muted/30">
            {/* Toolbar: page nav + zoom — ALWAYS visible */}
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
              <div className="flex items-center gap-1">
                <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted">
                  <FiChevronLeft className="size-4" />
                </button>
                <span className="min-w-[92px] text-center text-[12px] font-semibold tabular-nums">Σελίδα {page + 1} / {pageCount}</span>
                <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted">
                  <FiChevronRight className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted">
                  <FiZoomOut className="size-4" />
                </button>
                <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button type="button" disabled={zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted">
                  <FiZoomIn className="size-4" />
                </button>
              </div>
            </div>

            {/* Marking banner */}
            {isMarking && selected && (
              <div className="flex items-center gap-2 bg-sisyphus-500 px-3 py-1.5 text-[12px] font-semibold text-white">
                <FiTarget className="size-4 shrink-0" />
                Σύρε ένα πλαίσιο γύρω από την τιμή για «{selected.label || selected.fieldKey || 'το πεδίο'}»
              </div>
            )}

            {/* Document */}
            <div className="max-h-[600px] flex-1 overflow-auto p-3">
              <div style={{ width: `${zoom * 100}%` }} className="mx-auto">
                <RegionMarker
                  pageImageUrl={pageImageUrl}
                  pageCount={pageCount}
                  page={page}
                  showNav={false}
                  isMarking={isMarking && !!selected}
                  savedRegions={savedRegions}
                  onRegionComplete={onRegionComplete}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
