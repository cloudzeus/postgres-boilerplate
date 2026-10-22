'use client';

// «Παρακράτηση φόρου»: τι διαβάστηκε (ποσό, ποσοστό, πληρωτέο), τι βρήκε ο έλεγχος, και η ρητή απόφαση
// «θα την καταχωρίσει ο λογιστής» — η SoftOne αυτής της εγκατάστασης δεν την περνά μόνη της.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiLoader, FiPercent } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';

interface Data { amount: number | null; rate: number | null; knownRate: number | null; issues: string[]; maybeMissing: boolean; net: number | null; total: number | null; payable: number | null; acknowledged: boolean; note: string | null }
const eur = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

export function WithholdingDialog({ docId, canEdit, onClose }: { docId: string; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch(`/api/admin/ocr/${docId}/withholding`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.message ?? `HTTP ${r.status}`); return j as Data; })
      .then((j) => { if (alive) setD(j); }).catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [docId]);

  const ack = async (value: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/withholding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ack: value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
      toast.success(value ? 'Η καταχώριση μπορεί να προχωρήσει — η παρακράτηση σημειώνεται για τον λογιστή.' : 'Η επιβεβαίωση αναιρέθηκε.');
      emitDocLinesChanged(docId); onClose(); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[88dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiPercent className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Παρακράτηση φόρου</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">Η παρακράτηση μειώνει το ποσό που πληρώνεται στον εκδότη· αποδίδεται στο Δημόσιο.</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-2.5">
          {!d && !error && <div className="h-24 animate-pulse rounded bg-muted motion-reduce:animate-none" role="status"><span className="sr-only">Φόρτωση…</span></div>}
          {d && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-[length:var(--fs-12)]">
                <dt className="text-muted-foreground">Καθαρή αξία</dt><dd className="text-right font-mono tabular-nums">{eur(d.net)}</dd>
                <dt className="text-muted-foreground">Σύνολο</dt><dd className="text-right font-mono tabular-nums">{eur(d.total)}</dd>
                <dt className="font-semibold">Παρακράτηση</dt><dd className="text-right font-mono font-semibold tabular-nums">{eur(d.amount)}{d.rate != null ? ` (${String(d.knownRate ?? d.rate).replace('.', ',')}%)` : ''}</dd>
                <dt className="text-muted-foreground">Πληρωτέο</dt><dd className="text-right font-mono tabular-nums">{eur(d.payable)}</dd>
              </dl>
              {d.issues.map((i) => (
                <p key={i} className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-950"><FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {i}</p>
              ))}
              {d.amount != null ? (
                <p className="flex items-start gap-2 rounded-md border border-sisyphus-200 bg-sisyphus-50 px-3 py-2 text-[length:var(--fs-12)] text-sisyphus-900">
                  <FiInfo aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>Η SoftOne αυτής της εγκατάστασης <strong>δεν περνά αυτόματα</strong> την παρακράτηση (ούτε η σειρά «Δαπάνες με παρακράτηση φόρου»). Αν συνεχίσεις, το παραστατικό καταχωρείται με το πλήρες σύνολο και το σχόλιο γράφει: <em>«{d.note}»</em> — ώστε ο λογιστής να περάσει την παρακράτηση.</span>
                </p>
              ) : (
                <p className="text-[length:var(--fs-12)] text-muted-foreground">Δεν διαβάστηκε παρακράτηση σε αυτό το παραστατικό.{d.maybeMissing ? ' Ως παροχή υπηρεσιών άνω των 300 €, έλεγξε στο χαρτί μήπως υπάρχει (συνήθως 20%).' : ''}</p>
              )}
              {d.acknowledged && <p className="flex items-center gap-1.5 text-[length:var(--fs-12)] font-semibold text-emerald-700"><FiCheckCircle aria-hidden className="size-4" /> Έχει επιβεβαιωθεί ότι θα την καταχωρίσει ο λογιστής.</p>}
            </>
          )}
          {error && <p role="alert" className="text-[length:var(--fs-12)] text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="m-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          {d?.acknowledged && <Button type="button" variant="ghost" className="mr-auto" disabled={!canEdit || busy} onClick={() => void ack(false)}>Αναίρεση</Button>}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Κλείσιμο</Button>
          {d?.amount != null && !d.acknowledged && (
            <Button type="button" onClick={() => void ack(true)} disabled={!canEdit || busy}>
              {busy ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCheckCircle aria-hidden className="mr-1.5 size-3.5" />}
              Θα την καταχωρίσει ο λογιστής — συνέχεια
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
