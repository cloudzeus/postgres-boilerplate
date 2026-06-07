'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiTarget, FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut, FiCheckCircle, FiGrid, FiSquare } from 'react-icons/fi';
import { RegionMarker } from '@/components/ui/region-marker';
import type { NormBox } from '@/app/admin/ocr/[id]/use-marquee';
import type { TemplateField } from '@/app/admin/tax-templates/[id]/editor';

export type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';
type Kind = 'SINGLE' | 'SERIES';
type Region = { page: number; bbox: [number, number, number, number] };

const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  CURRENCY: 'Ποσό (€)', NUMBER: 'Αριθμός', PERCENT: 'Ποσοστό (%)',
  INTEGER: 'Ακέραιος', DATE: 'Ημερομηνία', BOOLEAN: 'Ναι/Όχι',
};

interface LocalField {
  localId: string;
  id?: string;
  fieldKey: string;
  label: string;
  section: string;
  valueType: ValueType;
  kind: Kind;
  regionHint: Region | null;
  aiHint: string;
  required: boolean;
  order: number;
}

function makeLocal(f: TemplateField, idx: number): LocalField {
  return {
    localId: f.id ?? crypto.randomUUID(), id: f.id,
    fieldKey: f.fieldKey, label: f.label, section: f.section ?? '',
    valueType: f.valueType, kind: f.kind ?? 'SINGLE',
    regionHint: f.regionHint ?? null, aiHint: f.aiHint ?? '',
    required: f.required, order: f.order ?? idx,
  };
}

type ScanResult =
  | { localId: string; kind: 'SINGLE'; raw: string | null; value: number | null }
  | { localId: string; kind: 'SERIES'; series: { year: number | null; raw: string | null; value: number | null }[] };

interface TableReviewRow { label: string; values: string[]; include: boolean; valueType: ValueType; }

interface Props {
  templateId: string;
  initialFields: TemplateField[];
  samplePageCount: number | null;
}

export function TaxTemplateRegionEditor({ templateId, initialFields, samplePageCount }: Props) {
  const [fields, setFields] = React.useState<LocalField[]>(() => initialFields.map((f, i) => makeLocal(f, i)));
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [markMode, setMarkMode] = React.useState<'field' | 'table'>('field');
  const [isMarking, setIsMarking] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [tableRegion, setTableRegion] = React.useState<Region | null>(null);
  const [tableScan, setTableScan] = React.useState<{ columns: string[]; rows: TableReviewRow[] } | null>(null);
  const [scanningTable, setScanningTable] = React.useState(false);

  const pageCount = Math.max(1, samplePageCount ?? 1);
  const selected = fields.find((f) => f.localId === selectedId) ?? null;
  const noSample = samplePageCount == null;

  const pageImageUrl = React.useCallback(
    (p: number) => `/api/admin/tax-templates/${templateId}/page-image?scale=2&page=${p}`,
    [templateId],
  );

  function selectField(localId: string) {
    setSelectedId(localId);
    setScanResult(null);
    const f = fields.find((x) => x.localId === localId);
    if (f?.regionHint) setPage(f.regionHint.page);
  }

  function addField() {
    const localId = crypto.randomUUID();
    setFields((prev) => [...prev, {
      localId, fieldKey: '', label: '', section: '', valueType: 'CURRENCY', kind: 'SINGLE',
      regionHint: null, aiHint: '', required: false, order: prev.length,
    }]);
    setSelectedId(localId);
    setMarkMode('field');
    setIsMarking(false);
    setScanResult(null);
  }

  function updateField(localId: string, patch: Partial<LocalField>) {
    setFields((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));
  }

  function removeField(localId: string) {
    setFields((prev) => prev.filter((f) => f.localId !== localId));
    if (selectedId === localId) { setSelectedId(null); setIsMarking(false); }
  }

  async function scanRegion(f: LocalField) {
    if (!f.regionHint) return;
    if (!f.label.trim()) { toast.error('Δώσε πρώτα Ετικέτα για να σκαναριστεί η περιοχή.'); return; }
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/test-field`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: f.label.trim(), valueType: f.valueType, kind: f.kind, aiHint: f.aiHint.trim() || undefined, regionHint: f.regionHint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      if (json.kind === 'SERIES') setScanResult({ localId: f.localId, kind: 'SERIES', series: json.series ?? [] });
      else setScanResult({ localId: f.localId, kind: 'SINGLE', raw: json.raw ?? null, value: json.value ?? null });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setScanning(false); }
  }

  async function scanTableRegion(region: Region) {
    setScanningTable(true);
    setTableScan(null);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/scan-table`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regionHint: region }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const columns: string[] = Array.isArray(json.columns) ? json.columns : [];
      const rows: TableReviewRow[] = (Array.isArray(json.rows) ? json.rows : []).map((r: { label: string; values: string[] }) => ({
        label: r.label ?? '', values: Array.isArray(r.values) ? r.values : [], include: true, valueType: 'CURRENCY' as ValueType,
      }));
      setTableScan({ columns, rows });
      if (rows.length === 0) toast.error('Δεν εντοπίστηκαν γραμμές στον πίνακα. Δοκίμασε μεγαλύτερη/ακριβέστερη περιοχή.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setScanningTable(false); }
  }

  function onRegionComplete(box: NormBox, completedPage: number) {
    const region: Region = { page: completedPage, bbox: [box.x, box.y, box.w, box.h] };
    setIsMarking(false);
    if (markMode === 'table') {
      setTableRegion(region);
      void scanTableRegion(region);
      return;
    }
    if (!selectedId) return;
    updateField(selectedId, { regionHint: region });
    const f = fields.find((x) => x.localId === selectedId);
    if (f) void scanRegion({ ...f, regionHint: region });
  }

  function createFieldsFromTable() {
    if (!tableScan || !tableRegion) return;
    const multiCol = tableScan.columns.length >= 2;
    const kind: Kind = multiCol ? 'SERIES' : 'SINGLE';
    const rows = tableScan.rows.filter((r) => r.include && r.label.trim());
    if (rows.length === 0) { toast.error('Επίλεξε τουλάχιστον μία γραμμή.'); return; }
    setFields((prev) => [
      ...prev,
      ...rows.map((r, i) => ({
        localId: crypto.randomUUID(), fieldKey: '', label: r.label.trim(), section: '',
        valueType: r.valueType, kind, regionHint: tableRegion, aiHint: '', required: false, order: prev.length + i,
      } as LocalField)),
    ]);
    toast.success(`Δημιουργήθηκαν ${rows.length} πεδία (${kind === 'SERIES' ? 'σειρά ετών' : 'μονή τιμή'}). Μην ξεχάσεις «Αποθήκευση πεδίων».`);
    setTableScan(null); setTableRegion(null); setMarkMode('field');
  }

  const savedRegions = fields
    .filter((f) => f.regionHint?.page === page)
    .map((f) => ({ bbox: f.regionHint!.bbox, active: f.localId === selectedId }));
  if (markMode === 'table' && tableRegion && tableRegion.page === page) {
    savedRegions.push({ bbox: tableRegion.bbox, active: true });
  }

  async function saveFields() {
    const incomplete = fields.filter((f) => !f.label.trim());
    if (incomplete.length) { toast.error('Κάθε πεδίο χρειάζεται Ετικέτα (ο Κωδικός είναι προαιρετικός).'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/fields`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields.map((f, i) => ({
          fieldKey: f.fieldKey.trim() || undefined, label: f.label.trim(),
          section: f.section.trim() || undefined, valueType: f.valueType, kind: f.kind,
          regionHint: f.regionHint ?? undefined, aiHint: f.aiHint.trim() || undefined, required: f.required, order: i,
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
    } finally { setSaving(false); }
  }

  const markedCount = fields.filter((f) => f.regionHint).length;
  const canDrawField = markMode === 'field' && !!selected;
  const canDrawTable = markMode === 'table';

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-fluent-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Πεδία εντύπου & χαρτογράφηση περιοχών</p>
          <p className="text-[11px] text-muted-foreground">{fields.length} πεδία · {markedCount} με περιοχή</p>
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

      {/* Mode toggle + how-to */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <div className="inline-flex overflow-hidden rounded-md border border-input">
          <button type="button" onClick={() => { setMarkMode('field'); setIsMarking(false); }}
            className={`inline-flex h-7 items-center gap-1 px-2.5 text-[11px] font-semibold ${markMode === 'field' ? 'bg-sisyphus-500 text-white' : 'bg-background hover:bg-muted'}`}>
            <FiSquare className="size-3" /> Μεμονωμένο πεδίο
          </button>
          <button type="button" onClick={() => { setMarkMode('table'); setIsMarking(false); setScanResult(null); }}
            className={`inline-flex h-7 items-center gap-1 px-2.5 text-[11px] font-semibold ${markMode === 'table' ? 'bg-sisyphus-500 text-white' : 'bg-background hover:bg-muted'}`}>
            <FiGrid className="size-3" /> Χαρτογράφηση πίνακα
          </button>
        </div>
        {markMode === 'field' ? (
          <span>Διάλεξε/πρόσθεσε πεδίο → «Σχεδίασε περιοχή» → η τιμή διαβάζεται αυτόματα → «Αποθήκευση πεδίων».</span>
        ) : (
          <span>Σχεδίασε πλαίσιο γύρω από ΟΛΟ τον πίνακα → το AI βγάζει labels + τιμές → διόρθωσε → «Δημιουργία πεδίων».</span>
        )}
      </div>

      {noSample ? (
        <div className="flex items-center justify-center p-10 text-center text-[12px] text-muted-foreground">
          <div><p className="font-semibold">Δεν υπάρχει δείγμα PDF.</p><p className="mt-1">Ανέβασε ένα δείγμα εντύπου πιο πάνω.</p></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* LEFT panel */}
          <div className="flex max-h-[660px] flex-col overflow-auto border-b border-border lg:border-b-0 lg:border-r">
            {/* Table review takes over the left panel when present */}
            {tableScan ? (
              <div className="flex flex-col">
                <div className="flex items-center justify-between border-b border-border bg-sisyphus-500/10 px-3 py-2">
                  <p className="text-[12px] font-semibold text-sisyphus-700">Έλεγχος πίνακα — {tableScan.rows.filter((r) => r.include).length}/{tableScan.rows.length} γραμμές</p>
                  <button type="button" onClick={() => { setTableScan(null); setTableRegion(null); }} className="text-[11px] text-muted-foreground hover:text-foreground">Άκυρο</button>
                </div>
                <p className="px-3 pt-2 text-[10px] text-muted-foreground">
                  Στήλες: {tableScan.columns.join(' · ') || '—'} · {tableScan.columns.length >= 2 ? 'θα γίνουν πεδία «σειρά ετών»' : 'μονή τιμή'}
                </p>
                <div className="flex flex-col divide-y divide-border">
                  {tableScan.rows.map((r, idx) => (
                    <div key={idx} className={`px-3 py-2 ${r.include ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={r.include} className="size-4 shrink-0"
                          onChange={(e) => setTableScan((prev) => prev ? { ...prev, rows: prev.rows.map((x, i) => i === idx ? { ...x, include: e.target.checked } : x) } : prev)} />
                        <input value={r.label} className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[12px]"
                          onChange={(e) => setTableScan((prev) => prev ? { ...prev, rows: prev.rows.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) } : prev)} />
                        <select value={r.valueType} className="h-7 rounded border border-input bg-background px-1 text-[11px]"
                          onChange={(e) => setTableScan((prev) => prev ? { ...prev, rows: prev.rows.map((x, i) => i === idx ? { ...x, valueType: e.target.value as ValueType } : x) } : prev)}>
                          {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>)}
                        </select>
                      </div>
                      <p className="mt-1 truncate pl-6 text-[10px] text-muted-foreground">{r.values.join('  ·  ') || '—'}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border p-3">
                  <button type="button" onClick={createFieldsFromTable}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600">
                    <FiPlus className="size-3.5" /> Δημιουργία πεδίων
                  </button>
                </div>
              </div>
            ) : fields.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                <p>Δεν υπάρχουν πεδία ακόμη.</p>
                <p className="mt-1">Χρησιμοποίησε «Προσθήκη πεδίου» ή «Χαρτογράφηση πίνακα».</p>
              </div>
            ) : (
              fields.map((f) => {
                const isSel = f.localId === selectedId;
                return (
                  <div key={f.localId} className={isSel ? 'bg-sisyphus-500/5' : ''}>
                    <button type="button" onClick={() => selectField(f.localId)}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${isSel ? 'border-l-2 border-sisyphus-500' : 'border-l-2 border-transparent'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-foreground">{f.label || <span className="italic text-muted-foreground">Χωρίς ετικέτα</span>}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{f.fieldKey || 'auto'} · {VALUE_TYPE_LABELS[f.valueType]}{f.kind === 'SERIES' ? ' · σειρά ετών' : ''}</span>
                      </span>
                      {f.regionHint ? (
                        <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: '#16a34a1a', color: '#15803d' }}>
                          <FiCheckCircle className="size-3" /> σελ.{f.regionHint.page + 1}
                        </span>
                      ) : <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">χωρίς περιοχή</span>}
                      <FiTrash2 className="size-3.5 shrink-0 text-muted-foreground hover:text-dg-red-500" onClick={(e) => { e.stopPropagation(); removeField(f.localId); }} />
                    </button>

                    {isSel && (
                      <div className="space-y-2.5 border-t border-border bg-background/60 px-3 py-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Κωδικός (προαιρ.)</span>
                            <input value={f.fieldKey} onChange={(e) => updateField(f.localId, { fieldKey: e.target.value })} placeholder="αυτόματο (λατινικά)" className="h-8 rounded-md border border-input bg-background px-2 text-[12px]" />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Ετικέτα *</span>
                            <input value={f.label} onChange={(e) => updateField(f.localId, { label: e.target.value })} placeholder="Κύκλος Εργασιών" className="h-8 rounded-md border border-input bg-background px-2 text-[12px]" />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Τύπος τιμής</span>
                            <select value={f.valueType} onChange={(e) => updateField(f.localId, { valueType: e.target.value as ValueType })} className="h-8 rounded-md border border-input bg-background px-1.5 text-[12px]">
                              {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>)}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-muted-foreground">Είδος</span>
                            <select value={f.kind} onChange={(e) => updateField(f.localId, { kind: e.target.value as Kind })} className="h-8 rounded-md border border-input bg-background px-1.5 text-[12px]">
                              <option value="SINGLE">Μονή τιμή</option>
                              <option value="SERIES">Σειρά ετών</option>
                            </select>
                          </label>
                        </div>

                        <button type="button" onClick={() => setIsMarking((m) => !m)}
                          className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
                            isMarking && markMode === 'field' ? 'border-sisyphus-500 bg-sisyphus-500 text-white' : 'border-sisyphus-500/50 bg-sisyphus-500/10 text-sisyphus-700 hover:bg-sisyphus-500/20'
                          }`}>
                          <FiTarget className="size-4" />
                          {isMarking && markMode === 'field' ? 'Σύρε πλαίσιο στο έγγραφο →' : f.regionHint ? 'Επανασχεδίαση περιοχής' : 'Σχεδίασε περιοχή στο έγγραφο'}
                        </button>

                        {f.regionHint && (
                          <div className="space-y-1.5">
                            <button type="button" onClick={() => scanRegion(f)} disabled={scanning}
                              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-[11px] font-semibold hover:bg-muted disabled:opacity-50">
                              {scanning ? 'Σκανάρισμα…' : '🔍 Σκάναρε περιοχή & δες τιμή'}
                            </button>
                            {scanResult && scanResult.localId === f.localId && (
                              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 text-[11px]">
                                {scanResult.kind === 'SINGLE' ? (
                                  <>
                                    <p className="text-muted-foreground">Τιμή που διαβάστηκε:</p>
                                    <p className="break-all font-mono text-[13px] font-bold text-emerald-700 dark:text-emerald-400">{scanResult.raw ?? '—'}</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="mb-1 text-muted-foreground">Σειρά ετών:</p>
                                    <table className="w-full text-[11px]">
                                      <tbody>
                                        {scanResult.series.length === 0 && <tr><td className="text-muted-foreground">—</td></tr>}
                                        {scanResult.series.map((p, i) => (
                                          <tr key={i}><td className="pr-2 font-semibold">{p.year ?? '—'}</td><td className="font-mono text-emerald-700 dark:text-emerald-400">{p.raw ?? '—'}</td></tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </>
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
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
              <div className="flex items-center gap-1">
                <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted"><FiChevronLeft className="size-4" /></button>
                <span className="min-w-[92px] text-center text-[12px] font-semibold tabular-nums">Σελίδα {page + 1} / {pageCount}</span>
                <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted"><FiChevronRight className="size-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                {(canDrawField || canDrawTable) && (
                  <button type="button" onClick={() => setIsMarking((m) => !m)}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold ${isMarking ? 'bg-sisyphus-500 text-white' : 'border border-sisyphus-500/50 bg-sisyphus-500/10 text-sisyphus-700 hover:bg-sisyphus-500/20'}`}>
                    <FiTarget className="size-3.5" /> {isMarking ? 'Ακύρωση σχεδίασης' : markMode === 'table' ? 'Σχεδίασε πίνακα' : 'Σχεδίασε περιοχή'}
                  </button>
                )}
                <button type="button" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted"><FiZoomOut className="size-4" /></button>
                <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button type="button" disabled={zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background disabled:opacity-40 hover:bg-muted"><FiZoomIn className="size-4" /></button>
              </div>
            </div>

            {isMarking && (canDrawField || canDrawTable) && (
              <div className="flex items-center gap-2 bg-sisyphus-500 px-3 py-1.5 text-[12px] font-semibold text-white">
                <FiTarget className="size-4 shrink-0" />
                {markMode === 'table' ? 'Σύρε ένα πλαίσιο γύρω από ΟΛΟ τον πίνακα' : `Σύρε ένα πλαίσιο γύρω από την τιμή για «${selected?.label || 'το πεδίο'}»`}
              </div>
            )}
            {scanningTable && <div className="bg-amber-500/15 px-3 py-1.5 text-[12px] font-semibold text-amber-700">Ανάλυση πίνακα με AI…</div>}
            {markMode === 'field' && !selected && (
              <div className="bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">Διάλεξε ή πρόσθεσε ένα πεδίο αριστερά για να σχεδιάσεις περιοχή.</div>
            )}

            <div className="max-h-[600px] flex-1 overflow-auto p-3">
              <div style={{ width: `${zoom * 100}%` }} className="mx-auto">
                <RegionMarker
                  pageImageUrl={pageImageUrl} pageCount={pageCount} page={page} showNav={false}
                  isMarking={isMarking && (canDrawField || canDrawTable)}
                  savedRegions={savedRegions} onRegionComplete={onRegionComplete} className="w-full"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
