// app/admin/programs/[id]/questionnaire-tab.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave, FiSettings, FiHelpCircle } from 'react-icons/fi';
import { Badge } from '@/components/ui/badge';
import type { AnswerType, ScoringModel, CompanyField } from '@/lib/programs/questionnaire-types';

interface Opt { label: string; points: number }
interface Q {
  code: string | null; text: string; criterionRef: string | null; helpText: string | null;
  answerType: AnswerType; weight: number | null; maxPoints: number | null;
  companyField: CompanyField | null; options: Opt[];
}
export interface QuestionnaireData {
  scoringModel: ScoringModel; threshold: number | null; maxScore: number | null;
  sourceNote: string | null; questions: Q[];
}

const ANSWER_TYPES: { value: AnswerType; label: string }[] = [
  { value: 'SINGLE_CHOICE', label: 'Πολλαπλή επιλογή' },
  { value: 'SCALE', label: 'Κλίμακα' },
  { value: 'BOOLEAN', label: 'Ναι / Όχι' },
  { value: 'NUMERIC', label: 'Αριθμός' },
];
const COMPANY_FIELDS: { value: CompanyField | ''; label: string }[] = [
  { value: '', label: 'Χειροκίνητο' },
  { value: 'legalForm', label: 'Νομική μορφή' },
  { value: 'operationalYears', label: 'Έτη λειτουργίας' },
  { value: 'employeeCount', label: 'Προσωπικό' },
  { value: 'region', label: 'Περιφέρεια' },
  { value: 'kad', label: 'ΚΑΔ' },
];

// Canonical field styling — matches the rest of the program editor (14px text, Sisyphus focus).
const FIELD =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground ' +
  'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export function QuestionnaireTab({ programId, initial }: { programId: string; initial: QuestionnaireData | null }) {
  const router = useRouter();
  const [q, setQ] = React.useState<QuestionnaireData>(initial ?? { scoringModel: 'WEIGHTED', threshold: 75, maxScore: 100, sourceNote: null, questions: [] });
  const [busy, setBusy] = React.useState(false);
  const weighted = q.scoringModel === 'WEIGHTED';

  async function generate() {
    if (!confirm('Η δημιουργία με AI θα ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ το τρέχον ερωτηματολόγιο. Συνέχεια;')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/questionnaire/generate`, { method: 'POST' });
      if (!res.ok) { toast.error('Η δημιουργία απέτυχε'); return; }
      toast.success('Δημιουργήθηκε'); router.refresh();
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/questionnaire`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q),
      });
      if (!res.ok) { toast.error('Αποτυχία αποθήκευσης'); return; }
      toast.success('Αποθηκεύτηκε'); router.refresh();
    } finally { setBusy(false); }
  }

  function patch(i: number, p: Partial<Q>) { setQ((s) => ({ ...s, questions: s.questions.map((x, j) => j === i ? { ...x, ...p } : x) })); }
  function addQ() { setQ((s) => ({ ...s, questions: [...s.questions, { code: null, text: '', criterionRef: null, helpText: null, answerType: 'SINGLE_CHOICE', weight: 1, maxPoints: 100, companyField: null, options: [] }] })); }
  function removeQ(i: number) { setQ((s) => ({ ...s, questions: s.questions.filter((_, j) => j !== i) })); }

  return (
    <div className="space-y-5">
      {/* ── Ρυθμίσεις βαθμολόγησης ─────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-sisyphus-500/10 text-sisyphus-600">
              <FiSettings className="size-4" />
            </span>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">Ρυθμίσεις βαθμολόγησης</h3>
              <p className="text-[11px] text-muted-foreground">Μοντέλο, κατώφλι επιτυχίας & μέγιστη βαθμολογία</p>
            </div>
          </div>
          <button
            type="button" disabled={busy} onClick={generate}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-3 text-[13px] font-medium text-sisyphus-700 transition-colors hover:bg-sisyphus-500/15 disabled:opacity-50"
          >
            <span aria-hidden>🪄</span> Δημιουργία με AI
          </button>
        </header>
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <FieldLabel>Μοντέλο</FieldLabel>
            <select className={FIELD} value={q.scoringModel} onChange={(e) => setQ({ ...q, scoringModel: e.target.value as ScoringModel })}>
              <option value="WEIGHTED">Σταθμισμένο (βάρη)</option>
              <option value="POINTS_SUM">Άθροισμα μορίων</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Κατώφλι</FieldLabel>
            <input type="number" className={FIELD} value={q.threshold ?? ''} onChange={(e) => setQ({ ...q, threshold: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Μέγιστο</FieldLabel>
            <input type="number" className={FIELD} value={q.maxScore ?? ''} onChange={(e) => setQ({ ...q, maxScore: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Πηγή</FieldLabel>
            <input className={FIELD} placeholder="π.χ. Παράρτημα III" value={q.sourceNote ?? ''} onChange={(e) => setQ({ ...q, sourceNote: e.target.value || null })} />
          </label>
        </div>
      </section>

      {/* ── Ερωτήσεις ──────────────────────────────────────────── */}
      <div className="space-y-3">
        {q.questions.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center">
            <FiHelpCircle className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Δεν υπάρχουν ερωτήσεις ακόμη.</p>
            <p className="text-[12px] text-muted-foreground/80">Πάτησε «Δημιουργία με AI» ή πρόσθεσε ερώτηση χειροκίνητα.</p>
          </div>
        )}

        {q.questions.map((item, i) => (
          <section key={i} className="rounded-xl border border-border bg-card p-4 shadow-fluent-2">
            {/* Ερώτηση */}
            <div className="flex items-start gap-2.5">
              <Badge variant="outline" className="mt-1.5 shrink-0 font-mono text-[11px]">{item.code ?? `Q${i + 1}`}</Badge>
              <textarea
                rows={1} placeholder="Διατύπωση ερώτησης…" value={item.text}
                onChange={(e) => patch(i, { text: e.target.value })}
                className="min-h-9 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-snug text-foreground focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
              />
              <button
                type="button" onClick={() => removeQ(i)} title="Διαγραφή ερώτησης"
                className="mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-dg-red-600 transition-colors hover:bg-dg-red-500/10 hover:text-dg-red-700"
              >
                <FiTrash2 className="size-4" />
              </button>
            </div>

            {/* Ρυθμίσεις ερώτησης */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1">
                <FieldLabel>Τύπος</FieldLabel>
                <select className={FIELD} value={item.answerType} onChange={(e) => patch(i, { answerType: e.target.value as AnswerType })}>
                  {ANSWER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              {weighted && (
                <label className="flex flex-col gap-1">
                  <FieldLabel>Βάρος</FieldLabel>
                  <input type="number" className={FIELD} value={item.weight ?? ''} onChange={(e) => patch(i, { weight: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <FieldLabel>Μέγιστα μόρια</FieldLabel>
                <input type="number" className={FIELD} value={item.maxPoints ?? ''} onChange={(e) => patch(i, { maxPoints: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>Πεδίο εταιρίας</FieldLabel>
                <select className={FIELD} value={item.companyField ?? ''} onChange={(e) => patch(i, { companyField: (e.target.value || null) as CompanyField | null })}>
                  {COMPANY_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
            </div>

            {/* Επιλογές */}
            {(item.answerType === 'SINGLE_CHOICE' || item.answerType === 'SCALE') && (
              <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                <FieldLabel>Επιλογές & μόρια</FieldLabel>
                <div className="mt-2 space-y-2">
                  {item.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input
                        className={FIELD + ' flex-1'} placeholder="Κείμενο επιλογής"
                        value={o.label} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, label: e.target.value } : x) })}
                      />
                      <input
                        type="number" className={FIELD + ' w-20 text-center'} placeholder="μόρια"
                        value={o.points} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, points: Number(e.target.value) } : x) })}
                      />
                      <button
                        type="button" onClick={() => patch(i, { options: item.options.filter((_, j) => j !== oi) })} title="Αφαίρεση επιλογής"
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-dg-red-600 transition-colors hover:bg-dg-red-500/10 hover:text-dg-red-700"
                      >
                        <FiTrash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button" onClick={() => patch(i, { options: [...item.options, { label: '', points: 0 }] })}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-sisyphus-600 hover:text-sisyphus-700"
                  >
                    <FiPlus className="size-3.5" /> Προσθήκη επιλογής
                  </button>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>

      {/* ── Ενέργειες ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <button
          type="button" onClick={addQ}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <FiPlus className="size-4" /> Προσθήκη ερώτησης
        </button>
        <button
          type="button" disabled={busy} onClick={save}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-4 text-[13px] font-semibold text-white shadow-fluent-2 transition-colors hover:bg-sisyphus-600 disabled:opacity-50"
        >
          <FiSave className="size-4" /> Αποθήκευση
        </button>
      </div>
    </div>
  );
}
