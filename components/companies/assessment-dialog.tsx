// components/companies/assessment-dialog.tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { computeScore } from '@/lib/programs/assessment-score';
import type { ScoringQuestion, ScoringAnswer, ScoringModel } from '@/lib/programs/questionnaire-types';

interface ProgramOption { id: string; title: string }

export function AssessmentDialog({ companyId, companyName, open, onClose, presetProgramId, onSaved }: { companyId: string | null; companyName: string; open: boolean; onClose: () => void; presetProgramId?: string | null; onSaved?: () => void }) {
  const router = useRouter();
  const [programs, setPrograms] = React.useState<ProgramOption[]>([]);
  const [programId, setProgramId] = React.useState('');
  const [assessment, setAssessment] = React.useState<any>(null);
  const [answers, setAnswers] = React.useState<Record<string, ScoringAnswer>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setProgramId(''); setAssessment(null); setAnswers({}); return; }
    if (presetProgramId) setProgramId(presetProgramId);
    fetch('/api/admin/programs').then((r) => r.json()).then((d) => {
      const list = Array.isArray(d?.data) ? d.data : [];
      setPrograms(list.map((p: any) => ({ id: p.id, title: p.title })));
    }).catch(() => {});
  }, [open, presetProgramId]);

  async function start() {
    if (!companyId || !programId) { toast.error('Επίλεξε πρόγραμμα'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/assessments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ programId }),
      });
      if (!res.ok) { toast.error('Αποτυχία'); return; }
      const a = await res.json();
      setAssessment(a);
      const init: Record<string, ScoringAnswer> = {};
      for (const ans of a.answers ?? []) init[ans.questionId] = { questionId: ans.questionId, valueBool: ans.valueBool, valueNumber: ans.valueNumber == null ? null : Number(ans.valueNumber), selectedOptionId: ans.selectedOptionId };
      setAnswers(init);
    } finally { setBusy(false); }
  }

  const questions: ScoringQuestion[] = (assessment?.questionnaire?.questions ?? []).map((q: any) => ({
    id: q.id, answerType: q.answerType, weight: q.weight == null ? null : Number(q.weight),
    maxPoints: q.maxPoints == null ? null : Number(q.maxPoints), options: (q.options ?? []).map((o: any) => ({ id: o.id, points: Number(o.points) })),
  }));
  const qn = assessment?.questionnaire;
  const live = qn ? computeScore(qn.scoringModel as ScoringModel, qn.threshold == null ? null : Number(qn.threshold), qn.maxScore == null ? null : Number(qn.maxScore), questions, Object.values(answers)) : null;

  async function save() {
    if (!companyId || !assessment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/assessments/${assessment.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED', answers: Object.values(answers) }),
      });
      if (!res.ok) { toast.error('Αποτυχία αποθήκευσης'); return; }
      toast.success('Αποθηκεύτηκε'); onClose(); router.refresh(); onSaved?.();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Αξιολόγηση — {companyName}</DialogTitle></DialogHeader>

        {!assessment && (
          <div className="space-y-3">
            <select className="w-full rounded border p-2" value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">— Επίλεξε πρόγραμμα —</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button type="button" disabled={busy} onClick={start} className="rounded bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50">Έλεγχος κριτηρίων</button>
          </div>
        )}

        {assessment && (
          <div className="space-y-4">
            <div>
              <h4 className="mb-1 text-sm font-semibold">Βασικά κριτήρια {assessment.eligible ? <Badge className="bg-emerald-600">ΟΚ</Badge> : <Badge variant="destructive">FAIL</Badge>}</h4>
              <table className="w-full text-xs">
                <tbody>
                  {(assessment.eligibilityResult?.criteria ?? []).map((c: any) => (
                    <tr key={c.key} className="border-b">
                      <td className="py-1 font-medium">{c.label}</td>
                      <td className="py-1 text-muted-foreground">{c.actual ?? '—'}</td>
                      <td className="py-1">{c.required ?? c.note ?? ''}</td>
                      <td className="py-1 text-right">{c.pass ? '✅' : '❌'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {qn && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Ερωτηματολόγιο</h4>
                {qn.questions.map((q: any) => {
                  const a = answers[q.id] ?? { questionId: q.id };
                  const auto = (assessment.answers ?? []).find((x: any) => x.questionId === q.id && x.source === 'AUTO');
                  return (
                    <div key={q.id} className="rounded border p-2">
                      <div className="mb-1 text-sm">{q.text} {auto && <Badge variant="outline" className="ml-1">από στοιχεία εταιρίας</Badge>}</div>
                      {(q.answerType === 'SINGLE_CHOICE' || q.answerType === 'SCALE') && (
                        <select className="w-full rounded border p-1 text-sm" value={a.selectedOptionId ?? ''} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, selectedOptionId: e.target.value || null } }))}>
                          <option value="">—</option>
                          {q.options.map((o: any) => <option key={o.id} value={o.id}>{o.label} ({Number(o.points)})</option>)}
                        </select>
                      )}
                      {q.answerType === 'BOOLEAN' && (
                        <label className="text-sm"><input type="checkbox" checked={!!a.valueBool} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, valueBool: e.target.checked } }))} /> Ναι</label>
                      )}
                      {q.answerType === 'NUMERIC' && (
                        <input type="number" className="w-32 rounded border p-1 text-sm" value={a.valueNumber ?? ''} onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: { questionId: q.id, valueNumber: e.target.value === '' ? null : Number(e.target.value) } }))} />
                      )}
                    </div>
                  );
                })}
                {live && (
                  <div className={`rounded p-2 text-sm font-semibold ${live.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    Σκορ: {live.score.toFixed(1)} / {live.maxScore} — {live.passed ? 'PASS ✅' : 'FAIL ❌'} (κατώφλι {qn.threshold ?? '—'})
                  </div>
                )}
              </div>
            )}

            <button type="button" disabled={busy} onClick={save} className="rounded bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">Αποθήκευση στην εταιρία</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
