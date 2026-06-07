'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { FiSave, FiChevronDown, FiCheck } from 'react-icons/fi';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaxField {
  id: string;
  key: string;
  label: string | null;
  description: string | null;
  order: number;
}

interface TaxTemplate {
  id: string;
  code: string;
  name: string;
  year: number | null;
  _count?: { fields: number };
  fields?: TaxField[];
}

interface RequiredField {
  id: string;
  templateId: string;
  fieldKey: string;
  yearsBack: number;
  mandatory: boolean;
  order: number;
  template: { id: string; code: string; name: string; year: number | null };
}

// key = `${templateId}::${fieldKey}`
interface Selection {
  templateId: string;
  fieldKey: string;
  yearsBack: number;
  mandatory: boolean;
}

type SelectionMap = Record<string, Selection>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function selKey(templateId: string, fieldKey: string) {
  return `${templateId}::${fieldKey}`;
}

const FIELD_CLS =
  'h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground ' +
  'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

// ─── Component ────────────────────────────────────────────────────────────────

export function OikonomikaPediaTab({ programId }: { programId: string }) {
  const [templates, setTemplates] = React.useState<TaxTemplate[]>([]);
  const [loadedFields, setLoadedFields] = React.useState<Record<string, TaxField[]>>({});
  // Ref mirror of loadedFields so the lazy-load effect can guard without
  // depending on the state value (which would re-run on every template load).
  const loadedFieldsRef = React.useRef<Record<string, TaxField[]>>({});
  const [selections, setSelections] = React.useState<SelectionMap>({});
  const [activeTemplateId, setActiveTemplateId] = React.useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [initialising, setInitialising] = React.useState(true);
  const [bootError, setBootError] = React.useState<string | null>(null);

  // ── Boot: load templates list + current required-fields ──────────────────
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tplRes, rfRes] = await Promise.all([
          fetch('/api/admin/tax-templates'),
          fetch(`/api/admin/programs/${programId}/required-fields`),
        ]);
        if (!alive) return;

        if (!tplRes.ok || !rfRes.ok) {
          throw new Error(`HTTP ${!tplRes.ok ? tplRes.status : rfRes.status}`);
        }

        const tplData = await tplRes.json();
        const rfData: RequiredField[] = await rfRes.json();

        const tpls: TaxTemplate[] = tplData.data ?? [];
        setTemplates(tpls);

        // Build initial selection map from persisted required-fields
        const map: SelectionMap = {};
        for (const rf of rfData) {
          map[selKey(rf.templateId, rf.fieldKey)] = {
            templateId: rf.templateId,
            fieldKey: rf.fieldKey,
            yearsBack: rf.yearsBack,
            mandatory: rf.mandatory,
          };
        }
        setSelections(map);

        // Pre-open the first template that has selections (or first template)
        const firstUsed = rfData[0]?.templateId ?? tpls[0]?.id ?? null;
        if (firstUsed) setActiveTemplateId(firstUsed);
      } catch {
        if (alive) setBootError('Αδυναμία φόρτωσης δεδομένων');
        toast.error('Αδυναμία φόρτωσης δεδομένων');
      } finally {
        if (alive) setInitialising(false);
      }
    })();
    return () => { alive = false; };
  }, [programId]);

  // ── Lazy-load template fields when a template is selected ─────────────────
  React.useEffect(() => {
    if (!activeTemplateId) return;
    if (loadedFieldsRef.current[activeTemplateId]) return;   // already cached (ref guard, no dep needed)
    let alive = true;
    setLoadingTemplate(true);
    fetch(`/api/admin/tax-templates/${activeTemplateId}`)
      .then((r) => r.json())
      .then((data: TaxTemplate) => {
        if (!alive) return;
        const fields = data.fields ?? [];
        loadedFieldsRef.current[activeTemplateId] = fields;
        setLoadedFields((prev) => ({ ...prev, [activeTemplateId]: fields }));
      })
      .catch(() => toast.error('Αδυναμία φόρτωσης πεδίων'))
      .finally(() => { if (alive) setLoadingTemplate(false); });
    return () => { alive = false; };
  }, [activeTemplateId]);

  // ── Toggle field selection ─────────────────────────────────────────────────
  function toggleField(templateId: string, fieldKey: string, checked: boolean) {
    const k = selKey(templateId, fieldKey);
    setSelections((prev) => {
      if (!checked) {
        const next = { ...prev };
        delete next[k];
        return next;
      }
      return { ...prev, [k]: { templateId, fieldKey, yearsBack: 1, mandatory: true } };
    });
  }

  function patchSelection(templateId: string, fieldKey: string, patch: Partial<Selection>) {
    const k = selKey(templateId, fieldKey);
    setSelections((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    setBusy(true);
    try {
      const payload = Object.values(selections);
      const res = await fetch(`/api/admin/programs/${programId}/required-fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Αποθηκεύτηκε');
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = Object.keys(selections).length;
  const activeFields = activeTemplateId ? (loadedFields[activeTemplateId] ?? []) : [];

  if (initialising) {
    return (
      <div className="flex items-center justify-center py-16 text-[12px] text-muted-foreground">
        Φόρτωση…
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="rounded-xl border border-dashed border-dg-red-500/40 bg-dg-red-500/5 p-8 text-center text-[12px] text-dg-red-700">
        {bootError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight">Οικονομικά πεδία</h3>
          <p className="text-[11px] text-muted-foreground">
            Επιλέξτε ποια φορολογικά πεδία απαιτεί το πρόγραμμα και για πόσα έτη.
            {selectedCount > 0 && (
              <span className="ml-2 font-medium text-sisyphus-600">{selectedCount} επιλεγμένα</span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-sm font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-60"
        >
          <FiSave className="size-3.5" />
          {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-[12px] text-muted-foreground">
          Δεν υπάρχουν διαθέσιμα φορολογικά πρότυπα. Δημιουργήστε πρώτα ένα πρότυπο στη σελίδα
          &ldquo;Φορολογικά Πρότυπα&rdquo;.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          {/* ── Template list (left sidebar) ────────────────────────────── */}
          <div className="space-y-1">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Πρότυπα
            </p>
            {templates.map((tpl) => {
              const tplSelectedCount = Object.values(selections).filter(
                (s) => s.templateId === tpl.id,
              ).length;
              const isActive = activeTemplateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setActiveTemplateId(tpl.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                    isActive
                      ? 'border-sisyphus-500/50 bg-sisyphus-500/10 font-semibold text-sisyphus-700'
                      : 'border-border bg-card text-foreground hover:bg-muted/50'
                  }`}
                >
                  <span className="truncate">
                    <span className="font-mono">{tpl.code}</span>
                    {tpl.year ? <span className="ml-1 text-[11px] text-muted-foreground">({tpl.year})</span> : null}
                    <span className="ml-1 block text-[11px] text-muted-foreground">{tpl.name}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {tplSelectedCount > 0 && (
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-sisyphus-500 text-[10px] font-bold text-white">
                        {tplSelectedCount}
                      </span>
                    )}
                    <FiChevronDown className={`size-3.5 transition-transform ${isActive ? 'rotate-180' : ''}`} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Field list (right panel) ─────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
            {!activeTemplateId ? (
              <div className="flex items-center justify-center py-12 text-[12px] text-muted-foreground">
                Επιλέξτε ένα πρότυπο για να δείτε τα πεδία του.
              </div>
            ) : loadingTemplate ? (
              <div className="flex items-center justify-center py-12 text-[12px] text-muted-foreground">
                Φόρτωση πεδίων…
              </div>
            ) : activeFields.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-[12px] text-muted-foreground">
                Το πρότυπο δεν έχει πεδία ακόμα.
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-[auto_1fr_90px_80px] gap-0 border-b border-border px-4 py-2">
                  <span />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Πεδίο</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Έτη πίσω</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Υποχρ.</span>
                </div>
                <div className="divide-y divide-border">
                  {activeFields.map((field) => {
                    const k = selKey(activeTemplateId, field.key);
                    const sel = selections[k];
                    const checked = !!sel;

                    return (
                      <div
                        key={field.key}
                        className={`grid grid-cols-[auto_1fr_90px_80px] items-center gap-3 px-4 py-2.5 transition ${
                          checked ? 'bg-sisyphus-500/5' : 'hover:bg-muted/30'
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleField(activeTemplateId, field.key, !checked)}
                          className={`flex size-5 shrink-0 items-center justify-center rounded border transition ${
                            checked
                              ? 'border-sisyphus-500 bg-sisyphus-500 text-white'
                              : 'border-input bg-background hover:border-sisyphus-400'
                          }`}
                        >
                          {checked && <FiCheck className="size-3" />}
                        </button>

                        {/* Label */}
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-foreground">
                            <span className="font-mono text-[11px] text-muted-foreground mr-1">{field.key}</span>
                            {field.label ?? ''}
                          </p>
                          {field.description && (
                            <p className="truncate text-[11px] text-muted-foreground">{field.description}</p>
                          )}
                        </div>

                        {/* yearsBack */}
                        <div className="flex justify-center">
                          {checked ? (
                            <select
                              value={sel.yearsBack}
                              onChange={(e) =>
                                patchSelection(activeTemplateId, field.key, {
                                  yearsBack: Number(e.target.value),
                                })
                              }
                              className={FIELD_CLS + ' w-20'}
                            >
                              <option value={1}>1 (τρέχον)</option>
                              <option value={2}>2</option>
                              <option value={3}>3 (τριετία)</option>
                            </select>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>

                        {/* mandatory */}
                        <div className="flex justify-center">
                          {checked ? (
                            <button
                              type="button"
                              onClick={() =>
                                patchSelection(activeTemplateId, field.key, {
                                  mandatory: !sel.mandatory,
                                })
                              }
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                                sel.mandatory
                                  ? 'bg-dg-red-500/15 text-dg-red-700'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {sel.mandatory ? 'Ναι' : 'Όχι'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
