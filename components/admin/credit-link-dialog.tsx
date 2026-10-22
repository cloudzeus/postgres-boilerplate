'use client';

// «Σύνδεση πιστωτικού με το αρχικό»: ποιο τιμολόγιο πιστώνει αυτό το πιστωτικό. Προτείνεται αυτόματα
// όταν ο τυπωμένος αριθμός («Αφορά ΤΠΥ 17») ταιριάζει με καταχωρισμένο παραστατικό του ίδιου εκδότη·
// αλλιώς ο χρήστης διαλέγει από τη λίστα — ή δηλώνει ρητά «χωρίς αρχικό» (έκπτωση τζίρου κ.λπ.).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiAlertTriangle, FiCheckCircle, FiLink, FiLoader, FiSearch, FiSlash, FiZap } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RowHint } from '@/components/admin/form-kit';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import { cn } from '@/lib/utils';

interface Candidate { findoc: number; number: string | null; date: string | null; total: number | null; source: 'app' | 'softone'; label: string }
interface Data {
  printed: string | null; printedMark: string | null; linked: number | null; linkedLabel: string | null; noLink: boolean;
  suggested: Candidate | null; candidates: Candidate[]; softoneError: string | null;
}

export function CreditLinkDialog({ docId, canEdit, onClose }: { docId: string; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/ocr/${docId}/credit-link`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.message ?? `HTTP ${r.status}`); return d as Data; })
      .then((d) => { if (!alive) return; setData(d); setPicked(d.linked ?? d.suggested?.findoc ?? null); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [docId]);

  const save = async (noLink: boolean) => {
    const c = data?.candidates.find((x) => x.findoc === picked) ?? null;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/credit-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noLink ? { findoc: null, noLink: true } : { findoc: picked, label: c?.label ?? null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? `HTTP ${r.status}`);
      toast.success(noLink ? 'Το πιστωτικό θα καταχωριστεί χωρίς αρχικό.' : `Συνδέθηκε με ${c?.label ?? `FINDOC ${picked}`}`);
      emitDocLinesChanged(docId);
      onClose();
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const needle = q.trim().toLowerCase();
  const list = (data?.candidates ?? []).filter((c) => !needle || c.label.toLowerCase().includes(needle));

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[88dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiLink className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Σύνδεση πιστωτικού με το αρχικό</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">Ποιο τιμολόγιο πιστώνει αυτό το πιστωτικό. Στη SoftOne γράφεται ως «Παραστατικό προέλευσης».</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-2.5">
          {!data && !error && <div className="space-y-2" role="status"><span className="sr-only">Φόρτωση…</span>{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}

          {data && (
            <>
              <p className="text-[length:var(--fs-12)] text-foreground">
                {data.printed
                  ? <>Στο χαρτί γράφει ότι αφορά: <strong className="font-mono">{data.printed}</strong>{data.printedMark ? <> · ΜΑΡΚ <span className="font-mono">{data.printedMark}</span></> : null}</>
                  : <>Στο χαρτί δεν διαβάστηκε αριθμός αρχικού παραστατικού — διάλεξε από τη λίστα.</>}
              </p>
              {data.suggested && (
                <p className="flex items-center gap-1.5 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-2.5 py-1.5 text-[length:var(--fs-12)]">
                  <FiZap aria-hidden className="size-3.5 shrink-0 text-sisyphus-600" /> Προτείνεται: <strong>{data.suggested.label}</strong> — ίδιος αριθμός με αυτόν που τυπώθηκε.
                </p>
              )}
              {data.softoneError && <RowHint tone="warn">Η SoftOne δεν απάντησε ({data.softoneError.slice(0, 80)}) — η λίστα έχει μόνο ό,τι καταχώρισε η εφαρμογή.</RowHint>}

              <div className="relative">
                <FiSearch aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Αναζήτηση αριθμού ή ημερομηνίας…" aria-label="Αναζήτηση αρχικού παραστατικού"
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-[length:var(--fs-13)] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>

              {list.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[length:var(--fs-12)] text-muted-foreground">
                  {data.candidates.length === 0 ? 'Δεν βρέθηκε κανένα παραστατικό του ίδιου εκδότη.' : 'Κανένα αποτέλεσμα για την αναζήτηση.'}
                </p>
              ) : (
                <ul role="radiogroup" aria-label="Αρχικό παραστατικό" className="max-h-[42dvh] space-y-1 overflow-auto pr-1">
                  {list.map((c) => {
                    const on = picked === c.findoc;
                    return (
                      <li key={c.findoc}>
                        <button type="button" role="radio" aria-checked={on} onClick={() => setPicked(c.findoc)} disabled={!canEdit}
                          className={cn('flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[length:var(--fs-12)] transition',
                            on ? 'border-sisyphus-500 bg-sisyphus-500/10' : 'border-border bg-card hover:bg-muted')}>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{c.label}</span>
                            <span className="text-[length:var(--fs-11)] text-muted-foreground">FINDOC {c.findoc} · {c.source === 'app' ? 'καταχωρίστηκε από την εφαρμογή' : 'στη SoftOne'}{data.suggested?.findoc === c.findoc ? ' · προτεινόμενο' : ''}</span>
                          </span>
                          {on && <FiCheckCircle aria-hidden className="size-4 shrink-0 text-sisyphus-600" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-12)] text-destructive">
              <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter className="m-0 flex-wrap gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button type="button" variant="ghost" className="mr-auto" onClick={() => void save(true)} disabled={!canEdit || busy || !data}
            title="Π.χ. έκπτωση τζίρου ή πιστωτικό που δεν αφορά συγκεκριμένο τιμολόγιο">
            <FiSlash aria-hidden className="mr-1.5 size-3.5" /> Χωρίς αρχικό
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Άκυρο</Button>
          <Button type="button" onClick={() => void save(false)} disabled={!canEdit || busy || picked == null}>
            {busy ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" /> : <FiLink aria-hidden className="mr-1.5 size-3.5" />}
            Σύνδεση
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
