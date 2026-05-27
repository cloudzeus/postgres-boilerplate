'use client';

import * as React from 'react';
import {
  FiUploadCloud, FiCheck, FiX, FiAlertTriangle, FiArrowRight, FiArrowLeft,
  FiFile, FiTrash2, FiRefreshCw, FiGrid, FiSettings, FiPlay, FiInbox,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

// ============================================================
// Types
// ============================================================

type CellValue = string | number | boolean | null;
type Sheet = { name: string; totalRows: number; totalCols: number; rows: CellValue[][]; truncated: boolean };
type ParseResult = { fileName: string; sheets: Sheet[] };
type Entity = {
  key: string; label: string; description?: string; permission: string; canCommit: boolean;
  fields: { key: string; label: string; type: string; required?: boolean; uniqueKey?: boolean; sample?: string }[];
};
type Mapping = Record<string, number | null>;   // target field key → source column index
type Step = 1 | 2 | 3 | 4 | 5;

// ============================================================
// Wizard
// ============================================================

export function ExcelImportWizard() {
  const [step, setStep] = React.useState<Step>(1);
  const [parsing, setParsing] = React.useState(false);
  const [parsed, setParsed] = React.useState<ParseResult | null>(null);
  const [sheetIdx, setSheetIdx] = React.useState(0);

  const [headerRow, setHeaderRow] = React.useState(1);       // 1-indexed
  const [dataStartRow, setDataStartRow] = React.useState(2);
  const [excludedRows, setExcludedRows] = React.useState<Set<number>>(new Set());
  const [excludedCols, setExcludedCols] = React.useState<Set<number>>(new Set());
  const [dedupe, setDedupe] = React.useState(false);
  const [dedupeCol, setDedupeCol] = React.useState<number | null>(null);
  const [trimEmpty, setTrimEmpty] = React.useState(true);

  const [entities, setEntities] = React.useState<Entity[]>([]);
  const [entityKey, setEntityKey] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>({});
  const [mode, setMode] = React.useState<'insert' | 'upsert'>('upsert');
  const [meta, setMeta] = React.useState<Record<string, any>>({});

  const [committing, setCommitting] = React.useState(false);
  const [result, setResult] = React.useState<{ total: number; inserted: number; updated: number; failed: { row: number; reason: string }[] } | null>(null);

  React.useEffect(() => {
    fetch('/api/admin/imports/entities').then((r) => r.json()).then((d) => setEntities(d.entities ?? []));
  }, []);

  const sheet = parsed?.sheets[sheetIdx] ?? null;
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  // ----- Cleaned data preview -----
  const cleaned = React.useMemo(() => {
    if (!sheet) return { headers: [] as string[], rows: [] as CellValue[][], colIdx: [] as number[] };
    const allCols = sheet.rows[0]?.length ?? 0;
    const colIdx = Array.from({ length: allCols }).map((_, i) => i).filter((i) => !excludedCols.has(i));
    const headerRaw = sheet.rows[headerRow - 1] ?? [];
    const headers = colIdx.map((i) => headerRaw[i] != null ? String(headerRaw[i]) : `Col ${i + 1}`);
    let dataRows = sheet.rows
      .slice(dataStartRow - 1)
      .map((row, i) => ({ row, originalIdx: dataStartRow - 1 + i }))
      .filter(({ originalIdx }) => !excludedRows.has(originalIdx))
      .map(({ row }) => colIdx.map((i) => row[i] ?? null));
    if (trimEmpty) {
      dataRows = dataRows.filter((r) => r.some((c) => c !== null && c !== ''));
    }
    if (dedupe && dedupeCol != null) {
      const visibleColPos = colIdx.indexOf(dedupeCol);
      if (visibleColPos >= 0) {
        const seen = new Set<string>();
        dataRows = dataRows.filter((r) => {
          const k = String(r[visibleColPos] ?? '');
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
      }
    }
    return { headers, rows: dataRows, colIdx };
  }, [sheet, headerRow, dataStartRow, excludedRows, excludedCols, trimEmpty, dedupe, dedupeCol]);

  // ----- Upload -----
  const upload = async (file: File) => {
    setParsing(true);
    setResult(null);
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/admin/imports/parse', { method: 'POST', body: fd });
    setParsing(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'too_large' ? 'Πολύ μεγάλο (max 10MB)' : `Αποτυχία parse: ${e.message ?? e.error}`);
      return;
    }
    const d = await res.json() as ParseResult;
    setParsed(d);
    setSheetIdx(0);
    setHeaderRow(1); setDataStartRow(2);
    setExcludedRows(new Set()); setExcludedCols(new Set());
    setDedupe(false); setDedupeCol(null);
    setStep(2);
  };

  // ----- Commit -----
  const commit = async () => {
    if (!entity) return;
    setCommitting(true);
    // Map cleaned rows to entity payload using `mapping`
    const payloadRows = cleaned.rows.map((row) => {
      const out: Record<string, any> = {};
      for (const [fieldKey, sourceIdxAbs] of Object.entries(mapping)) {
        if (sourceIdxAbs == null) continue;
        const visiblePos = cleaned.colIdx.indexOf(sourceIdxAbs);
        if (visiblePos < 0) continue;
        out[fieldKey] = row[visiblePos];
      }
      return out;
    });
    const res = await fetch('/api/admin/imports/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityKey: entity.key, mode, rows: payloadRows,
        fileName: parsed?.fileName, meta,
      }),
    });
    setCommitting(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error || 'Αποτυχία εισαγωγής');
      return;
    }
    const d = await res.json();
    setResult(d);
    toast.success(`Εισήχθησαν: ${d.inserted} νέες · ${d.updated} updates · ${d.failed.length} αποτυχίες`);
    setStep(5);
  };

  // ----- Navigation -----
  const canGoNext: Record<Step, boolean> = {
    1: !!parsed,
    2: !!sheet && headerRow >= 1 && dataStartRow > headerRow,
    3: cleaned.rows.length > 0,
    4: !!entity && entity.canCommit && Object.values(mapping).some((v) => v != null) && (entity.key !== 'company' || !!meta.defaultTypeId),
    5: false,
  };

  return (
    <div className="space-y-4">
      <Stepper step={step} setStep={setStep} canGoNext={canGoNext} />

      {step === 1 && <StepUpload onUpload={upload} parsing={parsing} parsed={parsed} />}
      {step === 2 && sheet && (
        <StepHeadersRows
          parsed={parsed!}
          sheetIdx={sheetIdx} setSheetIdx={setSheetIdx}
          headerRow={headerRow} setHeaderRow={setHeaderRow}
          dataStartRow={dataStartRow} setDataStartRow={setDataStartRow}
          excludedRows={excludedRows} setExcludedRows={setExcludedRows}
          excludedCols={excludedCols} setExcludedCols={setExcludedCols}
        />
      )}
      {step === 3 && sheet && (
        <StepCleanup
          cleaned={cleaned}
          trimEmpty={trimEmpty} setTrimEmpty={setTrimEmpty}
          dedupe={dedupe} setDedupe={setDedupe}
          dedupeCol={dedupeCol} setDedupeCol={setDedupeCol}
          excludedCols={excludedCols}
          totalCols={sheet.totalCols}
        />
      )}
      {step === 4 && (
        <StepMap
          entities={entities} entityKey={entityKey} setEntityKey={(k: string) => { setEntityKey(k); setMapping({}); setMeta({}); }}
          entity={entity}
          cleaned={cleaned}
          mapping={mapping} setMapping={setMapping}
          mode={mode} setMode={setMode}
          meta={meta} setMeta={setMeta}
        />
      )}
      {step === 5 && result && <StepResult result={result} entity={entity} onReset={() => { setStep(1); setParsed(null); setResult(null); setMapping({}); setEntityKey(null); }} />}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(1, s - 1) as Step)} disabled={step === 1 || committing}>
          <FiArrowLeft className="mr-1" /> Πίσω
        </Button>
        {step === 4 ? (
          <Button onClick={commit} disabled={!canGoNext[4] || committing}>
            <FiPlay className="mr-1" /> {committing ? 'Εισαγωγή…' : `Εκτέλεση εισαγωγής (${cleaned.rows.length} γραμμές)`}
          </Button>
        ) : step < 5 ? (
          <Button onClick={() => setStep((s) => Math.min(5, s + 1) as Step)} disabled={!canGoNext[step]}>
            Επόμενο <FiArrowRight className="ml-1" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ============================================================
// Step components
// ============================================================

function Stepper({ step, setStep, canGoNext }: { step: Step; setStep: (s: Step) => void; canGoNext: Record<Step, boolean> }) {
  const steps: { id: Step; label: string; icon: any }[] = [
    { id: 1, label: 'Αρχείο', icon: FiUploadCloud },
    { id: 2, label: 'Κεφαλίδες & γραμμές', icon: FiGrid },
    { id: 3, label: 'Καθαρισμός', icon: FiSettings },
    { id: 4, label: 'Οντότητα & mapping', icon: FiInbox },
    { id: 5, label: 'Αποτελέσματα', icon: FiCheck },
  ];
  return (
    <ol className="flex items-center gap-1">
      {steps.map((s, i) => {
        const active = step === s.id;
        const done = step > s.id;
        const reachable = s.id <= step || (s.id === step + 1 && canGoNext[step]);
        return (
          <React.Fragment key={s.id}>
            <li>
              <button
                type="button"
                onClick={() => reachable && setStep(s.id)}
                disabled={!reachable}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[4px] text-[12px] transition-colors ${
                  active ? 'bg-primary/10 text-foreground border border-primary'
                  : done ? 'text-foreground hover:bg-muted border border-transparent'
                  : 'text-muted-foreground border border-transparent'
                }`}
              >
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  active ? 'bg-primary text-primary-foreground' : done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
                }`}>
                  {done ? <FiCheck className="size-3" /> : s.id}
                </span>
                {s.label}
              </button>
            </li>
            {i < steps.length - 1 && <li className="text-muted-foreground/50">›</li>}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function StepUpload({ onUpload, parsing, parsed }: { onUpload: (f: File) => void; parsing: boolean; parsed: ParseResult | null }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        const f = e.dataTransfer.files?.[0]; if (f) onUpload(f);
      }}
      className={`rounded-md border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
        dragOver ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
      }`}
      onClick={() => fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />
      <FiUploadCloud className="mx-auto size-10 text-muted-foreground/60 mb-3" />
      <p className="text-[13px] font-medium text-foreground mb-1">Σύρε εδώ Excel αρχείο ή κάνε κλικ για επιλογή</p>
      <p className="text-[11px] text-muted-foreground">.xlsx / .xls — μέχρι 10MB, 10.000 γραμμές ανά φύλλο</p>
      {parsing && <p className="text-[12px] text-primary mt-3">Επεξεργασία…</p>}
      {parsed && !parsing && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[4px] border border-border bg-background px-3 py-1.5">
          <FiFile className="text-primary" />
          <span className="text-[12px] font-medium">{parsed.fileName}</span>
          <Badge variant="outline">{parsed.sheets.length} φύλλα</Badge>
        </div>
      )}
    </div>
  );
}

function StepHeadersRows({
  parsed, sheetIdx, setSheetIdx,
  headerRow, setHeaderRow, dataStartRow, setDataStartRow,
  excludedRows, setExcludedRows, excludedCols, setExcludedCols,
}: any) {
  const sheet: Sheet = parsed.sheets[sheetIdx];
  const previewRows = sheet.rows.slice(0, 30);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="sheet" className="text-[11px]">Φύλλο</Label>
          <select id="sheet" className="h-8 rounded-sm border border-input bg-background px-2 text-[12px]"
            value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
            {parsed.sheets.map((s: Sheet, i: number) => (
              <option key={i} value={i}>{s.name} ({s.totalRows}×{s.totalCols})</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="hr" className="text-[11px]">Γραμμή κεφαλίδων</Label>
          <Input id="hr" type="number" min={1} max={sheet.totalRows} value={headerRow}
            onChange={(e) => setHeaderRow(Number(e.target.value))} className="h-8 w-[100px] tabular-nums" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="dr" className="text-[11px]">Πρώτη γραμμή δεδομένων</Label>
          <Input id="dr" type="number" min={headerRow + 1} max={sheet.totalRows} value={dataStartRow}
            onChange={(e) => setDataStartRow(Number(e.target.value))} className="h-8 w-[100px] tabular-nums" />
        </div>
        <div className="text-[11px] text-muted-foreground self-end pb-1.5">
          Κλικ στους αριθμούς γραμμών/στηλών για εξαίρεση. Εξαιρ.: {excludedRows.size} γραμμές · {excludedCols.size} στήλες
        </div>
      </div>

      <div className="overflow-auto rounded-md border border-border max-h-[480px]">
        <table className="text-[11px]">
          <thead className="sticky top-0 bg-muted z-10">
            <tr>
              <th className="px-2 py-1 border-r border-border w-10"></th>
              {(sheet.rows[0] ?? []).map((_: any, ci: number) => {
                const excluded = excludedCols.has(ci);
                return (
                  <th key={ci} className="px-2 py-1 border-r border-border whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(excludedCols);
                        excluded ? next.delete(ci) : next.add(ci);
                        setExcludedCols(next);
                      }}
                      className={`font-medium hover:text-destructive ${excluded ? 'line-through text-destructive' : 'text-muted-foreground'}`}
                    >
                      {colLetter(ci)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => {
              const absRow = ri;
              const isHeader = absRow + 1 === headerRow;
              const isData = absRow + 1 >= dataStartRow;
              const isExcluded = excludedRows.has(absRow);
              return (
                <tr key={ri} className={`${isHeader ? 'bg-blue-50/70 dark:bg-blue-950/30 font-semibold' : ''} ${isExcluded ? 'opacity-30 line-through' : ''}`}>
                  <td className="px-2 py-1 border-r border-border text-center sticky left-0 bg-inherit">
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(excludedRows);
                        isExcluded ? next.delete(absRow) : next.add(absRow);
                        setExcludedRows(next);
                      }}
                      title="Toggle exclude row"
                      className={`text-[10px] tabular-nums ${isExcluded ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                    >
                      {ri + 1}
                    </button>
                  </td>
                  {row.map((cell, ci) => {
                    const colExcl = excludedCols.has(ci);
                    return (
                      <td key={ci} className={`px-2 py-1 border-r border-border max-w-[200px] truncate ${colExcl ? 'opacity-30' : ''} ${isData && !colExcl ? '' : 'text-muted-foreground'}`}>
                        {cell == null ? '' : String(cell)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sheet.truncated && (
        <p className="text-[11px] text-amber-700"><FiAlertTriangle className="inline mr-1" /> Το φύλλο έχει {sheet.totalRows} γραμμές — εμφανίζονται/προωθούνται οι πρώτες 10.000.</p>
      )}
    </div>
  );
}

function StepCleanup({
  cleaned, trimEmpty, setTrimEmpty, dedupe, setDedupe, dedupeCol, setDedupeCol, excludedCols, totalCols,
}: any) {
  const visibleCols = Array.from({ length: totalCols }).map((_, i) => i).filter((i) => !excludedCols.has(i));
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border p-3 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={trimEmpty} onCheckedChange={(v) => setTrimEmpty(!!v)} />
          <span className="text-[12px]">Αφαίρεση εντελώς κενών γραμμών</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={dedupe} onCheckedChange={(v) => setDedupe(!!v)} />
          <span className="text-[12px]">Διπλότυπα με βάση τη στήλη:</span>
          <select
            className="h-7 rounded-sm border border-input bg-background px-2 text-[12px]"
            disabled={!dedupe}
            value={dedupeCol ?? ''}
            onChange={(e) => setDedupeCol(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">— Επίλεξε —</option>
            {visibleCols.map((i) => <option key={i} value={i}>{colLetter(i)}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-md border border-border overflow-auto max-h-[420px]">
        <table className="text-[11px] w-full">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="px-2 py-1 border-r border-border w-10">#</th>
              {cleaned.headers.map((h: string, i: number) => (
                <th key={i} className="px-2 py-1 border-r border-border text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cleaned.rows.slice(0, 100).map((r: CellValue[], ri: number) => (
              <tr key={ri} className="border-b border-border">
                <td className="px-2 py-1 border-r border-border text-muted-foreground tabular-nums">{ri + 1}</td>
                {r.map((c, ci) => (
                  <td key={ci} className="px-2 py-1 border-r border-border max-w-[200px] truncate">{c == null ? '' : String(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Καθαρισμένες γραμμές: <strong>{cleaned.rows.length}</strong> · στήλες: <strong>{cleaned.headers.length}</strong>
        {cleaned.rows.length > 100 && ' (εμφάνιση πρώτων 100)'}
      </p>
    </div>
  );
}

function StepMap({
  entities, entityKey, setEntityKey, entity, cleaned, mapping, setMapping, mode, setMode, meta, setMeta,
}: any) {
  // Auto-map by name similarity when entity changes
  React.useEffect(() => {
    if (!entity || cleaned.headers.length === 0) return;
    const normalized = (s: string) => s.toLowerCase().replace(/[\s_\-·()\.]/g, '');
    const next: Mapping = {};
    for (const f of entity.fields as Entity['fields']) {
      const labelN = normalized(f.label);
      const keyN = normalized(f.key);
      const idx = cleaned.headers.findIndex((h: string) => {
        const hn = normalized(String(h));
        return hn === labelN || hn === keyN || hn.includes(keyN) || labelN.includes(hn);
      });
      next[f.key] = idx >= 0 ? cleaned.colIdx[idx] : null;
    }
    setMapping(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, cleaned.headers.join('|')]);

  const [companyTypes, setCompanyTypes] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    if (entity?.key !== 'company') return;
    fetch('/api/admin/company-types').then((r) => r.json()).then((d) => setCompanyTypes(d.types ?? []));
  }, [entity?.key]);

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      {/* Entity picker */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Οντότητα</div>
        <div className="space-y-1">
          {entities.map((e: Entity) => (
            <button
              key={e.key} type="button"
              disabled={!e.canCommit}
              onClick={() => setEntityKey(e.key)}
              className={`w-full text-left rounded-[4px] border p-2 transition-colors ${
                entityKey === e.key ? 'border-primary bg-primary/5'
                : e.canCommit ? 'border-border hover:bg-muted'
                : 'border-border opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="text-[12px] font-medium text-foreground">{e.label}</div>
              {e.description && <div className="text-[10px] text-muted-foreground">{e.description}</div>}
              {!e.canCommit && <div className="text-[10px] text-amber-700">Λείπει δικαίωμα: {e.permission}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Mapping */}
      <div className="space-y-3">
        {!entity && <p className="text-[12px] text-muted-foreground">Επίλεξε οντότητα αριστερά.</p>}
        {entity && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 bg-muted/30">
              <div>
                <Label className="text-[11px]">Τρόπος εισαγωγής</Label>
                <select
                  className="h-8 rounded-sm border border-input bg-background px-2 text-[12px] ml-2"
                  value={mode} onChange={(e) => setMode(e.target.value as any)}
                >
                  <option value="upsert">Upsert (ενημέρωση αν υπάρχει)</option>
                  <option value="insert">Insert μόνο (skip duplicates)</option>
                </select>
              </div>
              {entity.key === 'company' && (
                <div>
                  <Label className="text-[11px]">Τύπος εταιρίας *</Label>
                  <select
                    className="h-8 rounded-sm border border-input bg-background px-2 text-[12px] ml-2"
                    value={meta.defaultTypeId ?? ''} onChange={(e) => setMeta({ ...meta, defaultTypeId: e.target.value || undefined })}
                  >
                    <option value="">— Επίλεξε τύπο —</option>
                    {companyTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="rounded-md border border-border">
              <div className="grid grid-cols-[1fr_24px_1fr] items-center gap-3 px-3 py-1.5 bg-muted border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                <div>Πεδίο εφαρμογής</div>
                <div></div>
                <div>Στήλη Excel</div>
              </div>
              <ul className="divide-y divide-border">
                {entity.fields.map((f: Entity['fields'][number]) => (
                  <li key={f.key} className="grid grid-cols-[1fr_24px_1fr] items-center gap-3 px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-foreground truncate flex items-center gap-1">
                        {f.label}
                        {f.required && <span className="text-destructive">*</span>}
                        {f.uniqueKey && <Badge variant="outline" className="text-[9px]">key</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{f.key} · {f.type}{f.sample ? ` · π.χ. ${f.sample}` : ''}</div>
                    </div>
                    <div className="text-muted-foreground text-center">←</div>
                    <select
                      className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[12px]"
                      value={mapping[f.key] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                    >
                      <option value="">— Δεν αντιστοιχίζεται —</option>
                      {cleaned.colIdx.map((absIdx: number, visiblePos: number) => (
                        <option key={absIdx} value={absIdx}>
                          {colLetter(absIdx)} · {cleaned.headers[visiblePos] || '(κενό)'}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepResult({ result, entity, onReset }: { result: any; entity: Entity | null; onReset: () => void }) {
  const all = result.inserted + result.updated;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ResultTile label="Σύνολο" value={result.total} color="text-foreground" />
        <ResultTile label="Νέες εγγραφές" value={result.inserted} color="text-emerald-700" />
        <ResultTile label="Ενημερώσεις" value={result.updated} color="text-blue-700" />
        <ResultTile label="Αποτυχίες" value={result.failed.length} color="text-destructive" />
      </div>

      {result.failed.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="text-[12px] font-semibold text-destructive mb-2">Αποτυχίες ({result.failed.length})</div>
          <ul className="text-[11px] space-y-0.5 max-h-60 overflow-y-auto">
            {result.failed.slice(0, 100).map((f: any) => (
              <li key={f.row} className="flex gap-2">
                <span className="tabular-nums text-muted-foreground w-12">Row {f.row}:</span>
                <span className="text-destructive">{f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onReset}><FiRefreshCw className="mr-1" /> Νέα εισαγωγή</Button>
      </div>
    </div>
  );
}

function ResultTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-border p-3 bg-background">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-[24px] font-semibold tabular-nums ${color}`}>{value.toLocaleString('el-GR')}</div>
    </div>
  );
}

// ---- Utils ----
function colLetter(i: number): string {
  let s = ''; let n = i;
  while (true) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; if (n < 0) break; }
  return s;
}
