'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { durationText, elapsedSuffix, useElapsedSeconds } from '@/lib/use-elapsed';
import { FiSend, FiCheck, FiAlertTriangle, FiLoader, FiDatabase, FiTruck, FiArrowRight, FiUserCheck } from 'react-icons/fi';
import { DeliveryNoteDialog } from '@/components/admin/delivery-note-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { DOC_CATEGORY_OPTIONS } from '@/lib/ocr/doc-category';
import { useDocLinesChanged, emitDocLinesChanged, emitDocTool, focusSection, DOC_SECTION } from '@/components/admin/doc-lines-events';
import { blockerFix } from '@/lib/ocr/blocker-fix';
import { Term } from '@/components/admin/help/term';

export interface ActionBarSeries {
  code: string; abbrev: string | null; name: string; family: string; sosource: number; enabled: boolean;
}

type Preview = {
  blockers: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  enabled: boolean;
  postStatus?: string | null;
  postedRef?: string | null;
};

/**
 * Η ΣΤΑΘΕΡΗ ΜΠΑΡΑ ΕΝΕΡΓΕΙΩΝ της σελίδας του παραστατικού — ίδια λογική με το κάτω μέρος του
 * ανοιγμένου πλαισίου στη λίστα.
 *
 * ΓΙΑΤΙ. Η καταχώριση ζούσε στο ΤΕΛΟΣ της σελίδας, μέσα στην κάρτα «JSON εγγράφου»: ο χρήστης
 * διόρθωνε στην κορυφή και έπρεπε να μαντέψει ότι το κουμπί είναι κάτω από το πρότυπο και το JSON.
 * Και η «κατηγορία εγγράφου», που είναι εμπόδιο της καταχώρισης, ΔΕΝ ορίζόταν πουθενά σε αυτή τη
 * σελίδα — η σελίδα έλεγε «δεν μπορείς» χωρίς να δίνει τρόπο. Εδώ, πάντα ορατά: σειρά, κατηγορία,
 * τα εμπόδια που μένουν, και η καταχώριση.
 *
 * Σειρά και κατηγορία ΑΠΟΘΗΚΕΥΟΝΤΑΙ ΑΜΕΣΩΣ (ίδιο `PATCH` με τη λίστα): είναι επιλογές, όχι κείμενο,
 * και ένα «Αποθήκευση» μετά από κάθε dropdown θα ήταν ένα βήμα που ξεχνιέται.
 */
export function DocActionBar({
  docId, series, initialSeriesKey, initialCategory, canEdit, canPost,
}: {
  docId: string;
  series: ActionBarSeries[];
  initialSeriesKey: string;
  initialCategory: string | null;
  canEdit: boolean;
  canPost: boolean;
}) {
  const router = useRouter();
  const [seriesKey, setSeriesKey] = React.useState(initialSeriesKey);
  const [category, setCategory] = React.useState(initialCategory ?? '');
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const postingFor = useElapsedSeconds(posting);
  const [confirm, setConfirm] = React.useState(false);
  const [tenant, setTenant] = React.useState<string | null>(null);
  /** Το αποτέλεσμα του ελέγχου διπλοτύπου — τρέχει ΠΡΙΝ εμφανιστεί το «Ναι, καταχώρισέ το». */
  const [dup, setDup] = React.useState<{ status: 'duplicate' | 'clear' | 'unknown'; message: string } | null>(null);
  const [dupBusy, setDupBusy] = React.useState(false);
  const dupFor = useElapsedSeconds(dupBusy);
  const [markBusy, setMarkBusy] = React.useState(false);
  /** «Από δελτίο αποστολής» — μετασχηματισμός αντί για απλή καταχώριση. */
  const [noteOpen, setNoteOpen] = React.useState(false);

  /** Ο ΜΑΡΚ σε ήδη καταχωρισμένο παραστατικό (όσα καταχωρίστηκαν πριν η εφαρμογή γράφει το σωστό πεδίο). */
  async function syncMark() {
    setMarkBusy(true);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/sync-mark`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.message ?? 'Η ενημέρωση ΜΑΡΚ απέτυχε.'); return; }
      toast.success(d.changed ? `Ο ΜΑΡΚ ${d.mark} γράφτηκε στο FINDOC ${d.ref}.` : `Το FINDOC ${d.ref} έχει ήδη τον ΜΑΡΚ ${d.mark}.`);
    } catch {
      toast.error('Σφάλμα δικτύου — ο ΜΑΡΚ δεν ενημερώθηκε.');
    } finally { setMarkBusy(false); }
  }

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/post-softone?dryRun=1`, { cache: 'no-store' });
      if (r.ok) setPreview(await r.json());
    } catch { /* η μπάρα δείχνει «έλεγχος…» — δεν ρίχνει τη σελίδα */ }
  }, [docId]);
  React.useEffect(() => { void load(); }, [load]);
  useDocLinesChanged(docId, () => { void load(); });
  React.useEffect(() => {
    fetch('/api/admin/softone/connection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.tenantKey) setTenant(String(j.tenantKey).split('|')[0]); })
      .catch(() => null);
  }, []);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
      await load();
      emitDocLinesChanged(docId);   // ο προορισμός άλλαξε ⇒ η λωρίδα ελέγχων ξαναρωτά
      router.refresh();
    } catch (e) {
      toast.error(`Δεν αποθηκεύτηκε: ${(e as Error).message}`);
    } finally { setSaving(false); }
  }

  /**
   * ΕΛΕΓΧΟΣ ΔΙΠΛΟΤΥΠΟΥ ΤΗ ΣΤΙΓΜΗ ΠΟΥ ΜΕΤΡΑΕΙ — λίγο πριν σταλεί, με τον συναλλασσόμενο που έχει
   * πλέον δεθεί (το SoftOne ψάχνει διπλό ανά καρτέλα). Τρεις καταστάσεις: «βρέθηκε» ΜΠΛΟΚΑΡΕΙ,
   * «καθαρό» επιτρέπει, «δεν απάντησε» επιτρέπει με προειδοποίηση — ποτέ ψεύτικη σιγουριά.
   */
  async function askConfirm() {
    setDupBusy(true);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/duplicate-check`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      setDup({ status: j.status ?? 'unknown', message: j.message ?? 'Ο έλεγχος διπλοτύπου δεν απάντησε.' });
      setConfirm(true);
    } finally { setDupBusy(false); }
  }

  async function post() {
    setPosting(true);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/post-softone`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);
      toast.success(`Καταχωρήθηκε στο SoftOne · FINDOC ${j.ref}${durationText(j.timings?.total)}`);
      setConfirm(false);
      await load();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setPosting(false); }
  }

  const posted = preview?.postStatus === 'POSTED';
  const blockers = preview?.blockers ?? [];
  const [blockersOpen, setBlockersOpen] = React.useState(false);
  /** «Λύσε»: πήγαινε στο σημείο που διορθώνει το εμπόδιο, ή άνοιξε το εργαλείο. */
  const runFix = (t: NonNullable<ReturnType<typeof blockerFix>>['target']) => {
    setBlockersOpen(false);
    setTimeout(() => {
      if (t.kind === 'tool') { if (!emitDocTool(docId, { tool: t.tool })) toast.error('Άνοιξε τη σελίδα του παραστατικού για να το διορθώσεις.'); return; }
      if (t.kind === 'section' && !focusSection(DOC_SECTION[t.section])) {
        toast.message('Το σημείο αυτό δεν εμφανίζεται εδώ — άνοιξε τη σελίδα του παραστατικού.');
      }
    }, 120);
  };
  const ready = !!preview && blockers.length === 0 && !posted;
  const families = [...new Set(series.map((s) => s.family))];

  return (
    <div className="sticky bottom-0 z-30 -mx-6 border-t border-border bg-card/95 px-6 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex min-w-[14rem] flex-[2] flex-col gap-0.5">
          <span className={cn(LABEL, 'flex items-center gap-1')}><label htmlFor={DOC_SECTION.series}>Είδος παραστατικού στο SoftOne</label> <Term k="seira"><span className="sr-only">Τι είναι;</span></Term></span>
          <select
            id={DOC_SECTION.series}
            value={seriesKey} disabled={!canEdit || saving || posted}
            title={series.find((o) => `${o.sosource}:${o.code}` === seriesKey)?.name ?? 'Δεν έχει επιλεγεί σειρά'}
            onChange={(e) => {
              const v = e.target.value;
              setSeriesKey(v);
              const sep = v.indexOf(':');
              void patch({ softoneSeries: v ? v.slice(sep + 1) : null, seriesSource: v ? Number(v.slice(0, sep)) : null });
            }}
            className={SELECT}
          >
            <option value="">— Επιλογή σειράς —</option>
            {families.map((f) => (
              <optgroup key={f} label={f}>
                {series.filter((o) => o.family === f).map((o) => (
                  <option key={`${o.sosource}:${o.code}`} value={`${o.sosource}:${o.code}`} disabled={!o.enabled}>
                    {o.abbrev ? `${o.abbrev} · ` : ''}{o.name}{o.enabled ? '' : ' (ανενεργή)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
          <span className={cn(LABEL, 'flex items-center gap-1')}><label htmlFor={DOC_SECTION.category}>Κατηγορία</label> <Term k="kategoria"><span className="sr-only">Τι είναι;</span></Term></span>
          <select
            id={DOC_SECTION.category}
            value={category} disabled={!canEdit || saving || posted}
            title={DOC_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? 'Δεν έχει επιλεγεί κατηγορία'}
            onChange={(e) => { setCategory(e.target.value); void patch({ category: e.target.value || null }); }}
            className={cn(SELECT, !category && 'border-amber-400')}
          >
            <option value="">— Επιλογή —</option>
            {DOC_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Η ΚΑΤΑΣΤΑΣΗ σε μία γραμμή: έτοιμο, ή πόσα εμπόδια μένουν — με τη λίστα ένα πάτημα μακριά. */}
        <div className="flex min-h-8 flex-1 items-center">
          {!preview ? (
            <span className={STATUS}><FiLoader className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> Έλεγχος…</span>
          ) : posted ? (
            <span className={cn(STATUS, 'flex-wrap gap-2')}>
              <FiCheck className="size-3.5" style={{ color: '#047857' }} aria-hidden /> Καταχωρήθηκε · FINDOC {preview.postedRef}
              {canPost && (
                <button
                  type="button" onClick={syncMark} disabled={markBusy}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-[length:var(--fs-12)] font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                  title="Γράφει τον ΜΑΡΚ της ανάγνωσης στο καταχωρισμένο παραστατικό, αν λείπει"
                >
                  {markBusy ? <FiLoader className="size-3.5 animate-spin" aria-hidden /> : <FiDatabase className="size-3.5" aria-hidden />}
                  Ενημέρωση ΜΑΡΚ
                </button>
              )}
            </span>
          ) : blockers.length === 0 ? (
            <span className={STATUS}><FiCheck className="size-3.5" style={{ color: '#047857' }} aria-hidden /> Έτοιμο για καταχώριση</span>
          ) : (
            <Popover open={blockersOpen} onOpenChange={setBlockersOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={cn(STATUS, 'cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted')}>
                  <FiAlertTriangle className="size-3.5" style={{ color: '#B45309' }} aria-hidden />
                  {blockers.length === 1 ? 'Μένει 1 βήμα' : `Μένουν ${blockers.length} βήματα`}
                  <span className="text-muted-foreground underline decoration-dotted underline-offset-2">ποια;</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[32rem] max-w-[92vw] p-0">
                <p className="border-b border-border px-3 py-2 text-[length:var(--fs-12)] font-semibold text-foreground">Τι μένει πριν την καταχώριση</p>
                <ol className="max-h-[60dvh] divide-y divide-border overflow-auto text-[length:var(--fs-12)] text-foreground">
                  {blockers.map((b, i) => {
                    const fix = blockerFix(b.code);
                    return (
                      <li key={b.code} className="flex items-start gap-2 px-3 py-2">
                        <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-amber-100 text-[length:var(--fs-10)] font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{i + 1}</span>
                        <span className="min-w-0 flex-1 leading-snug">{b.message}</span>
                        {fix && fix.target.kind !== 'admin' ? (
                          <button type="button" onClick={() => runFix(fix.target)}
                            className="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 text-[length:var(--fs-12)] font-semibold text-white hover:bg-sisyphus-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {fix.label} <FiArrowRight aria-hidden className="size-3.5" />
                          </button>
                        ) : fix ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[length:var(--fs-11)] font-semibold text-muted-foreground"><FiUserCheck aria-hidden className="size-3.5" /> {fix.label}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {confirm ? (
            <>
              <span className="flex max-w-[26rem] items-start gap-1.5 text-[length:var(--fs-11)] font-semibold text-foreground">
                {dup?.status === 'duplicate'
                  ? <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: '#B91C1C' }} aria-hidden />
                  : dup?.status === 'clear'
                    ? <FiCheck className="mt-0.5 size-3.5 shrink-0" style={{ color: '#047857' }} aria-hidden />
                    : <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: '#B45309' }} aria-hidden />}
                <span>
                  {dup?.message}{' '}
                  {dup?.status !== 'duplicate' && <><FiDatabase className="inline size-3.5 text-muted-foreground" aria-hidden /> Καταχώριση{tenant ? ` στο ${tenant}` : ''};</>}
                </span>
              </span>
              <button type="button" onClick={() => { setConfirm(false); setDup(null); }} className={BTN_GHOST}>Πίσω</button>
              {dup?.status === 'duplicate' && (
                // Διπλό = δεν καταχωρείται (προστασία από διπλή εγγραφή). Αν όμως ΔΙΑΒΑΣΤΗΚΕ λάθος ο
                // αριθμός ή η ημερομηνία, η διόρθωση είναι στα πεδία — όχι αδιέξοδο.
                <button type="button" title="Αν διαβάστηκε λάθος αριθμός ή ημερομηνία, διόρθωσέ τα και ξαναδοκίμασε"
                  onClick={() => { setConfirm(false); setDup(null); setTimeout(() => focusSection(DOC_SECTION.fields), 120); }} className={BTN_GHOST}>
                  Διόρθωση αριθμού / ημερομηνίας
                </button>
              )}
              {dup?.status !== 'duplicate' && (
                <button type="button" onClick={post} disabled={posting} className={BTN_POST}>
                  <FiSend className="size-3.5" /> {posting ? `Καταχώριση…${elapsedSuffix(postingFor)}` : 'Ναι, καταχώρισέ το'}
                </button>
              )}
            </>
          ) : (
            <>
            {canPost && !posted && (
              <button type="button" onClick={() => setNoteOpen(true)} className={BTN_GHOST}
                title="Το τιμολόγιο ήρθε μετά το δελτίο αποστολής: σύγκριση με τα ανοιχτά δελτία του προμηθευτή και μετασχηματισμός σε τιμολόγιο">
                <FiTruck className="size-3.5" /> Από δελτίο αποστολής
              </button>
            )}
            <button type="button" disabled={!canPost || !ready || posting || dupBusy} onClick={askConfirm} className={BTN_POST}
              title={!canPost ? 'Δεν έχεις δικαίωμα καταχώρισης' : posted ? 'Έχει ήδη καταχωρηθεί' : !ready ? 'Λύσε πρώτα τα βήματα που μένουν' : undefined}>
              {dupBusy ? <FiLoader className="size-3.5 animate-spin" /> : <FiSend className="size-3.5" />}
              {posted ? 'Καταχωρήθηκε' : dupBusy ? `Έλεγχος διπλοτύπου…${elapsedSuffix(dupFor)}` : 'Καταχώριση στο SoftOne'}
            </button>
            </>
          )}
        </div>
      </div>
      {noteOpen && <DeliveryNoteDialog docId={docId} open={noteOpen} onOpenChange={setNoteOpen} onDone={() => void load()} />}
    </div>
  );
}

const LABEL = 'text-[length:var(--fs-11)] font-semibold text-muted-foreground';
const SELECT =
  'h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-[length:var(--fs-12)] text-foreground ' +
  'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:cursor-not-allowed disabled:opacity-60';
const STATUS = 'inline-flex items-center gap-1.5 text-[length:var(--fs-12)] font-semibold text-foreground';
const BTN_POST =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-emerald-700 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none';
const BTN_GHOST =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[length:var(--fs-12)] font-semibold text-foreground transition hover:bg-muted';
