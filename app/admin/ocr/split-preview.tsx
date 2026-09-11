'use client';

// Η οθόνη που κόβει ένα σαρωμένο PDF σε παραστατικά. Η πρόταση του `suggestSplits` είναι η αρχή,
// όχι η απόφαση: ανάμεσα σε δύο σελίδες υπάρχει ένα ΨΑΛΙΔΙ που ανοιγοκλείνει με ένα κλικ (ή με
// πληκτρολόγιο — είναι κανονικό <button> με `aria-pressed`), και τα τμήματα χρωματίζονται εναλλάξ
// ώστε να φαίνεται αμέσως τι θα γίνει.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiScissors, FiCheck, FiLoader, FiAlertTriangle, FiX } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { segmentsOf } from '@/lib/ocr/split';

export interface SplitPreviewData {
  batchId: string;
  pageCount: number;
  hasTextLayer: boolean;
  suggested: number[];
  pages: { index: number; thumbUrl: string }[];
  fileName: string;
}

type Phase = 'editing' | 'splitting' | 'reading';

export function OcrSplitPreview({ data, onCancel }: { data: SplitPreviewData; onCancel: () => void }) {
  const router = useRouter();
  const [cuts, setCuts] = React.useState<number[]>(() => data.suggested);
  const [phase, setPhase] = React.useState<Phase>('editing');
  const [readDone, setReadDone] = React.useState(0);
  const [readTotal, setReadTotal] = React.useState(0);
  const [failed, setFailed] = React.useState(0);

  const busy = phase !== 'editing';
  const segments = React.useMemo(() => segmentsOf(cuts, data.pageCount), [cuts, data.pageCount]);
  /** Σε ποιο τμήμα ανήκει κάθε σελίδα — για τον εναλλασσόμενο χρωματισμό και τις ετικέτες. */
  const segmentOfPage = React.useMemo(() => {
    const map = new Map<number, number>();
    segments.forEach((s, i) => { for (let p = s.from; p <= s.to; p++) map.set(p, i); });
    return map;
  }, [segments]);

  const toggleCut = (page: number) => {
    if (busy || page <= 0) return;
    setCuts((prev) => (prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page].sort((a, b) => a - b)));
  };

  async function confirm() {
    setPhase('splitting');
    try {
      const res = await fetch('/api/admin/ocr/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: data.batchId, cuts }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      const docs: { id: string }[] = json.documents ?? [];
      setPhase('reading');
      setReadTotal(docs.length);
      setReadDone(0);
      let errors = 0;

      // Ένα-ένα, με τη σειρά: κάθε ανάγνωση είναι δικό της αίτημα, ώστε να μην υπάρχει όριο
      // χρόνου και ο χρήστης να βλέπει πρόοδο αντί για έναν φορτωτή που δεν λέει τίποτα.
      for (const doc of docs) {
        try {
          const r = await fetch(`/api/admin/ocr/${doc.id}/extract`, { method: 'POST' });
          if (!r.ok) errors += 1;
        } catch {
          errors += 1;
        }
        setReadDone((n) => n + 1);
        setFailed(errors);
      }

      if (errors > 0) {
        toast.warning(`Ολοκληρώθηκε με ${errors} αποτυχίες — δοκίμασε επανασκανάρισμα σε αυτά.`);
      } else {
        toast.success(`Δημιουργήθηκαν ${docs.length} παραστατικά`);
      }
      router.push(`/admin/ocr/batches/${data.batchId}`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία διαχωρισμού: ${err?.message ?? err}`);
      setPhase('editing');
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-sisyphus-50 via-card to-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
            <FiScissors className="size-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">Διαχωρισμός σε παραστατικά</h3>
            <p className="text-[11px] text-muted-foreground">
              {data.fileName} · {data.pageCount} σελίδες · {segments.length} παραστατικά
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={() => setCuts(data.suggested)}>Αυτόματα</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={() => setCuts(Array.from({ length: data.pageCount }, (_, i) => i))}>Ένα ανά σελίδα</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={() => setCuts([0])}>Καθαρισμός</Button>
        </div>
      </header>

      {!data.hasTextLayer && (
        <p className="flex items-start gap-2 border-b border-border bg-amber-500/10 px-5 py-2.5 text-[12px] text-amber-900 dark:text-amber-200">
          <FiAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Το PDF είναι σαρωμένο (χωρίς κείμενο), οπότε δεν υπάρχουν ενδείξεις για το πού αλλάζει
            παραστατικό. Η πρόταση είναι <strong>ένα παραστατικό ανά σελίδα</strong> — έλεγξε τις
            σελίδες και ένωσε όσες ανήκουν στο ίδιο παραστατικό κλείνοντας το ψαλίδι.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-stretch gap-y-6 p-5">
        {data.pages.map((page) => {
          const segIndex = segmentOfPage.get(page.index) ?? 0;
          const seg = segments[segIndex];
          const isCut = cuts.includes(page.index);
          const isFirstOfSegment = seg?.from === page.index;
          return (
            <React.Fragment key={page.index}>
              {page.index > 0 && (
                <button
                  type="button"
                  onClick={() => toggleCut(page.index)}
                  disabled={busy}
                  aria-pressed={isCut}
                  aria-label={isCut
                    ? `Κατάργηση κοψίματος πριν από τη σελίδα ${page.index + 1}`
                    : `Κόψιμο πριν από τη σελίδα ${page.index + 1}`}
                  title={isCut ? 'Ένωση με το προηγούμενο' : 'Κόψιμο εδώ'}
                  className={cn(
                    'mx-1 flex w-7 shrink-0 flex-col items-center justify-center gap-1 rounded-md border transition',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 disabled:opacity-50',
                    isCut
                      ? 'border-sisyphus-500 bg-sisyphus-500/10 text-sisyphus-600'
                      : 'border-dashed border-input text-muted-foreground hover:border-sisyphus-500/50 hover:text-sisyphus-600',
                  )}
                >
                  <FiScissors className="size-4" />
                  <span className="text-[9px] font-bold uppercase tracking-wider">
                    {isCut ? 'κοπή' : 'ένωση'}
                  </span>
                </button>
              )}

              <figure
                className={cn(
                  'flex w-[132px] shrink-0 flex-col rounded-lg border p-1.5',
                  segIndex % 2 === 0
                    ? 'border-sisyphus-500/30 bg-sisyphus-500/5'
                    : 'border-border bg-neutral-6/40',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.thumbUrl}
                  alt={`Σελίδα ${page.index + 1}`}
                  loading="lazy"
                  className="h-[168px] w-full rounded bg-white object-contain"
                />
                <figcaption className="mt-1 text-center text-[10px] leading-tight text-muted-foreground">
                  <span className="font-semibold text-foreground">Σελ. {page.index + 1}</span>
                  {isFirstOfSegment && seg && (
                    <span className="mt-0.5 block text-[9px] font-bold uppercase leading-tight tracking-wider text-sisyphus-600">
                      Παραστατικό {segIndex + 1}, σελ. {seg.from + 1}
                      {seg.to > seg.from ? `-${seg.to + 1}` : ''}
                    </span>
                  )}
                </figcaption>
              </figure>
            </React.Fragment>
          );
        })}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-neutral-6/50 px-5 py-3">
        <p className="text-[12px] text-muted-foreground">
          {phase === 'reading'
            ? `Ανάγνωση ${readDone}/${readTotal}${failed ? ` · ${failed} αποτυχίες` : ''}…`
            : phase === 'splitting'
              ? 'Δημιουργία αρχείων…'
              : `Θα δημιουργηθούν ${segments.length} παραστατικά σε φάκελο.`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            <FiX className="mr-1.5 size-4" /> Άκυρο
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy
              ? <><FiLoader className="mr-1.5 size-4 animate-spin" /> Επεξεργασία…</>
              : <><FiCheck className="mr-1.5 size-4" /> Δημιουργία {segments.length} παραστατικών</>}
          </Button>
        </div>
      </footer>
    </section>
  );
}
