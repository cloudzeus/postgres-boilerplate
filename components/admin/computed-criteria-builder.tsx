'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { Badge } from '@/components/ui/badge';
import {
  evaluateCriterion,
  computeAssessment,
  type Criterion,
  type CritVariable,
} from '@/lib/eval/score';

// ── types ──────────────────────────────────────────────────────────────────

interface FinancialField {
  key: string;
  label: string;
  valueType: string;
  kind: 'SINGLE' | 'SERIES' | 'TABLE';
  templateCode: string;
  templateName: string;
  columns: string[] | null;
}

// ── style constants (match questionnaire-tab) ───────────────────────────────

const FIELD =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground ' +
  'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function FL({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

const YEAR_MODE_LABELS: Record<string, string> = {
  REFERENCE: 'Έτος αναφοράς',
  PRIOR_1: '−1 χρόνος',
  PRIOR_2: '−2 χρόνια',
  PRIOR_3: '−3 χρόνια',
};

const SOURCE_LABELS: Record<string, string> = {
  FINANCIAL: 'Οικονομικό πεδίο',
  MANUAL: 'Χειροκίνητο',
  PARAM: 'Σταθερά',
  DERIVED: 'Υπολογισμός',
};

function newCriterion(): Criterion {
  return {
    code: '',
    label: '',
    weight: 10,
    variables: [],
    indexKey: null,
    indexExpression: '',
    bandMode: 'LOOKUP',
    bands: [],
  };
}

function newVariable(): CritVariable {
  return { key: '', source: 'FINANCIAL', fieldKey: null, yearMode: 'REFERENCE' };
}

// ── sub-components ─────────────────────────────────────────────────────────

function VariableRow({
  v,
  idx,
  allKeys,
  fields,
  onChange,
  onRemove,
}: {
  v: CritVariable;
  idx: number;
  allKeys: string[];
  fields: FinancialField[];
  onChange: (patch: Partial<CritVariable>) => void;
  onRemove: () => void;
}) {
  const [formulaRef, setFormulaRef] = React.useState<HTMLInputElement | null>(null);

  const priorKeys = allKeys.slice(0, idx); // keys defined before this one (for DERIVED chips)

  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[120px_160px_1fr_auto]">
      {/* key */}
      <label className="flex flex-col gap-1">
        <FL>Κλειδί</FL>
        <input
          className={FIELD}
          placeholder="π.χ. ebit"
          value={v.key}
          onChange={(e) => onChange({ key: e.target.value.trim() })}
        />
      </label>

      {/* source */}
      <label className="flex flex-col gap-1">
        <FL>Πηγή</FL>
        <select
          className={FIELD}
          value={v.source}
          onChange={(e) =>
            onChange({
              source: e.target.value as CritVariable['source'],
              fieldKey: null,
              formula: null,
              constant: null,
              yearMode: 'REFERENCE',
            })
          }
        >
          {Object.entries(SOURCE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>

      {/* source-specific extra */}
      <div className="flex flex-col gap-1">
        {v.source === 'FINANCIAL' && (
          <>
            <FL>Πεδίο E3 → Αντιστοίχιση</FL>
            <div className="flex gap-2">
              <select
                className={FIELD}
                value={v.fieldKey ?? ''}
                onChange={(e) => onChange({ fieldKey: e.target.value || null })}
              >
                <option value="">— επιλέξτε πεδίο —</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} — {f.key}
                  </option>
                ))}
              </select>
              <select
                className={FIELD + ' w-44 shrink-0'}
                value={v.yearMode ?? 'REFERENCE'}
                onChange={(e) => onChange({ yearMode: e.target.value as CritVariable['yearMode'] })}
              >
                {Object.entries(YEAR_MODE_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {v.source === 'PARAM' && (
          <>
            <FL>Τιμή σταθεράς</FL>
            <input
              type="number"
              className={FIELD}
              placeholder="π.χ. 1000000"
              value={v.constant ?? ''}
              onChange={(e) =>
                onChange({ constant: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </>
        )}
        {v.source === 'DERIVED' && (
          <>
            <FL>Formula (π.χ. ebit / interest)</FL>
            <div className="space-y-1.5">
              <input
                ref={setFormulaRef}
                className={FIELD}
                placeholder="π.χ. revenue - costs"
                value={v.formula ?? ''}
                onChange={(e) => onChange({ formula: e.target.value })}
              />
              {priorKeys.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {priorKeys.map((k) => (
                    <button
                      key={k}
                      type="button"
                      title={`Εισαγωγή "${k}" στη formula`}
                      onClick={() => {
                        onChange({ formula: ((v.formula ?? '') + (v.formula ? ' + ' : '') + k) });
                        formulaRef?.focus();
                      }}
                      className="inline-flex h-6 items-center rounded-sm border border-sisyphus-500/40 bg-sisyphus-500/10 px-2 text-[11px] font-mono text-sisyphus-700 hover:bg-sisyphus-500/20"
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {v.source === 'MANUAL' && (
          <div className="flex h-full items-end">
            <span className="text-[11px] text-muted-foreground italic">
              Τιμή εισάγεται κατά την αξιολόγηση
            </span>
          </div>
        )}
      </div>

      {/* remove */}
      <div className="flex items-end justify-end">
        <button
          type="button"
          onClick={onRemove}
          title="Αφαίρεση μεταβλητής"
          className="inline-flex size-8 items-center justify-center rounded-md text-dg-red-600 hover:bg-dg-red-500/10"
        >
          <FiTrash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BandEditor({
  bands,
  onChange,
}: {
  bands: Criterion['bands'];
  onChange: (bands: Criterion['bands']) => void;
}) {
  const add = () => onChange([...bands, { min: null, max: null, score: 0 }]);
  const remove = (i: number) => onChange(bands.filter((_, j) => j !== i));
  const update = (i: number, patch: Partial<(typeof bands)[0]>) =>
    onChange(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const parseNum = (v: string) => (v === '' ? null : Number(v));

  return (
    <div className="space-y-2">
      {bands.length === 0 && (
        <p className="text-[11px] italic text-muted-foreground">Δεν υπάρχουν ζώνες.</p>
      )}
      {bands.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <FL>Min (−∞ αν κενό)</FL>
            <input
              type="number"
              className={FIELD}
              placeholder="−∞"
              value={b.min ?? ''}
              onChange={(e) => update(i, { min: parseNum(e.target.value) })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-0.5">
            <FL>Max (+∞ αν κενό)</FL>
            <input
              type="number"
              className={FIELD}
              placeholder="+∞"
              value={b.max ?? ''}
              onChange={(e) => update(i, { max: parseNum(e.target.value) })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-0.5">
            <FL>Βαθμός (0-100)</FL>
            <input
              type="number"
              className={FIELD}
              value={b.score}
              onChange={(e) => update(i, { score: Number(e.target.value) })}
            />
          </label>
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-4 inline-flex size-8 items-center justify-center rounded-md text-dg-red-600 hover:bg-dg-red-500/10"
          >
            <FiTrash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-input px-2 text-[11px] font-medium text-foreground hover:border-sisyphus-500 hover:bg-sisyphus-500/5"
      >
        <FiPlus className="size-3" /> Νέα ζώνη
      </button>
    </div>
  );
}

function CriterionCard({
  c,
  fields,
  onChange,
  onRemove,
}: {
  c: Criterion;
  fields: FinancialField[];
  onChange: (c: Criterion) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(true);

  // sample inputs state for live preview
  const nonDerived = c.variables.filter(
    (v) => v.source !== 'DERIVED' && v.key.trim() !== '',
  );
  const [samples, setSamples] = React.useState<Record<string, string>>({});

  const sampleNumbers: Record<string, number | null | undefined> = {};
  for (const v of nonDerived) {
    const raw = samples[v.key];
    sampleNumbers[v.key] = raw === undefined || raw === '' ? undefined : Number(raw);
  }
  // PARAM fallback
  for (const v of c.variables) {
    if (v.source === 'PARAM' && v.constant != null && sampleNumbers[v.key] == null) {
      sampleNumbers[v.key] = v.constant;
    }
  }

  const previewResult = evaluateCriterion(c, sampleNumbers);

  const allKeys = c.variables.map((v) => v.key).filter(Boolean);

  function patchVar(i: number, patch: Partial<CritVariable>) {
    onChange({
      ...c,
      variables: c.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    });
  }

  function removeVar(i: number) {
    onChange({ ...c, variables: c.variables.filter((_, j) => j !== i) });
  }

  function addVar() {
    onChange({ ...c, variables: [...c.variables, newVariable()] });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-neutral-6/40 px-4 py-3">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
            {c.code || '?'}
          </Badge>
          <input
            className="h-8 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium hover:border-input focus:border-sisyphus-500 focus:outline-none"
            placeholder="Κωδικός (π.χ. Β1)"
            value={c.code}
            onChange={(e) => onChange({ ...c, code: e.target.value })}
          />
          <input
            className="h-8 flex-[3] rounded-md border border-transparent bg-transparent px-2 text-[13px] hover:border-input focus:border-sisyphus-500 focus:outline-none"
            placeholder="Ονομασία κριτηρίου"
            value={c.label}
            onChange={(e) => onChange({ ...c, label: e.target.value })}
          />
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-center text-[13px] focus:border-sisyphus-500 focus:outline-none"
              title="Βάρος %"
              value={c.weight}
              onChange={(e) => onChange({ ...c, weight: Number(e.target.value) })}
            />
            <span className="text-[11px] text-muted-foreground">%</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            {open ? <FiChevronUp className="size-4" /> : <FiChevronDown className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-8 items-center justify-center rounded-md text-dg-red-600 hover:bg-dg-red-500/10"
          >
            <FiTrash2 className="size-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-5 p-4">
          {/* ── Variables ── */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Μεταβλητές (αντιστοιχίσεις)
            </p>
            <div className="space-y-2">
              {c.variables.map((v, i) => (
                <VariableRow
                  key={i}
                  v={v}
                  idx={i}
                  allKeys={allKeys}
                  fields={fields}
                  onChange={(patch) => patchVar(i, patch)}
                  onRemove={() => removeVar(i)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addVar}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-3 text-[12px] font-medium text-foreground hover:border-sisyphus-500 hover:bg-sisyphus-500/5"
            >
              <FiPlus className="size-3.5" /> Νέα μεταβλητή
            </button>
          </div>

          {/* ── Index ── */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Δείκτης
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <FL>Μεταβλητή δείκτη (indexKey)</FL>
                <select
                  className={FIELD}
                  value={c.indexKey ?? ''}
                  onChange={(e) => onChange({ ...c, indexKey: e.target.value || null })}
                >
                  <option value="">— επιλέξτε ή χρησιμοποιήστε expression —</option>
                  {allKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <FL>Expression δείκτη (κερδίζει αν συμπληρωθεί)</FL>
                <input
                  className={FIELD}
                  placeholder="π.χ. ebit / interest"
                  value={c.indexExpression ?? ''}
                  onChange={(e) => onChange({ ...c, indexExpression: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* ── Band mode + Bands ── */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Βαθμολόγηση
            </p>
            <div className="mb-3">
              <label className="flex flex-col gap-1">
                <FL>Τρόπος</FL>
                <select
                  className={FIELD + ' w-64'}
                  value={c.bandMode}
                  onChange={(e) =>
                    onChange({ ...c, bandMode: e.target.value as Criterion['bandMode'] })
                  }
                >
                  <option value="LOOKUP">Ζώνες (LOOKUP)</option>
                  <option value="PASSTHROUGH">Άμεση τιμή (PASSTHROUGH)</option>
                </select>
              </label>
            </div>
            {c.bandMode === 'LOOKUP' ? (
              <BandEditor
                bands={c.bands}
                onChange={(bands) => onChange({ ...c, bands })}
              />
            ) : (
              <p className="text-[11px] italic text-muted-foreground">
                Ο δείκτης (0–100) χρησιμοποιείται απευθείας ως βαθμός.
              </p>
            )}
          </div>

          {/* ── Live preview ── */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Δοκιμή (live preview)
            </p>
            {nonDerived.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">
                Προσθέστε μεταβλητές για δοκιμή.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {nonDerived.map((v) => (
                    <label key={v.key} className="flex flex-col gap-0.5">
                      <FL>{v.key}</FL>
                      <input
                        type="number"
                        className="h-8 w-28 rounded-md border border-input bg-background px-2 text-[13px] focus:border-sisyphus-500 focus:outline-none"
                        placeholder="0"
                        value={samples[v.key] ?? ''}
                        onChange={(e) =>
                          setSamples((s) => ({ ...s, [v.key]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3 pt-1">
                  {previewResult.error ? (
                    <span className="text-[12px] text-dg-red-600">⚠ {previewResult.error}</span>
                  ) : (
                    <>
                      <span className="text-[12px] text-muted-foreground">
                        Δείκτης:{' '}
                        <strong className="text-foreground">
                          {previewResult.index != null ? previewResult.index.toFixed(4) : '—'}
                        </strong>
                      </span>
                      <span className="text-[12px] text-muted-foreground">·</span>
                      <span className="text-[12px] text-muted-foreground">
                        Βαθμοί:{' '}
                        <strong className="text-sisyphus-700">{previewResult.score}</strong>
                        /100
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ComputedCriteriaBuilder({ programId }: { programId: string }) {
  const [fields, setFields] = React.useState<FinancialField[]>([]);
  const [criteria, setCriteria] = React.useState<Criterion[]>([]);
  const [threshold, setThreshold] = React.useState(75);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [fRes, cRes] = await Promise.all([
          fetch('/api/admin/financial-fields'),
          fetch(`/api/admin/programs/${programId}/computed-criteria`),
        ]);
        if (!alive) return;
        const fData = await fRes.json();
        setFields(fData.fields ?? []);
        if (cRes.ok) {
          const cData = await cRes.json();
          setCriteria(cData.criteria ?? []);
          if (cData.threshold != null) setThreshold(Number(cData.threshold));
        }
      } catch (err: unknown) {
        toast.error(`Αποτυχία φόρτωσης: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [programId]);

  async function save() {
    setBusy(true);
    try {
      // coerce: ensure weight/constant/score are numbers; min/max null if empty
      const payload = {
        threshold,
        criteria: criteria.map((c) => ({
          ...c,
          weight: Number(c.weight),
          bands: c.bands.map((b) => ({
            min: b.min != null ? Number(b.min) : null,
            max: b.max != null ? Number(b.max) : null,
            score: Number(b.score),
          })),
          variables: c.variables.map((v) => ({
            ...v,
            constant: v.constant != null ? Number(v.constant) : null,
          })),
        })),
      };
      const res = await fetch(`/api/admin/programs/${programId}/computed-criteria`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε');
    } catch (err: unknown) {
      toast.error(`Σφάλμα: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function generateAI() {
    if (criteria.length > 0 && !confirm('Θα αντικατασταθούν τα τρέχοντα κριτήρια με όσα εντοπίσει το AI στον οδηγό. Συνέχεια;')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/computed-criteria/generate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setCriteria(json.criteria ?? []);
      if (json.threshold != null) setThreshold(Number(json.threshold));
      toast.success(`Το AI εντόπισε ${json.criteria?.length ?? 0} κριτήρια. Έλεγξε & Αποθήκευσε.`);
    } catch (err: unknown) {
      toast.error(`Σφάλμα AI: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Live global preview ──────────────────────────────────────────────────
  // We compute per-criterion without sample inputs here (empty → score 0 or error)
  // A proper preview happens inside each CriterionCard. Here we just show totals.
  const allResults = criteria.map((c) =>
    evaluateCriterion(c, {}),
  );
  const assessment = computeAssessment(allResults, threshold);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Φόρτωση…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header bar ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
              Υπολογιστικά Κριτήρια Αξιολόγησης
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Αντιστοίχιση μεταβλητών σε E3 πεδία, ορισμός formula, ζώνες βαθμολόγησης
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="font-semibold">Ελάχιστη βαθμολογία</span>
              <input
                type="number"
                className="h-9 w-20 rounded-md border border-input bg-background px-2 text-center text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={generateAI}
              title="Εντοπισμός βαθμολόγησης από τον οδηγό με AI"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-sisyphus-500/50 bg-sisyphus-500/10 px-3 text-[13px] font-medium text-sisyphus-700 hover:bg-sisyphus-500/20 disabled:opacity-50"
            >
              🪄 {busy ? 'Ανάλυση…' : 'Δημιουργία με AI'}
            </button>
            <button
              type="button"
              onClick={() => setCriteria((prev) => [...prev, newCriterion()])}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-sisyphus-500/50 bg-sisyphus-500/5 px-3 text-[13px] font-medium text-sisyphus-700 hover:bg-sisyphus-500/10"
            >
              <FiPlus className="size-4" /> Κριτήριο
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-4 text-[13px] font-semibold text-white shadow-fluent-2 transition-colors hover:bg-sisyphus-600 disabled:opacity-50"
            >
              <FiSave className="size-4" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Criteria ── */}
      {criteria.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Δεν υπάρχουν κριτήρια ακόμη.
          </p>
          <p className="text-[12px] text-muted-foreground/80">
            Πατήστε «+ Κριτήριο» για να προσθέσετε.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {criteria.map((c, i) => (
            <CriterionCard
              key={i}
              c={c}
              fields={fields}
              onChange={(updated) =>
                setCriteria((prev) => prev.map((x, j) => (j === i ? updated : x)))
              }
              onRemove={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      {/* ── Footer: global totals ── */}
      {criteria.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Συνολική Σταθμισμένη Βαθμολογία (με κενές τιμές = 0)
              </p>
              <p className="mt-0.5 text-[22px] font-bold tabular-nums tracking-tight text-foreground">
                {assessment.total.toFixed(2)}
                <span className="text-[14px] font-normal text-muted-foreground"> / 100</span>
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-lg px-4 py-2 text-[13px] font-bold ${
                assessment.passed
                  ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
                  : 'bg-dg-red-500/15 text-dg-red-700 border border-dg-red-500/30'
              }`}
            >
              {assessment.passed ? 'ΕΓΚΡΙΣΗ' : 'ΑΠΟΡΡΙΨΗ'}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
