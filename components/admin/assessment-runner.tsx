'use client';

import * as React from 'react';
import { FiPlay, FiChevronDown, FiChevronUp, FiAlertCircle, FiCheckCircle, FiXCircle } from 'react-icons/fi';
import { Badge } from '@/components/ui/badge';

// ── Types ──────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  afm?: string | null;
}

interface ManualVariable {
  key: string;
  label: string;
}

interface ComputedCriterionDef {
  code: string;
  label: string;
  weight: number;
  variables: { key: string; label: string; source: string }[];
}

interface AssessmentCriterion {
  code: string;
  label: string;
  weight: number;
  inputs: Record<string, number | null>;
  index: number | null;
  score: number;
  weighted: number;
  error: string | null;
}

interface AssessmentResult {
  threshold: number;
  referenceYear: number;
  criteria: AssessmentCriterion[];
  total: number;
  passed: boolean;
  verdict: 'ELIGIBLE' | 'NOT_ELIGIBLE';
}

// ── Style constants ────────────────────────────────────────────────────────

const FIELD =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground ' +
  'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const FL = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{children}</span>
);

// ── Component ──────────────────────────────────────────────────────────────

export function AssessmentRunner({ programId }: { programId: string }) {
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = React.useState(true);
  const [companiesError, setCompaniesError] = React.useState<string | null>(null);

  const [companyId, setCompanyId] = React.useState('');
  const [companySearch, setCompanySearch] = React.useState('');
  const [showDropdown, setShowDropdown] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const [referenceYear, setReferenceYear] = React.useState(2024);
  const [saveResult, setSaveResult] = React.useState(false);

  // manual variables from computed-criteria endpoint
  const [manualDefs, setManualDefs] = React.useState<{ critCode: string; critLabel: string; vars: ManualVariable[] }[]>([]);
  const [manualValues, setManualValues] = React.useState<Record<string, Record<string, string>>>({});

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<AssessmentResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  // Load companies
  React.useEffect(() => {
    setCompaniesLoading(true);
    fetch('/api/admin/companies')
      .then((r) => r.json())
      .then((data) => {
        const list: Company[] = data.companies ?? data.data ?? data ?? [];
        setCompanies(list);
        setCompaniesError(null);
      })
      .catch(() => setCompaniesError('Αποτυχία φόρτωσης εταιριών'))
      .finally(() => setCompaniesLoading(false));
  }, []);

  // Load computed-criteria to discover MANUAL vars
  React.useEffect(() => {
    fetch(`/api/admin/programs/${programId}/computed-criteria`)
      .then((r) => r.json())
      .then((data) => {
        const crit: ComputedCriterionDef[] = data.criteria ?? [];
        const defs = crit
          .map((c) => ({
            critCode: c.code,
            critLabel: c.label,
            vars: (c.variables ?? []).filter((v) => v.source === 'MANUAL'),
          }))
          .filter((c) => c.vars.length > 0);
        setManualDefs(defs);
      })
      .catch(() => { /* silently ignore */ });
  }, [programId]);

  // Close dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredCompanies = companySearch.trim()
    ? companies.filter(
        (c) =>
          c.name.toLowerCase().includes(companySearch.toLowerCase()) ||
          (c.afm ?? '').includes(companySearch),
      )
    : companies.slice(0, 50);

  const selectedCompany = companies.find((c) => c.id === companyId) ?? null;

  function setManualValue(critCode: string, varKey: string, val: string) {
    setManualValues((prev) => ({
      ...prev,
      [critCode]: { ...(prev[critCode] ?? {}), [varKey]: val },
    }));
  }

  async function run() {
    if (!companyId) { setError('Διάλεξε εταιρία πρώτα.'); return; }
    setRunning(true);
    setError(null);
    setResult(null);

    // build manual map
    const manual: Record<string, Record<string, number>> = {};
    for (const [critCode, vars] of Object.entries(manualValues)) {
      for (const [varKey, val] of Object.entries(vars)) {
        const n = parseFloat(val);
        if (!isNaN(n)) {
          if (!manual[critCode]) manual[critCode] = {};
          manual[critCode][varKey] = n;
        }
      }
    }

    try {
      const res = await fetch(`/api/admin/programs/${programId}/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, referenceYear, manual: Object.keys(manual).length ? manual : undefined, save: saveResult }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json as AssessmentResult);
    } catch (e: any) {
      setError(e?.message ?? 'Σφάλμα δικτύου');
    } finally {
      setRunning(false);
    }
  }

  function toggleRow(code: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-card shadow-fluent-2 p-4 space-y-4">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight">Εκτέλεση Αξιολόγησης</h3>
          <p className="text-[11px] text-muted-foreground">Επίλεξε εταιρία, έτος αναφοράς και πάτησε Εκτέλεση</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_160px_auto]">
          {/* Company picker */}
          <div className="flex flex-col gap-1">
            <FL>Εταιρία</FL>
            <div ref={dropdownRef} className="relative">
              <input
                type="text"
                className={FIELD}
                placeholder={companiesLoading ? 'Φόρτωση…' : 'Αναζήτηση εταιρίας…'}
                value={showDropdown ? companySearch : (selectedCompany?.name ?? '')}
                onFocus={() => { setShowDropdown(true); setCompanySearch(''); }}
                onChange={(e) => { setCompanySearch(e.target.value); setShowDropdown(true); }}
                disabled={companiesLoading}
              />
              {showDropdown && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-fluent-8 max-h-52 overflow-y-auto">
                  {companiesError ? (
                    <div className="px-3 py-2 text-[12px] text-dg-red-600">{companiesError}</div>
                  ) : filteredCompanies.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">Δεν βρέθηκαν αποτελέσματα</div>
                  ) : (
                    filteredCompanies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted/50 transition-colors"
                        onClick={() => { setCompanyId(c.id); setShowDropdown(false); setCompanySearch(''); }}
                      >
                        <span className="flex-1 truncate font-medium">{c.name}</span>
                        {c.afm && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.afm}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Reference year */}
          <div className="flex flex-col gap-1">
            <FL>Έτος αναφοράς</FL>
            <input
              type="number"
              className={FIELD}
              value={referenceYear}
              min={2015}
              max={2030}
              onChange={(e) => setReferenceYear(parseInt(e.target.value, 10) || 2024)}
            />
          </div>

          {/* Run button */}
          <div className="flex flex-col justify-end">
            <button
              type="button"
              disabled={running || !companyId}
              onClick={run}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-sisyphus-500 px-4 text-sm font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <FiPlay className="size-3.5" />
              {running ? 'Εκτέλεση…' : 'Εκτέλεση Αξιολόγησης'}
            </button>
          </div>
        </div>

        {/* Save checkbox */}
        <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={saveResult}
            onChange={(e) => setSaveResult(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-sisyphus-500"
          />
          <span>Αποθήκευση αποτελέσματος</span>
        </label>
      </div>

      {/* Manual inputs */}
      {manualDefs.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-fluent-2 p-4 space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold tracking-tight">Χειροκίνητες τιμές</h3>
            <p className="text-[11px] text-muted-foreground">Τιμές που δεν μπορούν να συλλεχθούν αυτόματα από οικονομικά δεδομένα</p>
          </div>
          {manualDefs.map((def) => (
            <div key={def.critCode} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <p className="text-[12px] font-semibold">{def.critCode} — {def.critLabel}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {def.vars.map((v) => (
                  <div key={v.key} className="flex flex-col gap-1">
                    <FL>{v.label}</FL>
                    <input
                      type="number"
                      className={FIELD}
                      placeholder="0"
                      value={manualValues[def.critCode]?.[v.key] ?? ''}
                      onChange={(e) => setManualValue(def.critCode, v.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-dg-red-500/40 bg-dg-red-500/5 p-4 text-[12px]">
          <FiAlertCircle className="mt-0.5 size-4 shrink-0 text-dg-red-600" />
          <span className="text-dg-red-700">{error}</span>
        </div>
      )}

      {/* Empty state */}
      {!result && !error && !running && (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 py-16 text-center">
          <FiPlay className="mx-auto size-8 text-muted-foreground/40 mb-3" />
          <p className="text-[13px] text-muted-foreground">Διάλεξε εταιρία και πάτησε Εκτέλεση για να δεις το αποτέλεσμα αξιολόγησης</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="rounded-xl border border-border bg-card shadow-fluent-2 overflow-hidden">
          {/* Verdict header */}
          <div
            className={`px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3 ${
              result.passed ? 'bg-emerald-500/5' : 'bg-dg-red-500/5'
            }`}
          >
            <div className="space-y-0.5">
              <h3 className="text-[14px] font-semibold tracking-tight">Αποτέλεσμα Αξιολόγησης</h3>
              <p className="text-[11px] text-muted-foreground">
                Έτος αναφοράς: <strong>{result.referenceYear}</strong> · Εταιρία: <strong>{selectedCompany?.name}</strong>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Συνολική βαθμολογία</p>
                <p className="text-[22px] font-bold tabular-nums">{result.total.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">Ελάχιστη: {result.threshold}</p>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-bold ${
                  result.passed
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                    : 'border-dg-red-500/40 bg-dg-red-500/10 text-dg-red-700'
                }`}
              >
                {result.passed ? (
                  <><FiCheckCircle className="size-4" /> ΕΓΚΡΙΣΗ</>
                ) : (
                  <><FiXCircle className="size-4" /> ΑΠΟΡΡΙΨΗ</>
                )}
              </div>
            </div>
          </div>

          {/* Criteria breakdown table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Κριτήριο</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-24">Στάθμιση</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-28">Δείκτης</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-28">Βαθμοί (0–100)</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-28">Σταθμισμένο</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {result.criteria.map((c) => {
                  const expanded = expandedRows.has(c.code);
                  const hasInputs = c.inputs && Object.keys(c.inputs).length > 0;
                  return (
                    <React.Fragment key={c.code}>
                      <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{c.code}</Badge>
                            <span className="text-[12px] font-medium leading-snug">{c.label}</span>
                          </div>
                          {c.error && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-dg-red-600">
                              <FiAlertCircle className="size-3 shrink-0" />
                              <span>{c.error}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{(c.weight * 100).toFixed(0)}%</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.error ? <span className="text-dg-red-500">—</span> : c.index != null ? c.index.toFixed(4) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.error ? <span className="text-dg-red-500">—</span> : (
                            <span className={c.score >= 60 ? 'text-emerald-700 font-semibold' : c.score >= 30 ? 'text-amber-700 font-semibold' : 'text-dg-red-600 font-semibold'}>
                              {c.score.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {c.error ? <span className="text-dg-red-500">—</span> : c.weighted.toFixed(4)}
                        </td>
                        <td className="px-4 py-3">
                          {hasInputs && (
                            <button
                              type="button"
                              onClick={() => toggleRow(c.code)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground"
                              title="Εμφάνιση τιμών"
                            >
                              {expanded ? <FiChevronUp className="size-3.5" /> : <FiChevronDown className="size-3.5" />}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && hasInputs && (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={6} className="px-6 py-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Τιμές E3</p>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                              {Object.entries(c.inputs).map(([k, v]) => (
                                <div key={k} className="flex items-center gap-1.5">
                                  <span className="font-mono text-[11px] text-muted-foreground">{k}:</span>
                                  <span className="text-[12px] tabular-nums">{v != null ? v.toLocaleString('el-GR') : <em className="text-muted-foreground">null</em>}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t-2 border-border">
                  <td colSpan={4} className="px-4 py-3 text-right text-[13px] font-bold">
                    Συνολική Σταθμισμένη Βαθμολογία
                  </td>
                  <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums">{result.total.toFixed(4)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
