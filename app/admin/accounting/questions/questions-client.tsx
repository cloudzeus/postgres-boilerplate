'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiCheck, FiEdit2, FiTool, FiCopy, FiAlertTriangle, FiClock } from 'react-icons/fi';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import { RegistrySearch, type RegistryPick } from '@/components/admin/registry-search';
import type { AccountingQuestion, AnswerStatus, QuestionGroup } from '@/lib/accounting/questions';

const SECTION = 'rounded-xl border border-border bg-card shadow-fluent-2';
const MUTED = 'text-[length:var(--fs-12)] text-muted-foreground';
const GROUP_ORDER: QuestionGroup[] = ['family', 'utility', 'registry', 'account'];

const STATUS_CHIP: Record<AnswerStatus, { text: string; cls: string }> = {
  ACCEPTED: { text: 'Εγκρίθηκε', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CHANGED: { text: 'Άλλαξε', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  NEEDS_ERP: { text: 'Θέμα για integrator', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const isOpen = (q: AccountingQuestion) => !q.answer || q.answer.stale;

async function postAnswer(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/accounting/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message ?? 'Η απάντηση δεν αποθηκεύτηκε.');
  return d as { applied: null | { rules: number; manualLines: number; rematch: { docs: number; filled: number } }; integratorItem: string | null };
}

function QuestionCard({ q, canAnswer }: { q: AccountingQuestion; canAnswer: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<null | 'change' | 'erp'>(null);
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const base = { key: q.key, title: q.title, fingerprint: q.fingerprint };

  const send = async (status: AnswerStatus, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const d = await postAnswer({ ...base, status, comment: comment.trim() || undefined, ...extra });
      if (d.applied) toast.success(`Άλλαξαν ${d.applied.rules} κανόνες · επανεφαρμογή σε ${d.applied.rematch.docs} ανοιχτά παραστατικά${d.applied.manualLines ? ` (μαζί ${d.applied.manualLines} χειροκίνητες γραμμές)` : ''}.`);
      else if (d.integratorItem) toast.success('Καταγράφηκε στην αναφορά του integrator.');
      else toast.success('Εγκρίθηκε.');
      setMode(null); setComment('');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (p: RegistryPick) => send('CHANGED', { target: { kind: p.kind, id: p.id } });

  const chip = q.answer ? STATUS_CHIP[q.answer.status] : null;
  return (
    <li className={`${SECTION} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--fs-14)] font-semibold text-foreground">{q.title}</p>
          <p className="mt-1 text-[length:var(--fs-13)] text-foreground/90">{q.question}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {q.lines > 0 && <span className={`rounded-full border border-border px-2 py-0.5 ${MUTED}`}>{q.lines} {q.lines === 1 ? 'γραμμή' : 'γραμμές'}</span>}
          {chip && !q.answer?.stale && <span className={`rounded-full border px-2 py-0.5 text-[length:var(--fs-12)] ${chip.cls}`}>{chip.text}</span>}
          {q.answer?.stale && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[length:var(--fs-12)] text-amber-800">
              <FiClock className="size-3" aria-hidden />Άλλαξε από την απάντηση
            </span>
          )}
          {!q.answer && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[length:var(--fs-12)] text-rose-700">Αναπάντητο</span>}
        </div>
      </div>
      {q.answer && (
        <p className={`mt-2 ${MUTED}`}>
          {q.answer.answeredBy ?? '—'} · {new Date(q.answer.answeredAt).toLocaleString('el-GR')}
          {q.answer.comment ? <> · «{q.answer.comment}»</> : null}
        </p>
      )}

      {canAnswer && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void send('ACCEPTED')}>
            <FiCheck className="size-4" aria-hidden />Συμφωνώ
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setMode(mode === 'change' ? null : 'change')} aria-expanded={mode === 'change'}>
            <FiEdit2 className="size-4" aria-hidden />Αλλαγή
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setMode(mode === 'erp' ? null : 'erp')} aria-expanded={mode === 'erp'}>
            <FiTool className="size-4" aria-hidden />Χρειάζεται ενέργεια στο SoftOne
          </button>
        </div>
      )}

      {mode === 'change' && q.changeKind && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className={MUTED}>
            Διάλεξε {q.changeKind === 'expense' ? 'το έξοδο' : 'τη χρεοπίστωση'} όπου πρέπει να πηγαίνουν αυτές οι γραμμές. Η αλλαγή εφαρμόζεται αμέσως στα ανοιχτά παραστατικά.
          </p>
          <RegistrySearch kind={q.changeKind} onPick={pick} disabled={busy} id={`q-${q.key}`} label={q.changeKind === 'expense' ? 'Αναζήτηση εξόδου…' : 'Αναζήτηση χρεοπίστωσης…'} />
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Σχόλιο (προαιρετικό)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[length:var(--fs-13)]"
          />
        </div>
      )}
      {(mode === 'erp' || (mode === 'change' && !q.changeKind)) && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <label htmlFor={`c-${q.key}`} className={MUTED}>
            {mode === 'erp'
              ? 'Τι πρέπει να γίνει στο SoftOne; Καταγράφεται αυτόματα στην αναφορά του integrator.'
              : 'Περιέγραψε την αλλαγή (λογαριασμός, ονομασία, ΦΠΑ…). Καταγράφεται αυτόματα στην αναφορά του integrator.'}
          </label>
          <textarea
            id={`c-${q.key}`} value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[length:var(--fs-13)]"
          />
          <div className="flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy || !comment.trim()} onClick={() => void send(mode === 'erp' ? 'NEEDS_ERP' : 'CHANGED')}>
              Αποστολή
            </button>
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => setMode(null)}>Άκυρο</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function QuestionsClient({ questions, groupLabels, canAnswer }: {
  questions: AccountingQuestion[];
  groupLabels: Record<QuestionGroup, string>;
  canAnswer: boolean;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const open = questions.filter(isOpen);
  const needErp = questions.filter((q) => q.answer?.status === 'NEEDS_ERP' && !q.answer.stale).length;
  const shown = showAll ? questions : open;

  const copy = async () => {
    const text = GROUP_ORDER.flatMap((g) => {
      const qs = open.filter((q) => q.group === g);
      return qs.length ? [`## ${groupLabels[g]}`, ...qs.map((q, i) => `${i + 1}. ${q.question}`), ''] : [];
    }).join('\n');
    try { await navigator.clipboard.writeText(text); toast.success('Τα ανοιχτά ερωτήματα αντιγράφηκαν.'); }
    catch { toast.error('Η αντιγραφή απέτυχε.'); }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`${SECTION} p-4`}>
          <p className={MUTED}>Περιμένουν απάντηση</p>
          <p className="text-[length:var(--fs-20)] font-semibold text-foreground">{open.length}</p>
        </div>
        <div className={`${SECTION} p-4`}>
          <p className={MUTED}>Απαντήθηκαν</p>
          <p className="text-[length:var(--fs-20)] font-semibold text-foreground">{questions.length - open.length}</p>
        </div>
        <Link href="/admin/accounting/integrator" className={`${SECTION} p-4 hover:border-sisyphus-300`}>
          <p className={MUTED}>Έγιναν θέμα για τον integrator</p>
          <p className="text-[length:var(--fs-20)] font-semibold text-foreground">{needErp}</p>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="inline-flex rounded-lg border border-border p-0.5">
          {[{ v: false, t: `Ανοιχτά (${open.length})` }, { v: true, t: `Όλα (${questions.length})` }].map((o) => (
            <button
              key={String(o.v)} type="button" role="tab" aria-selected={showAll === o.v} onClick={() => setShowAll(o.v)}
              className={`min-h-9 rounded-md px-3 text-[length:var(--fs-13)] ${showAll === o.v ? 'bg-sisyphus-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >{o.t}</button>
          ))}
        </div>
        <button type="button" className={BTN_GHOST} onClick={() => void copy()} disabled={!open.length}>
          <FiCopy className="size-4" aria-hidden />Αντιγραφή ανοιχτών ως κείμενο
        </button>
      </div>

      {!shown.length && (
        <div className={`${SECTION} flex items-center gap-2 p-6 ${MUTED}`}>
          <FiCheck className="size-4 text-emerald-600" aria-hidden />Δεν υπάρχουν ανοιχτά ερωτήματα. Κάθε νέα απόφαση της εφαρμογής θα εμφανιστεί εδώ αυτόματα.
        </div>
      )}

      {GROUP_ORDER.map((g) => {
        const qs = shown.filter((q) => q.group === g);
        if (!qs.length) return null;
        return (
          <section key={g} className="space-y-2">
            <h2 className="text-[length:var(--fs-14)] font-semibold text-foreground">{groupLabels[g]} <span className={MUTED}>({qs.length})</span></h2>
            <ul className="space-y-2">{qs.map((q) => <QuestionCard key={q.key} q={q} canAnswer={canAnswer} />)}</ul>
          </section>
        );
      })}

      {!canAnswer && (
        <p className={`flex items-center gap-1.5 ${MUTED}`}><FiAlertTriangle className="size-3.5" aria-hidden />Βλέπεις τα ερωτήματα χωρίς δικαίωμα απάντησης.</p>
      )}
    </div>
  );
}
