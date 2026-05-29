// app/admin/programs/[id]/questionnaire-tab.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiPlus, FiTrash2, FiSave } from 'react-icons/fi';
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

const ANSWER_TYPES: AnswerType[] = ['SINGLE_CHOICE', 'SCALE', 'BOOLEAN', 'NUMERIC'];
const COMPANY_FIELDS: (CompanyField | '')[] = ['', 'legalForm', 'operationalYears', 'employeeCount', 'region', 'kad'];

export function QuestionnaireTab({ programId, initial }: { programId: string; initial: QuestionnaireData | null }) {
  const router = useRouter();
  const [q, setQ] = React.useState<QuestionnaireData>(initial ?? { scoringModel: 'WEIGHTED', threshold: 75, maxScore: 100, sourceNote: null, questions: [] });
  const [busy, setBusy] = React.useState(false);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">Μοντέλο
          <select className="ml-2 rounded border p-1" value={q.scoringModel} onChange={(e) => setQ({ ...q, scoringModel: e.target.value as ScoringModel })}>
            <option value="WEIGHTED">WEIGHTED</option><option value="POINTS_SUM">POINTS_SUM</option>
          </select>
        </label>
        <label className="text-xs">Κατώφλι
          <input type="number" className="ml-2 w-20 rounded border p-1" value={q.threshold ?? ''} onChange={(e) => setQ({ ...q, threshold: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="text-xs">Max
          <input type="number" className="ml-2 w-20 rounded border p-1" value={q.maxScore ?? ''} onChange={(e) => setQ({ ...q, maxScore: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <button type="button" disabled={busy} onClick={generate} className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">🪄 Δημιουργία/Αναδημιουργία με AI</button>
      </div>

      {q.questions.map((item, i) => (
        <div key={i} className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{item.code ?? `Q${i + 1}`}</Badge>
            <input className="flex-1 rounded border p-1 text-sm" placeholder="Ερώτηση" value={item.text} onChange={(e) => patch(i, { text: e.target.value })} />
            <button type="button" onClick={() => removeQ(i)} className="text-red-600"><FiTrash2 /></button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <select className="rounded border p-1" value={item.answerType} onChange={(e) => patch(i, { answerType: e.target.value as AnswerType })}>
              {ANSWER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" className="w-20 rounded border p-1" placeholder="weight" value={item.weight ?? ''} onChange={(e) => patch(i, { weight: e.target.value === '' ? null : Number(e.target.value) })} />
            <input type="number" className="w-24 rounded border p-1" placeholder="maxPoints" value={item.maxPoints ?? ''} onChange={(e) => patch(i, { maxPoints: e.target.value === '' ? null : Number(e.target.value) })} />
            <select className="rounded border p-1" value={item.companyField ?? ''} onChange={(e) => patch(i, { companyField: (e.target.value || null) as CompanyField | null })}>
              {COMPANY_FIELDS.map((f) => <option key={f} value={f}>{f === '' ? 'χειροκίνητο' : f}</option>)}
            </select>
          </div>
          {(item.answerType === 'SINGLE_CHOICE' || item.answerType === 'SCALE') && (
            <div className="space-y-1 pl-4">
              {item.options.map((o, oi) => (
                <div key={oi} className="flex gap-2">
                  <input className="flex-1 rounded border p-1 text-xs" placeholder="Επιλογή" value={o.label} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, label: e.target.value } : x) })} />
                  <input type="number" className="w-20 rounded border p-1 text-xs" placeholder="μόρια" value={o.points} onChange={(e) => patch(i, { options: item.options.map((x, j) => j === oi ? { ...x, points: Number(e.target.value) } : x) })} />
                  <button type="button" onClick={() => patch(i, { options: item.options.filter((_, j) => j !== oi) })} className="text-red-600"><FiTrash2 /></button>
                </div>
              ))}
              <button type="button" onClick={() => patch(i, { options: [...item.options, { label: '', points: 0 }] })} className="text-xs text-violet-600"><FiPlus className="inline" /> επιλογή</button>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button type="button" onClick={addQ} className="rounded border px-3 py-1.5 text-sm"><FiPlus className="inline" /> Ερώτηση</button>
        <button type="button" disabled={busy} onClick={save} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"><FiSave className="inline" /> Αποθήκευση</button>
      </div>
    </div>
  );
}
