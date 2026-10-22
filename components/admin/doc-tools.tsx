'use client';

// Τα εργαλεία ενός σκαναρισμένου παραστατικού: μενού «Ενέργειες» στην κορυφή της σελίδας και ο ΕΝΑΣ
// host των παραθύρων (επεξεργασία γραμμών, επανασάρωση, ιστορικό). Τα παράθυρα ανοίγουν και από
// οπουδήποτε αλλού στη σελίδα με `emitDocTool` — π.χ. το «Λείπει γραμμή 43,00 €» ανοίγει τον
// επεξεργαστή με τη γραμμή έτοιμη. Κανένα πρόβλημα δεν μένει χωρίς δρόμο.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiAlertTriangle, FiArrowRight, FiCheckCircle, FiChevronDown, FiClock, FiDollarSign, FiFileText, FiList, FiLoader, FiRefreshCw, FiTool, FiXCircle,
} from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormSection, FormSelect, RowHint } from '@/components/admin/form-kit';
import { LinesEditorDialog, type LinesEditorPrefill } from '@/components/admin/lines-editor-dialog';
import { PostedAmountsDialog } from '@/components/admin/posted-amounts-dialog';
import { emitDocLinesChanged, emitDocTool, useDocTool, type DocToolRequest } from '@/components/admin/doc-lines-events';
import { elapsedSuffix, useElapsedSeconds } from '@/lib/use-elapsed';
import { AUTO_DOC_TYPE_HINT, UPLOAD_DOC_TYPES, UPLOAD_DOC_TYPE_LABELS, type ExtractDocType } from '@/lib/ocr/templates';
import { cn } from '@/lib/utils';

export interface DocToolsProps {
  docId: string;
  /** Μπορεί να διορθώνει την ανάγνωση (ocr.categorize). */
  canManage: boolean;
  /** Μπορεί να ξαναδιαβάσει το αρχείο (ocr.create). */
  canRescan: boolean;
  posted: boolean;
  /** Μπορεί να καταχωρίζει (ocr.post) — χρειάζεται για τη διόρθωση ποσών στη SoftOne. */
  canPost?: boolean;
}

const POSTED_REASON = 'Καταχωρήθηκε στη SoftOne — δεν αλλάζει πια από εδώ';

/** Το κουμπί «Ενέργειες» της κορυφής: τα εργαλεία διόρθωσης, χωρισμένα από τη «Διαγραφή». */
export function DocActionsMenu({ docId, canManage, canRescan, posted }: DocToolsProps) {
  const open = (req: DocToolRequest) => { if (!emitDocTool(docId, req)) toast.error('Το εργαλείο δεν είναι διαθέσιμο σε αυτή τη σελίδα.'); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FiTool aria-hidden className="size-3.5" /> Ενέργειες <FiChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">Διόρθωση ανάγνωσης</DropdownMenuLabel>
        <MenuItem icon={<FiList />} title="Επεξεργασία γραμμών" hint={posted ? POSTED_REASON : 'Πρόσθεσε, άλλαξε ή αφαίρεσε γραμμές, με το πρωτότυπο δίπλα'}
          disabled={!canManage || posted} onSelect={() => open({ tool: 'lines' })} />
        <MenuItem icon={<FiRefreshCw />} title="Επανασάρωση" hint={posted ? POSTED_REASON : 'Νέα ανάγνωση από την αρχή, με την τρέχουσα έκδοση της εφαρμογής'}
          disabled={!canRescan || posted} onSelect={() => open({ tool: 'rescan' })} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">Πληροφορίες</DropdownMenuLabel>
        <MenuItem icon={<FiClock />} title="Ιστορικό αλλαγών" hint="Ποιος άλλαξε τι, και πότε" onSelect={() => open({ tool: 'history' })} />
        {posted && (
          <MenuItem icon={<FiDollarSign />} title="Ποσά στη SoftOne" hint="Σύγκριση με το χαρτί και διόρθωση, αν η SoftOne κράτησε άλλο ποσό" onSelect={() => open({ tool: 'posted-amounts' })} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItem({ icon, title, hint, disabled, onSelect }: { icon: React.ReactNode; title: string; hint: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="items-start gap-2.5 py-2">
      <span aria-hidden className="mt-0.5 text-muted-foreground [&>svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[length:var(--fs-13)] font-medium">{title}</span>
        <span className="block text-[length:var(--fs-11)] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
}

/** Τα παράθυρα. Μία φορά ανά σελίδα παραστατικού. */
export function DocToolsHost({ docId, canManage, canRescan, posted, canPost, lineMatches }: DocToolsProps & { lineMatches?: Record<number, string | null> }) {
  const [lines, setLines] = React.useState<LinesEditorPrefill | null>(null);
  const [amounts, setAmounts] = React.useState(false);
  const [rescan, setRescan] = React.useState(false);
  const [history, setHistory] = React.useState(false);

  useDocTool(docId, (req) => {
    if (req.tool === 'lines') {
      if (posted || !canManage) { toast.error(posted ? `${POSTED_REASON}.` : 'Δεν έχεις δικαίωμα διόρθωσης γραμμών.'); return; }
      setLines({ add: req.add, removeRow: req.removeRow });
    } else if (req.tool === 'rescan') {
      if (posted || !canRescan) { toast.error(posted ? `${POSTED_REASON}.` : 'Δεν έχεις δικαίωμα επανασάρωσης.'); return; }
      setRescan(true);
    } else if (req.tool === 'history') setHistory(true);
    else if (req.tool === 'posted-amounts') setAmounts(true);
  });

  return (
    <>
      {lines && <LinesEditorDialog docId={docId} open prefill={lines} lineMatches={lineMatches} onOpenChange={(o) => { if (!o) setLines(null); }} />}
      {rescan && <RescanDialog docId={docId} onClose={() => setRescan(false)} />}
      {history && <HistoryDialog docId={docId} onClose={() => setHistory(false)} />}
      {amounts && <PostedAmountsDialog docId={docId} canFix={!!canPost} onClose={() => setAmounts(false)} />}
    </>
  );
}

// ─── Επανασάρωση ─────────────────────────────────────────────────────────────

interface ReadSummary { lines: number; sumLines: number; net: number | null; vat: number | null; total: number | null; issuer: string | null; afm: string | null; number: string | null; date: string | null; closes: boolean }

const eur = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

function RescanDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const router = useRouter();
  const [docType, setDocType] = React.useState<ExtractDocType>('auto');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ before: ReadSummary | null; after: ReadSummary | null; model: string } | null>(null);
  const secs = useElapsedSeconds(busy);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/reextract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docType }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message ?? d.error ?? `HTTP ${r.status}`);
      setResult({ before: d.before ?? null, after: d.after ?? null, model: d.model });
      emitDocLinesChanged(docId);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const finish = () => { onClose(); router.refresh(); };

  const rows: Array<[string, (s: ReadSummary) => string]> = [
    ['Εκδότης', (s) => `${s.issuer ?? '—'}${s.afm ? ` · ${s.afm}` : ''}`],
    ['Αριθμός / ημερομηνία', (s) => `${s.number ?? '—'} · ${s.date ?? '—'}`],
    ['Γραμμές', (s) => String(s.lines)],
    ['Άθροισμα γραμμών', (s) => eur(s.sumLines)],
    ['Καθαρή αξία', (s) => eur(s.net)],
    ['ΦΠΑ', (s) => eur(s.vat)],
    ['Σύνολο', (s) => eur(s.total)],
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) (result ? finish() : onClose()); }}>
      <DialogContent className="flex max-h-[92dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiRefreshCw className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Επανασάρωση παραστατικού</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">Νέα ανάγνωση του αρχείου από την αρχή, με την τρέχουσα έκδοση της εφαρμογής και το ισχυρότερο μοντέλο ανάγνωσης.</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {!result && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormSection tone="emerald" icon={<FiCheckCircle />} title="Κρατιούνται">
                  <ul className="list-disc space-y-0.5 pl-4 text-[length:var(--fs-12)]">
                    <li>Η σειρά παραστατικού που διάλεξες</li>
                    <li>Ο προμηθευτής, αν ο ΑΦΜ δεν αλλάξει</li>
                    <li>Η κατηγορία</li>
                    <li>Τι αφορά κάθε γραμμή στη SoftOne και κέντρο κόστους / έργο — για γραμμές με ίδιο κωδικό ή περιγραφή</li>
                  </ul>
                </FormSection>
                <FormSection tone="amber" icon={<FiAlertTriangle />} title="Αντικαθίστανται">
                  <ul className="list-disc space-y-0.5 pl-4 text-[length:var(--fs-12)]">
                    <li>Ό,τι διόρθωσες με το χέρι σε πεδία και γραμμές</li>
                    <li>Το μοίρασμα γραμμών σε πολλές κατηγορίες</li>
                    <li>Η επιβεβαίωση ανάγνωσης — θα χρειαστεί νέος έλεγχος</li>
                  </ul>
                </FormSection>
              </div>
              <FormSection tone="blue" icon={<FiFileText />} title="Είδος εγγράφου">
                <Field label="Τύπος εγγράφου" htmlFor="rescan-doctype">
                  <FormSelect id="rescan-doctype" value={docType} onChange={(v) => setDocType(v as ExtractDocType)} disabled={busy}
                    opts={UPLOAD_DOC_TYPES.map((key) => ({ id: key, name: UPLOAD_DOC_TYPE_LABELS[key] }))} />
                </Field>
                {docType === 'auto' && <RowHint>{AUTO_DOC_TYPE_HINT}</RowHint>}
              </FormSection>
              {busy && (
                <p role="status" className="flex items-center gap-2 rounded-md border border-sisyphus-200 bg-sisyphus-50 px-3 py-2 text-[length:var(--fs-12)] text-sisyphus-900 dark:border-sisyphus-800 dark:bg-sisyphus-950/40 dark:text-sisyphus-100">
                  <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                  Διαβάζω το αρχείο ξανά…{elapsedSuffix(secs)} <span className="text-muted-foreground">συνήθως 20–90″</span>
                </p>
              )}
            </>
          )}

          {result && (
            <FormSection tone={result.after?.closes ? 'emerald' : 'amber'} icon={result.after?.closes ? <FiCheckCircle /> : <FiAlertTriangle />}
              title={result.after?.closes ? 'Η νέα ανάγνωση κλείνει — γραμμές και σύνολα συμφωνούν' : 'Η νέα ανάγνωση ΔΕΝ κλείνει ακόμη'}>
              <table className="w-full text-[length:var(--fs-12)]">
                <caption className="sr-only">Σύγκριση παλιάς και νέας ανάγνωσης</caption>
                <thead className="text-left text-[length:var(--fs-11)] uppercase tracking-wide text-muted-foreground">
                  <tr><th scope="col" className="py-1 pr-2 font-semibold"> </th><th scope="col" className="py-1 pr-2 font-semibold">Πριν</th><th scope="col" className="w-5" /><th scope="col" className="py-1 font-semibold">Τώρα</th></tr>
                </thead>
                <tbody>
                  {rows.map(([label, f]) => {
                    const a = result.before ? f(result.before) : '—';
                    const b = result.after ? f(result.after) : '—';
                    return (
                      <tr key={label} className="border-t border-border/60">
                        <th scope="row" className="py-1 pr-2 text-left font-medium text-muted-foreground">{label}</th>
                        <td className="py-1 pr-2 font-mono tabular-nums">{a}</td>
                        <td aria-hidden className="text-muted-foreground"><FiArrowRight className="size-3" /></td>
                        <td className={cn('py-1 font-mono tabular-nums', a !== b && 'font-semibold text-sisyphus-700 dark:text-sisyphus-300')}>{b}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border/60">
                    <th scope="row" className="py-1 pr-2 text-left font-medium text-muted-foreground">Κλείνουν τα ποσά</th>
                    <td className="py-1 pr-2">{result.before ? (result.before.closes ? 'Ναι' : 'Όχι') : '—'}</td>
                    <td aria-hidden />
                    <td className="py-1 font-semibold">{result.after?.closes ? 'Ναι' : 'Όχι'}</td>
                  </tr>
                </tbody>
              </table>
              {!result.after?.closes && <RowHint tone="warn">Συνέχισε με «Επεξεργασία γραμμών»: το πρωτότυπο είναι δίπλα, και η μπάρα σού λέει πόσο λείπει.</RowHint>}
            </FormSection>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-12)] text-destructive">
              <FiXCircle aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter className="m-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          {result ? (
            <>
              {!result.after?.closes && (
                <Button type="button" variant="outline" onClick={() => { finish(); setTimeout(() => emitDocTool(docId, { tool: 'lines' }), 400); }}>
                  <FiList aria-hidden className="mr-1.5 size-3.5" /> Επεξεργασία γραμμών
                </Button>
              )}
              <Button type="button" onClick={finish}>Κλείσιμο</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Άκυρο</Button>
              <Button type="button" onClick={() => void run()} disabled={busy}>
                <FiRefreshCw aria-hidden className={cn('mr-1.5 size-3.5', busy && 'animate-spin motion-reduce:animate-none')} />
                {busy ? 'Επανασάρωση…' : 'Επανασάρωση'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ιστορικό ────────────────────────────────────────────────────────────────

interface HistoryEntry { id: string; action: string; at: string; user: string | null; line: number | null; summary: string | null; source: string | null; ok: boolean | null; error: string | null }

const ACTION_TEXT: Record<string, string> = {
  'ocr.lines.edit': 'Διόρθωση γραμμών',
  'ocr.amounts.fix': 'Διόρθωση ποσών',
  'ocr.reextract': 'Επανασάρωση',
  'ocr.document.edit': 'Διόρθωση πεδίων',
  'ocr.line.match': 'Ορίστηκε τι αφορά η γραμμή',
  'ocr.line.unmatch': 'Αφαιρέθηκε η αντιστοίχιση γραμμής',
  'ocr.line.analytics': 'Κέντρο κόστους / έργο γραμμής',
  'ocr.line.allocations.set': 'Μοίρασμα γραμμής σε κατηγορίες',
  'ocr.line.allocations.clear': 'Καταργήθηκε το μοίρασμα γραμμής',
  'ocr.line.qty_unit': 'Μονάδα μέτρησης γραμμής',
  'ocr.line.asset': 'Η γραμμή ορίστηκε ως πάγιο',
  'ocr.line.skip': 'Η γραμμή παραλείπεται',
  'ocr.items.rescan': 'Νέα αναζήτηση ειδών στη SoftOne',
  'ocr.afm.recover': 'Ανάκτηση ΑΦΜ εκδότη',
  'ocr.post.mark': 'Ενημέρωση ΜΑΡΚ στη SoftOne',
  'ocr.delivery_note_convert': 'Μετασχηματισμός από δελτίο αποστολής',
  'ocr.document.split_regions': 'Διαχωρισμός παραστατικών',
  'ocr.post': 'Καταχώριση στη SoftOne',
  'ocr.post.amounts_fix': 'Διόρθωση ποσών στη SoftOne',
};

function HistoryDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [entries, setEntries] = React.useState<HistoryEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/ocr/${docId}/history`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.message ?? `HTTP ${r.status}`); return d; })
      .then((d) => { if (alive) setEntries(d.entries ?? []); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [docId]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[85dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiClock className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Ιστορικό αλλαγών</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">Ό,τι άλλαξε σε αυτό το παραστατικό και στις γραμμές του, νεότερα πρώτα.</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          {!entries && !error && <div className="space-y-2" role="status"><span className="sr-only">Φόρτωση…</span>{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}
          {error && <p role="alert" className="text-[length:var(--fs-12)] text-destructive">Το ιστορικό δεν φορτώθηκε: {error}</p>}
          {entries && entries.length === 0 && <p className="text-[length:var(--fs-12)] text-muted-foreground">Καμία καταγεγραμμένη αλλαγή ακόμη. Οι διορθώσεις από εδώ και πέρα θα φαίνονται εδώ.</p>}
          {entries && entries.length > 0 && (
            <ol className="space-y-1.5">
              {entries.map((e) => (
                <li key={e.id} className="rounded-md border border-border bg-card px-3 py-2 text-[length:var(--fs-12)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">
                      {ACTION_TEXT[e.action] ?? e.action}{e.line ? ` · γραμμή ${e.line}` : ''}
                      {e.ok === false && <span className="ml-1 font-normal text-destructive">(απέτυχε)</span>}
                    </span>
                    <time dateTime={e.at} className="font-mono text-[length:var(--fs-11)] tabular-nums text-muted-foreground">{new Date(e.at).toLocaleString('el-GR')}</time>
                  </div>
                  <p className="text-muted-foreground">{[e.summary, e.source === 'recheck' ? 'από επανέλεγχο στο χαρτί' : e.source === 'plan' ? 'από προτεινόμενη εξήγηση' : null, e.error].filter(Boolean).join(' · ') || ' '}{e.user ? <span> — {e.user}</span> : null}</p>
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
        <DialogFooter className="m-0 border-t border-border bg-card px-4 py-2.5"><Button type="button" onClick={onClose}>Κλείσιμο</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
