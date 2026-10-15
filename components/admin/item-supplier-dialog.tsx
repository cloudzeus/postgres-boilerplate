'use client';

// «Κωδικός & τιμή προμηθευτή» για ΥΠΑΡΧΟΝ είδος. Το ίδιο είδος το δίνουν πολλοί προμηθευτές, ο
// καθένας με τον δικό του κωδικό και τιμή· εδώ γράφεται αυτός του τρέχοντος τιμολογίου.
//
// Ροή: ανάγνωση της ΤΩΡΙΝΗΣ κατάστασης στη SoftOne (πίνακας όλων των προμηθευτών του είδους) →
// φόρμα προσυμπληρωμένη από τη γραμμή → «Προεπισκόπηση» (ακριβώς τι αλλάζει) → «Αποθήκευση».
import * as React from 'react';
import { FiAlertTriangle, FiCheckCircle, FiLoader, FiTag, FiTrendingDown } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ItemSupplierState } from '@/lib/item-supplier';

interface Loaded {
  item: { mtrl: number; code: string; name: string } | null;
  trdr: number; supplierName: string;
  suggestion: { code: string | null; name: string | null; price: number | null; baseUnit: string | null };
  state: ItemSupplierState;
  names: Record<number, string>;
}

const money = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 }));
const dateOf = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const numOrNull = (s: string) => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export function ItemSupplierDialog({ open, onOpenChange, lineId }: { open: boolean; onOpenChange: (o: boolean) => void; lineId: string }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [disc, setDisc] = React.useState('');
  const [preview, setPreview] = React.useState<{ changes: string[]; payload: unknown } | null>(null);
  const [busy, setBusy] = React.useState<'load' | 'preview' | 'save' | null>(null);
  const [postingEnabled, setPostingEnabled] = React.useState<boolean | null>(null);
  const [showJson, setShowJson] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy('load'); setLoadError(null); setPreview(null);
    try {
      const res = await fetch(`/api/admin/ocr/item-supplier?lineId=${encodeURIComponent(lineId)}`, { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setLoadError(d?.message ?? 'Δεν διαβάστηκε το είδος από τη SoftOne.'); return; }
      setData(d);
      setCode(d.suggestion.code ?? ''); setName(d.suggestion.name ?? '');
      setPrice(d.suggestion.price != null ? String(d.suggestion.price).replace('.', ',') : ''); setDisc('');
    } catch { setLoadError('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  }, [lineId]);

  React.useEffect(() => {
    if (!open) return;
    void load();
    fetch('/api/admin/ocr/posting-enabled', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d) => setPostingEnabled(d?.enabled === true)).catch(() => setPostingEnabled(null));
  }, [open, load]);

  const priceN = numOrNull(price);
  const discN = numOrNull(disc);
  const invalid = Number.isNaN(priceN) || Number.isNaN(discN) || (discN != null && (discN < 0 || discN > 100));
  const body = (dryRun: boolean) => JSON.stringify({ lineId, code: code.trim() || null, name: name.trim() || null, price: priceN, disc1: discN, dryRun });

  const doPreview = async () => {
    if (invalid) return;
    setBusy('preview');
    try {
      const res = await fetch('/api/admin/ocr/item-supplier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(true) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast.error(d?.message ?? 'Η προεπισκόπηση απέτυχε.'); return; }
      setPreview({ changes: d.changes ?? [], payload: d.payload });
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  };

  const save = async () => {
    if (invalid || !preview?.payload) return;
    setBusy('save');
    try {
      const res = await fetch('/api/admin/ocr/item-supplier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(false) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast.error(d?.message ?? 'Η αποθήκευση στη SoftOne απέτυχε.'); return; }
      toast.success(d.nothingToDo ? 'Ήταν ήδη έτσι στη SoftOne.' : 'Αποθηκεύτηκε στη SoftOne.', { description: (d.changes ?? []).join(' ') || undefined });
      setData((prev) => (prev ? { ...prev, state: d.state, names: { ...prev.names, ...d.names } } : prev));
      setPreview(null);
    } catch { toast.error('Σφάλμα δικτύου — έλεγξε την καρτέλα του είδους πριν ξαναπροσπαθήσεις.'); } finally { setBusy(null); }
  };

  // Όλοι οι προμηθευτές του είδους: ένωση κωδικών και τιμών, ο τρέχων πρώτος.
  const rows = React.useMemo(() => {
    if (!data) return [];
    const trdrs = [...new Set([data.trdr, ...data.state.prices.map((p) => p.trdr), ...data.state.codes.map((c) => c.trdr)])];
    return trdrs.map((t) => ({
      trdr: t,
      name: data.names[t] ?? (t === data.trdr ? data.supplierName : `TRDR ${t}`),
      codes: data.state.codes.filter((c) => c.trdr === t && c.active).map((c) => c.code),
      price: data.state.prices.find((p) => p.trdr === t) ?? null,
      current: t === data.trdr,
    })).filter((r) => r.current || r.codes.length || r.price);
  }, [data]);
  const best = rows.filter((r) => r.price?.price != null).sort((a, b) => a.price!.price! - b.price!.price!)[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[length:var(--fs-15)]">
            <FiTag aria-hidden className="size-4 text-sisyphus-600" /> Κωδικός & τιμή προμηθευτή
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            {data?.item ? <><span className="font-mono">{data.item.code}</span> — {data.item.name}</> : 'Είδος της γραμμής'}
            {data && <> · από <strong>{data.supplierName}</strong></>}
          </DialogDescription>
        </DialogHeader>

        {busy === 'load' && <div className="space-y-2" role="status"><span className="sr-only">Ανάγνωση από τη SoftOne…</span>{[0, 1, 2].map((i) => <div key={i} className="h-7 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}
        {loadError && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
            <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {loadError}
            <button type="button" onClick={() => void load()} className="ml-auto cursor-pointer font-semibold underline">Ξανά</button>
          </p>
        )}

        {data && (
          <div className="space-y-4">
            <section aria-labelledby="sup-list" className="space-y-1.5">
              <p id="sup-list" className="text-[length:var(--fs-10)] font-semibold uppercase tracking-wider text-muted-foreground">Προμηθευτές του είδους στη SoftOne</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[length:var(--fs-12)]">
                  <thead className="bg-muted/50 text-[length:var(--fs-11)] text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Προμηθευτής</th>
                      <th className="px-2 py-1.5 text-left font-medium">Κωδικός του</th>
                      <th className="px-2 py-1.5 text-right font-medium">Τιμή συμφωνίας</th>
                      <th className="px-2 py-1.5 text-right font-medium">Τελευταία αγορά</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.trdr} className={r.current ? 'bg-sisyphus-50/60 dark:bg-sisyphus-500/10' : undefined}>
                        <td className="px-2 py-1.5">
                          <span className={r.current ? 'font-semibold' : undefined}>{r.name}</span>
                          {r.current && <span className="ml-1 text-[length:var(--fs-10)] text-sisyphus-700 dark:text-sisyphus-300">· αυτό το τιμολόγιο</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[length:var(--fs-11)]">{r.codes.join(', ') || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {money(r.price?.price)}
                          {best && best.trdr === r.trdr && rows.filter((x) => x.price?.price != null).length > 1 && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-[length:var(--fs-10)] font-semibold text-emerald-700 dark:text-emerald-300" title="Η χαμηλότερη τιμή συμφωνίας">
                              <FiTrendingDown aria-hidden className="size-3" /> φθηνότερος
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {r.price?.lastPrice != null ? <>{money(r.price.lastPrice)} · {dateOf(r.price.lastBuyDate)}</> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[length:var(--fs-11)] text-muted-foreground">
                Την «Τελευταία αγορά» τη γράφει μόνη της η SoftOne από τα παραστατικά. Η «Τιμή συμφωνίας» είναι αυτή που ορίζεις εδώ.
              </p>
            </section>

            <section aria-labelledby="sup-form" className="space-y-3">
              <p id="sup-form" className="text-[length:var(--fs-10)] font-semibold uppercase tracking-wider text-muted-foreground">Για {data.supplierName}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Κωδικός είδους στον προμηθευτή</span>
                  <Input value={code} onChange={(e) => { setCode(e.target.value); setPreview(null); }} className="h-9 font-mono text-[length:var(--fs-13)]" placeholder="όπως τυπώνεται στο τιμολόγιό του" />
                  <span className="text-[length:var(--fs-11)] text-muted-foreground">Το επόμενο τιμολόγιό του βρίσκει μόνο του το είδος από αυτόν τον κωδικό.</span>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Περιγραφή στον προμηθευτή</span>
                  <Input value={name} onChange={(e) => { setName(e.target.value); setPreview(null); }} className="h-9 text-[length:var(--fs-13)]" />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">
                    Τιμή συμφωνίας{data.suggestion.baseUnit ? ` ανά ${data.suggestion.baseUnit.toLowerCase()}` : ''} (καθαρή, €)
                  </span>
                  <Input value={price} onChange={(e) => { setPrice(e.target.value); setPreview(null); }} inputMode="decimal" aria-invalid={Number.isNaN(priceN) || undefined} className="h-9 text-right tabular-nums text-[length:var(--fs-13)]" placeholder="κενό = χωρίς αλλαγή τιμής" />
                  <span className="text-[length:var(--fs-11)] text-muted-foreground">Προτείνεται από τη γραμμή: αξία ÷ ποσότητα, μετά την έκπτωση, στη βασική μονάδα.</span>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">Έκπτωση συμφωνίας % (προαιρετικά)</span>
                  <Input value={disc} onChange={(e) => { setDisc(e.target.value); setPreview(null); }} inputMode="decimal" aria-invalid={(discN != null && (Number.isNaN(discN) || discN < 0 || discN > 100)) || undefined} className="h-9 text-right tabular-nums text-[length:var(--fs-13)]" />
                </label>
              </div>
            </section>

            {preview && (
              <section className="rounded-lg border border-sisyphus-500/25 bg-sisyphus-50/50 px-3 py-2 text-[length:var(--fs-12)] dark:bg-sisyphus-500/10" role="status" aria-live="polite">
                {preview.changes.length ? (
                  <ul className="space-y-0.5">{preview.changes.map((c) => <li key={c} className="flex items-start gap-1.5"><FiCheckCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-sisyphus-600" />{c}</li>)}</ul>
                ) : <p>Η SoftOne έχει ήδη αυτόν τον κωδικό και αυτή την τιμή — τίποτα να αλλάξει.</p>}
                {preview.payload != null && (
                  <button type="button" onClick={() => setShowJson((v) => !v)} className="mt-1 cursor-pointer text-[length:var(--fs-11)] text-muted-foreground underline">
                    {showJson ? 'Απόκρυψη object' : 'Δες το object που θα σταλεί'}
                  </button>
                )}
                {showJson && preview.payload != null && (
                  <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-[#0E1626] p-2 font-mono text-[length:var(--fs-11)] text-[#d6e2f5]">{JSON.stringify(preview.payload, null, 2)}</pre>
                )}
              </section>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {postingEnabled === false && (
            <span className="mr-auto self-center text-[length:var(--fs-11)] text-muted-foreground">Οι εγγραφές στη SoftOne είναι κλειστές — μόνο προεπισκόπηση.</span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Κλείσιμο</Button>
          <Button variant="outline" onClick={() => void doPreview()} disabled={!data || invalid || busy != null}>
            {busy === 'preview' && <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" />} Προεπισκόπηση
          </Button>
          <Button onClick={() => void save()} disabled={!preview?.payload || busy != null || postingEnabled === false}>
            {busy === 'save' && <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" />} Αποθήκευση στη SoftOne
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
