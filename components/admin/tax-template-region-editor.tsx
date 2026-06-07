'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiTarget, FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut, FiGrid, FiRefreshCw, FiCheck, FiX, FiCode } from 'react-icons/fi';
import { RegionMarker } from '@/components/ui/region-marker';
import type { NormBox } from '@/app/admin/ocr/[id]/use-marquee';
import type { TemplateField } from '@/app/admin/tax-templates/[id]/editor';

export type ValueType = 'CURRENCY' | 'NUMBER' | 'PERCENT' | 'INTEGER' | 'DATE' | 'BOOLEAN';
type Kind = 'SINGLE' | 'SERIES' | 'TABLE';
type Region = { page: number; bbox: [number, number, number, number] };

const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  CURRENCY: 'Ποσό (€)', NUMBER: 'Αριθμός', PERCENT: 'Ποσοστό (%)',
  INTEGER: 'Ακέραιος', DATE: 'Ημερομηνία', BOOLEAN: 'Ναι/Όχι',
};

interface LocalField {
  localId: string; id?: string; fieldKey: string; label: string; section: string;
  valueType: ValueType; kind: Kind; config: { columns: string[] } | null; regionHint: Region | null; aiHint: string; required: boolean; order: number;
}

function makeLocal(f: TemplateField, idx: number): LocalField {
  return {
    localId: f.id ?? crypto.randomUUID(), id: f.id, fieldKey: f.fieldKey, label: f.label, section: f.section ?? '',
    valueType: f.valueType, kind: f.kind ?? 'SINGLE', config: f.config ?? null, regionHint: f.regionHint ?? null, aiHint: f.aiHint ?? '',
    required: f.required, order: f.order ?? idx,
  };
}

type ScanResult =
  | { localId: string; kind: 'SINGLE'; raw: string | null; value: number | null }
  | { localId: string; kind: 'SERIES'; series: { year: number | null; raw: string | null; value: number | null }[] };

interface TableReviewRow { label: string; code: string; values: string[]; include: boolean; valueType: ValueType; }
interface Props { templateId: string; initialFields: TemplateField[]; samplePageCount: number | null; }

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
  const [tableScan, setTableScan] = React.useState<{ name: string; columns: string[]; rows: TableReviewRow[]; headers: string[]; grid: string[][] } | null>(null);
  const [tableMode, setTableMode] = React.useState<'fields' | 'records'>('fields');
  const [scanningTable, setScanningTable] = React.useState(false);
  const [showJson, setShowJson] = React.useState(false);

  const pageCount = Math.max(1, samplePageCount ?? 1);
  const selected = fields.find((f) => f.localId === selectedId) ?? null;
  const noSample = samplePageCount == null;

  const pageImageUrl = React.useCallback(
    (p: number) => `/api/admin/tax-templates/${templateId}/page-image?scale=2&page=${p}`, [templateId]);

  function selectField(localId: string) {
    setSelectedId((cur) => (cur === localId ? null : localId));
    setScanResult(null); setIsMarking(false); setMarkMode('field');
    const f = fields.find((x) => x.localId === localId);
    if (f?.regionHint) setPage(f.regionHint.page);
  }

  function addField() {
    const localId = crypto.randomUUID();
    setFields((prev) => [...prev, { localId, fieldKey: '', label: '', section: '', valueType: 'CURRENCY', kind: 'SINGLE', config: null, regionHint: null, aiHint: '', required: false, order: prev.length }]);
    setSelectedId(localId); setMarkMode('field'); setIsMarking(false); setScanResult(null); setTableScan(null); setTableRegion(null);
  }

  function startTableMode() {
    setSelectedId(null); setScanResult(null); setMarkMode('table'); setTableScan(null); setTableRegion(null); setIsMarking(true);
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
    setScanning(true); setScanResult(null);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/test-field`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: f.label.trim(), valueType: f.valueType, kind: f.kind, aiHint: f.aiHint.trim() || undefined, regionHint: f.regionHint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      if (json.kind === 'SERIES') setScanResult({ localId: f.localId, kind: 'SERIES', series: json.series ?? [] });
      else setScanResult({ localId: f.localId, kind: 'SINGLE', raw: json.raw ?? null, value: json.value ?? null });
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setScanning(false); }
  }

  async function scanTableRegion(region: Region) {
    setScanningTable(true); setTableScan(null);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/scan-table`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regionHint: region }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const columns: string[] = Array.isArray(json.columns) ? json.columns : [];
      const rows: TableReviewRow[] = (Array.isArray(json.rows) ? json.rows : []).map((r: { label: string; code?: string; values: string[] }) => ({
        label: r.label ?? '', code: r.code ?? '', values: Array.isArray(r.values) ? r.values : [], include: true, valueType: 'CURRENCY' as ValueType,
      }));
      const headers: string[] = Array.isArray(json.headers) ? json.headers.map((h: unknown) => String(h)) : [];
      const grid: string[][] = Array.isArray(json.grid) ? json.grid.map((r: unknown) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [];
      // Heuristic: many text columns + no per-row codes ⇒ likely a records list (e.g. bank accounts).
      const looksRecords = headers.length >= 3 && rows.every((r) => !r.code) && columns.length >= 2;
      setTableMode(looksRecords ? 'records' : 'fields');
      setTableScan({ name: typeof json.name === 'string' ? json.name : '', columns, rows, headers, grid });
      if (rows.length === 0 && grid.length === 0) toast.error('Δεν εντοπίστηκαν γραμμές. Δοκίμασε πιο ακριβές πλαίσιο.');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setScanningTable(false); }
  }

  function onRegionComplete(box: NormBox, completedPage: number) {
    const region: Region = { page: completedPage, bbox: [box.x, box.y, box.w, box.h] };
    setIsMarking(false);
    if (markMode === 'table') { setTableRegion(region); void scanTableRegion(region); return; }
    if (!selectedId) return;
    updateField(selectedId, { regionHint: region });
    const f = fields.find((x) => x.localId === selectedId);
    if (f) void scanRegion({ ...f, regionHint: region });
  }

  function createFieldsFromTable() {
    if (!tableScan || !tableRegion) return;
    const kind: Kind = tableScan.columns.length >= 2 ? 'SERIES' : 'SINGLE';
    const rows = tableScan.rows.filter((r) => r.include && r.label.trim());
    if (rows.length === 0) { toast.error('Επίλεξε τουλάχιστον μία γραμμή.'); return; }
    setFields((prev) => [...prev, ...rows.map((r, i) => ({
      localId: crypto.randomUUID(), fieldKey: r.code.trim(), label: r.label.trim(), section: tableScan.name.trim(), valueType: r.valueType, kind, config: null, regionHint: tableRegion, aiHint: '', required: false, order: prev.length + i,
    } as LocalField))]);
    toast.success(`Δημιουργήθηκαν ${rows.length} πεδία. Πάτησε «Αποθήκευση».`);
    setTableScan(null); setTableRegion(null); setMarkMode('field');
  }

  function createTableField() {
    if (!tableScan || !tableRegion) return;
    const columns = tableScan.headers.filter((h) => h.trim());
    if (columns.length === 0) { toast.error('Δεν βρέθηκαν στήλες.'); return; }
    setFields((prev) => [...prev, {
      localId: crypto.randomUUID(), fieldKey: '', label: tableScan.name.trim() || 'Πίνακας', section: '',
      valueType: 'NUMBER', kind: 'TABLE', config: { columns }, regionHint: tableRegion, aiHint: '', required: false, order: prev.length,
    } as LocalField]);
    toast.success('Δημιουργήθηκε πεδίο πίνακα (λίστα εγγραφών). Πάτησε «Αποθήκευση».');
    setTableScan(null); setTableRegion(null); setMarkMode('field');
  }

  const savedRegions = fields.filter((f) => f.regionHint?.page === page).map((f) => ({ bbox: f.regionHint!.bbox, active: f.localId === selectedId }));
  if (markMode === 'table' && tableRegion && tableRegion.page === page) savedRegions.push({ bbox: tableRegion.bbox, active: true });

  async function saveFields() {
    if (fields.some((f) => !f.label.trim())) { toast.error('Κάθε πεδίο χρειάζεται Ετικέτα.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tax-templates/${templateId}/fields`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields.map((f, i) => ({
          fieldKey: f.fieldKey.trim() || undefined, label: f.label.trim(), section: f.section.trim() || undefined,
          valueType: f.valueType, kind: f.kind, config: f.config ?? undefined, regionHint: f.regionHint ?? undefined, aiHint: f.aiHint.trim() || undefined, required: f.required, order: i,
        }))),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const saved = Array.isArray(json) ? json : json?.fields;
      if (Array.isArray(saved)) setFields((prev) => prev.map((f, i) => {
        const s = saved[i] as { id?: string; fieldKey?: string } | undefined;
        return { ...f, id: s?.id ?? f.id, localId: s?.id ?? f.localId, fieldKey: s?.fieldKey ?? f.fieldKey };
      }));
      toast.success('Αποθηκεύτηκε.');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setSaving(false); }
  }

  const markedCount = fields.filter((f) => f.regionHint).length;
  const banner = scanningTable ? { text: 'Ανάλυση πίνακα με AI…', tone: 'amber' as const }
    : isMarking && markMode === 'table' ? { text: 'Σύρε πλαίσιο γύρω από ΟΛΟ τον πίνακα', tone: 'blue' as const }
    : isMarking && markMode === 'field' ? { text: `Σύρε πλαίσιο γύρω από την τιμή για «${selected?.label || 'το πεδίο'}»`, tone: 'blue' as const }
    : null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Χαρτογράφηση εντύπου</h2>
          <p className="text-[11px] text-muted-foreground">{fields.length} πεδία · {markedCount} με περιοχή</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowJson((v) => !v)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition ${showJson ? 'bg-sisyphus-500/10 text-sisyphus-700' : 'text-muted-foreground hover:bg-muted'}`}>
            <FiCode className="size-3.5" /> JSON
          </button>
          <button type="button" onClick={saveFields} disabled={saving || fields.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sisyphus-500 px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 disabled:opacity-50">
            <FiSave className="size-3.5" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </header>

      {showJson && (
        <div className="border-b border-border bg-muted/20 p-3">
          <pre className="max-h-64 overflow-auto rounded-lg bg-background p-3 text-[10px] leading-relaxed text-foreground">{JSON.stringify(fields.map((f) => ({ fieldKey: f.fieldKey.trim() || '(auto)', label: f.label, kind: f.kind, valueType: f.valueType, section: f.section || undefined, region: f.regionHint ? { page: f.regionHint.page + 1, bbox: f.regionHint.bbox.map((v) => +v.toFixed(3)) } : null })), null, 2)}</pre>
        </div>
      )}

      {noSample ? (
        <div className="p-12 text-center text-[12px] text-muted-foreground">
          <p className="font-semibold text-foreground">Δεν υπάρχει δείγμα PDF</p>
          <p className="mt-1">Ανέβασε ένα δείγμα εντύπου πιο πάνω για να ξεκινήσεις.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* DOCUMENT — the workspace */}
          <div className="flex flex-col border-b border-border bg-[color:var(--muted)]/30 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-1">
                <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"><FiChevronLeft className="size-4" /></button>
                <span className="min-w-[96px] text-center text-[12px] font-medium tabular-nums">Σελίδα {page + 1} / {pageCount}</span>
                <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"><FiChevronRight className="size-4" /></button>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"><FiZoomOut className="size-4" /></button>
                <span className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button type="button" disabled={zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"><FiZoomIn className="size-4" /></button>
              </div>
            </div>
            {banner && (
              <div className={`flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-white ${banner.tone === 'amber' ? 'bg-amber-500' : 'bg-sisyphus-500'}`}>
                <FiTarget className="size-4 shrink-0" />
                <span className="flex-1">{banner.text}</span>
                {isMarking && (
                  <button type="button" onClick={() => setIsMarking(false)} className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] hover:bg-white/30">Άκυρο</button>
                )}
              </div>
            )}
            <div className="max-h-[620px] min-h-[360px] flex-1 overflow-auto p-4">
              <div style={{ width: `${zoom * 100}%` }} className="mx-auto rounded-lg bg-white shadow-sm ring-1 ring-border">
                <RegionMarker pageImageUrl={pageImageUrl} pageCount={pageCount} page={page} showNav={false}
                  isMarking={isMarking && (markMode === 'table' || !!selected)} savedRegions={savedRegions}
                  onRegionComplete={onRegionComplete} className="w-full" />
              </div>
            </div>
          </div>

          {/* INSPECTOR — one thing at a time */}
          <aside className="flex max-h-[700px] flex-col overflow-auto">
            {tableScan ? (
              /* ---- Table review ---- */
              <div className="flex flex-col">
                <div className="border-b border-border px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-foreground">Έλεγχος πίνακα</p>
                    <button type="button" onClick={() => { setTableScan(null); setTableRegion(null); }} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><FiX className="size-4" /></button>
                  </div>
                  <input value={tableScan.name} onChange={(e) => setTableScan((p) => p ? { ...p, name: e.target.value } : p)}
                    placeholder="Όνομα πίνακα (π.χ. Απασχολούμενο Προσωπικό)" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[12px] font-semibold" />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Στήλες: {tableScan.columns.join(' · ') || '—'}{tableScan.columns.length >= 2 ? ' · σειρά ετών' : ''} · ο κωδικός γίνεται το κλειδί</p>
                  <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-input text-[11px]">
                    <button type="button" onClick={() => setTableMode('fields')} className={`px-2.5 py-1 font-semibold ${tableMode === 'fields' ? 'bg-sisyphus-500 text-white' : 'bg-background hover:bg-muted'}`}>Γραμμές → πεδία</button>
                    <button type="button" onClick={() => setTableMode('records')} className={`px-2.5 py-1 font-semibold ${tableMode === 'records' ? 'bg-sisyphus-500 text-white' : 'bg-background hover:bg-muted'}`}>Λίστα εγγραφών</button>
                  </div>
                </div>
                {tableMode === 'fields' ? (
                  <>
                    <div className="flex-1 divide-y divide-border overflow-auto">
                      {tableScan.rows.map((r, idx) => (
                        <div key={idx} className={`flex items-start gap-2 px-4 py-2.5 ${r.include ? '' : 'opacity-40'}`}>
                          <input type="checkbox" checked={r.include} className="mt-1.5 size-4 shrink-0 accent-sisyphus-500"
                            onChange={(e) => setTableScan((p) => p ? { ...p, rows: p.rows.map((x, i) => i === idx ? { ...x, include: e.target.checked } : x) } : p)} />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex gap-1.5">
                              <input value={r.code} placeholder="code" className="h-8 w-14 shrink-0 rounded-lg border border-input bg-background px-1.5 text-center text-[11px] font-semibold"
                                onChange={(e) => setTableScan((p) => p ? { ...p, rows: p.rows.map((x, i) => i === idx ? { ...x, code: e.target.value } : x) } : p)} />
                              <input value={r.label} placeholder="ετικέτα" className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-[12px]"
                                onChange={(e) => setTableScan((p) => p ? { ...p, rows: p.rows.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) } : p)} />
                            </div>
                            <p className="truncate text-[10px] text-muted-foreground">{r.values.join('  ·  ') || '—'}</p>
                          </div>
                          <select value={r.valueType} className="mt-0.5 h-8 shrink-0 rounded-lg border border-input bg-background px-1.5 text-[11px]"
                            onChange={(e) => setTableScan((p) => p ? { ...p, rows: p.rows.map((x, i) => i === idx ? { ...x, valueType: e.target.value as ValueType } : x) } : p)}>
                            {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border p-4">
                      <button type="button" onClick={createFieldsFromTable} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600">
                        <FiCheck className="size-4" /> Δημιουργία {tableScan.rows.filter((r) => r.include).length} πεδίων
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-1 overflow-auto p-3">
                      <p className="mb-2 text-[11px] text-muted-foreground">Ένα πεδίο-πίνακας με στήλες: <span className="font-semibold text-foreground">{tableScan.headers.join(' · ') || '—'}</span>. Κάθε εγγραφή θα αποθηκεύεται ως αντικείμενο.</p>
                      <div className="overflow-auto rounded-lg border border-border">
                        <table className="w-full text-[10px]">
                          <thead className="bg-muted/60"><tr>{tableScan.headers.map((h, i) => <th key={i} className="px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                          <tbody>
                            {tableScan.grid.slice(0, 20).map((row, ri) => (
                              <tr key={ri} className="border-t border-border">{tableScan.headers.map((_, ci) => <td key={ci} className="truncate px-2 py-1">{row[ci] ?? ''}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {tableScan.grid.length > 20 && <p className="mt-1 text-[10px] text-muted-foreground">…και {tableScan.grid.length - 20} ακόμη γραμμές</p>}
                    </div>
                    <div className="border-t border-border p-4">
                      <button type="button" onClick={createTableField} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600">
                        <FiCheck className="size-4" /> Δημιουργία πεδίου-πίνακα
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selected ? (
              /* ---- Field inspector ---- */
              <div className="flex flex-col">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-[13px] font-semibold text-foreground">Πεδίο</p>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => removeField(selected.localId)} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>
                    <button type="button" onClick={() => setSelectedId(null)} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><FiX className="size-4" /></button>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Ετικέτα</span>
                    <input value={selected.label} onChange={(e) => updateField(selected.localId, { label: e.target.value })} placeholder="π.χ. Κύκλος Εργασιών" autoFocus
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px]" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Τύπος</span>
                      <select value={selected.valueType} onChange={(e) => updateField(selected.localId, { valueType: e.target.value as ValueType })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[12px]">
                        {(Object.keys(VALUE_TYPE_LABELS) as ValueType[]).map((vt) => <option key={vt} value={vt}>{VALUE_TYPE_LABELS[vt]}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Είδος</span>
                      <select value={selected.kind} onChange={(e) => updateField(selected.localId, { kind: e.target.value as Kind })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[12px]">
                        <option value="SINGLE">Μονή τιμή</option>
                        <option value="SERIES">Σειρά ετών</option>
                        <option value="TABLE">Πίνακας (εγγραφές)</option>
                      </select>
                    </label>
                  </div>

                  {/* Region + value */}
                  {selected.kind === 'TABLE' ? (
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">Πίνακας εγγραφών{selected.regionHint ? ` (σελ. ${selected.regionHint.page + 1})` : ''}</span>
                        {selected.regionHint && (
                          <button type="button" title="Διαγραφή περιοχής" onClick={() => updateField(selected.localId, { regionHint: null })} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>
                        )}
                      </div>
                      <p className="mb-1 text-[10px] text-muted-foreground">Στήλες:</p>
                      <div className="flex flex-wrap gap-1">
                        {(selected.config?.columns ?? []).map((c, i) => <span key={i} className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-border">{c}</span>)}
                        {(selected.config?.columns?.length ?? 0) === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                      </div>
                    </div>
                  ) : !selected.regionHint ? (
                    <button type="button" onClick={() => { setMarkMode('field'); setIsMarking((m) => !m); }}
                      className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[12px] font-semibold transition ${isMarking && markMode === 'field' ? 'bg-sisyphus-500 text-white' : 'bg-sisyphus-500/10 text-sisyphus-700 hover:bg-sisyphus-500/20'}`}>
                      <FiTarget className="size-4" /> {isMarking && markMode === 'field' ? 'Σύρε πλαίσιο στο έγγραφο →' : 'Σχεδίασε περιοχή'}
                    </button>
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted-foreground">Τιμή (σελ. {selected.regionHint.page + 1})</span>
                        <div className="flex items-center gap-0.5">
                          <button type="button" title="Ξανά" onClick={() => scanRegion(selected)} disabled={scanning} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50"><FiRefreshCw className={`size-3.5 ${scanning ? 'animate-spin' : ''}`} /></button>
                          <button type="button" title="Επανασχεδίαση" onClick={() => { setMarkMode('field'); setIsMarking(true); }} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><FiTarget className="size-3.5" /></button>
                          <button type="button" title="Διαγραφή" onClick={() => { updateField(selected.localId, { regionHint: null }); setScanResult(null); setIsMarking(false); }} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>
                        </div>
                      </div>
                      {scanning ? (
                        <p className="text-[12px] text-muted-foreground">Ανάγνωση…</p>
                      ) : scanResult && scanResult.localId === selected.localId ? (
                        scanResult.kind === 'SINGLE' ? (
                          <p className="break-all font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-400">{scanResult.raw ?? '—'}</p>
                        ) : (
                          <table className="w-full text-[12px]"><tbody>
                            {scanResult.series.length === 0 && <tr><td className="text-muted-foreground">—</td></tr>}
                            {scanResult.series.map((p, i) => (<tr key={i}><td className="pr-3 font-semibold text-muted-foreground">{p.year ?? '—'}</td><td className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{p.raw ?? '—'}</td></tr>))}
                          </tbody></table>
                        )
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Πάτησε <FiRefreshCw className="inline size-3" /> για ανάγνωση τιμής.</p>
                      )}
                    </div>
                  )}

                  {/* Advanced */}
                  <details className="group rounded-lg border border-border">
                    <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-muted-foreground">Περισσότερα</summary>
                    <div className="space-y-2.5 border-t border-border p-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Κωδικός (αυτόματο αν κενό)</span>
                        <input value={selected.fieldKey} onChange={(e) => updateField(selected.localId, { fieldKey: e.target.value })} placeholder="kyklos_ergasion" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[12px]" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Ενότητα</span>
                        <input value={selected.section} onChange={(e) => updateField(selected.localId, { section: e.target.value })} placeholder="π.χ. Πίνακας Β'" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[12px]" />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <input type="checkbox" checked={selected.required} onChange={(e) => updateField(selected.localId, { required: e.target.checked })} className="size-4 accent-sisyphus-500" />
                        <span className="text-muted-foreground">Υποχρεωτικό πεδίο</span>
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              /* ---- Default: actions + field list ---- */
              <div className="flex flex-col">
                <div className="grid grid-cols-2 gap-2 p-4">
                  <button type="button" onClick={addField} className="flex flex-col items-center gap-1.5 rounded-xl border border-sisyphus-500/40 bg-sisyphus-500/5 px-3 py-4 text-center hover:bg-sisyphus-500/10">
                    <FiPlus className="size-5 text-sisyphus-600" />
                    <span className="text-[12px] font-semibold text-foreground">Νέο πεδίο</span>
                    <span className="text-[10px] text-muted-foreground">μία τιμή</span>
                  </button>
                  <button type="button" onClick={startTableMode} className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-4 text-center hover:bg-muted">
                    <FiGrid className="size-5 text-muted-foreground" />
                    <span className="text-[12px] font-semibold text-foreground">Πίνακας</span>
                    <span className="text-[10px] text-muted-foreground">πολλές γραμμές</span>
                  </button>
                </div>
                <div className="border-t border-border">
                  {fields.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">Κανένα πεδίο ακόμη.<br />Ξεκίνα με «Νέο πεδίο» ή «Πίνακας».</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {fields.map((f) => (
                        <li key={f.localId}>
                          <button type="button" onClick={() => selectField(f.localId)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/60">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-semibold text-foreground">{f.label || <span className="italic text-muted-foreground">Χωρίς ετικέτα</span>}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{f.kind === 'TABLE' ? `πίνακας · ${f.config?.columns.length ?? 0} στήλες` : `${VALUE_TYPE_LABELS[f.valueType]}${f.kind === 'SERIES' ? ' · σειρά ετών' : ''}`}</span>
                            </span>
                            <span className={`inline-flex size-2 shrink-0 rounded-full ${f.regionHint ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} title={f.regionHint ? `σελ. ${f.regionHint.page + 1}` : 'χωρίς περιοχή'} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
