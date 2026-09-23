'use client';

import * as React from 'react';
import {
  FiAlertTriangle, FiCheck, FiCode, FiCopy, FiDollarSign, FiEdit3, FiPackage, FiTag, FiTool,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RegistrySearch } from '@/components/admin/registry-search';
import { matchUnit, unitOptions } from '@/lib/ocr/unit-match';
import { LINE_KIND_LABEL } from '@/lib/ocr/resolution-plan';
import type { MatchKind } from '@/lib/ocr/line-match';

type Opt = { id: string; name: string };
/** Η κατηγορία ΦΠΑ κουβαλά και το **δηλωμένο** ποσοστό της — `null` όταν το SoftOne δεν το δίνει. */
type VatOpt = Opt & { rate: number | null };
type Meta = {
  vats: VatOpt[]; units: Opt[]; groups: Opt[]; categories: Opt[];
  lineCategories: Opt[]; manufacturers: Opt[]; brands: Opt[];
};

const EMPTY_META: Meta = {
  vats: [], units: [], groups: [], categories: [], lineCategories: [], manufacturers: [], brands: [],
};

const KIND_ICON: Record<MatchKind, React.ReactNode> = {
  product: <FiPackage className="h-4 w-4" />,
  service: <FiTool className="h-4 w-4" />,
  expense: <FiDollarSign className="h-4 w-4" />,
  lineitem: <FiTag className="h-4 w-4" />,
};

/** Τι ακριβώς γράφεται πού — ο χρήστης πρέπει να το ξέρει ΠΡΙΝ πατήσει. */
const KIND_WHERE: Record<MatchKind, string> = {
  product: 'Νέα καρτέλα είδους στο SoftOne (object ITEM → MTRL, SODTYPE 51).',
  service: 'Νέα καρτέλα υπηρεσίας στο SoftOne (object ITEM → MTRL, SODTYPE 52).',
  expense: 'Νέο έξοδο στο SoftOne (object EXPENSES → EXPN).',
  lineitem: 'Νέα χρεοπίστωση στο SoftOne (object LINEITEM → MTRL, SODTYPE 53) — αυτό δέχεται η γραμμή LINLINES.',
};

/**
 * Ταιριάζει κατηγορία ΦΠΑ με τον συντελεστή της γραμμής.
 *
 * ΠΡΩΤΑ το **δηλωμένο** `rate` του μητρώου· μόνο αν λείπει, το ποσοστό μέσα στην περιγραφή
 * («ΦΠΑ 13 % Νέος Συντελεστής»). Η σειρά έχει σημασία: οι μηδενικές κατηγορίες του πελάτη δεν
 * δηλώνουν ποσοστό και το γράφουν μόνο στο όνομά τους — δες `lib/ocr/vat-map.ts`.
 */
const vatMatches = (v: VatOpt, rate: number): boolean => {
  if (v.rate != null) return Number(v.rate) === rate;
  const m = String(v.name).match(/([\d.,]+)\s*%/);
  return m ? parseFloat(m[1].replace(',', '.')) === rate : false;
};

/**
 * **Ο ΕΝΑΣ** inline δημιουργός εγγραφής μητρώου, για μία γραμμή παραστατικού.
 *
 * Παλιά (`create-softone-item-modal`) έφτιαχνε **πάντα** είδος ή υπηρεσία. Σε παραστατικό που
 * καταχωρείται σε `LINLINES` αυτό δεν ήταν απλώς λάθος επιλογή — ήταν αδιέξοδο: ό,τι κι αν
 * δημιουργούσε ο χρήστης, η γραμμή έμενε ακαταχώρητη. Τώρα το μητρώο το ορίζει ο **προορισμός**
 * της σειράς (`lib/ocr/resolution-plan.ts`) και ο δημιουργός ξέρει και τα τέσσερα.
 *
 * Δύο πράγματα που **δεν** κάνει ποτέ:
 *  • Δεν διαλέγει μονάδα μέτρησης μόνος του. Η παλιά φόρμα έβαζε σιωπηλά ΤΕΜΑΧΙΑ για τα πάντα —
 *    και η μονάδα μένει στην καρτέλα για πάντα. Ό,τι δεν αναγνωρίζεται (π.χ. `KWh`) το λέει.
 *  • Δεν εφευρίσκει «Τύπο» ή λογαριασμό γενικής για χρεοπίστωση: αντιγράφονται από υπάρχουσα
 *    χρεοπίστωση που διαλέγει ο χρήστης, και φαίνονται πριν σταλούν.
 */
export function CreateRegistryEntryModal({
  open, onOpenChange, kind, lineId, initialCode, initialName, initialVatRate, initialUnit, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Το μητρώο στο οποίο θα γραφτεί — το ορίζει ο προορισμός της σειράς. */
  kind: MatchKind;
  lineId?: string | null;
  initialCode?: string | null;
  initialName?: string | null;
  initialVatRate?: string | number | null;
  /** Η **τυπωμένη** μονάδα της γραμμής («KWh», «ΤΕΜ»). */
  initialUnit?: string | null;
  onCreated?: (m: { kind: MatchKind; mtrl: number | null; expn: number | null; lin: number | null; code: string; name: string }) => void;
}) {
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [tab, setTab] = React.useState<'form' | 'object'>('form');
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  const [unitNote, setUnitNote] = React.useState<string | null>(null);
  const [vatNote, setVatNote] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState<{ id: number; code: string; name: string } | null>(null);
  const [copied, setCopied] = React.useState<Record<string, unknown> | null>(null);
  const proposed = React.useRef<string | null>(null);
  const [f, setF] = React.useState({ code: '', name: '', vat: '', unit: '', price: '', group: '', category: '' });

  const isItem = kind === 'product' || kind === 'service';
  // Η μονάδα ζει στο `MTRL`, άρα αφορά ΚΑΙ τη χρεοπίστωση· το έξοδο (`EXPN`) δεν έχει μονάδα.
  const hasUnit = kind !== 'expense';
  const needsTemplate = kind === 'lineitem';

  React.useEffect(() => {
    if (!open) return;
    setTab('form'); setDryPayload(null); setDryRun(true);
    setCodeError(null); setCodeOffer(null); setTemplate(null); setCopied(null);
    setF({ code: initialCode ?? '', name: initialName ?? '', vat: '', unit: '', price: '', group: '', category: '' });
    proposed.current = null;

    fetch('/api/admin/softone/item-meta')
      .then((r) => r.json())
      .then((m: Meta) => {
        setMeta(m);
        // ── ΦΠΑ: από τον συντελεστή της γραμμής. Χωρίς αντιστοιχία, ΔΕΝ βάζουμε 24 % «επειδή
        //    συνήθως»: το λέμε και ο χρήστης διαλέγει.
        const rate = initialVatRate != null && initialVatRate !== ''
          ? parseFloat(String(initialVatRate).replace(',', '.')) : NaN;
        const vatHit = Number.isFinite(rate) ? m.vats.find((v) => vatMatches(v, rate)) : undefined;
        setVatNote(
          !Number.isFinite(rate)
            ? 'Η γραμμή δεν έχει τυπωμένο συντελεστή ΦΠΑ — διάλεξε κατηγορία.'
            : vatHit ? null
              : m.vats.length === 0
                ? 'Το μητρώο ΦΠΑ δεν έχει συγχρονιστεί — συγχρόνισέ το πρώτα (Ρυθμίσεις → SoftOne).'
                : `Καμία κατηγορία ΦΠΑ του μητρώου δεν δηλώνει ${rate} % — διάλεξε ποια ισχύει.`,
        );
        // ── Μονάδα: μόνο αναμφισβήτητο ταίριασμα. Ποτέ σιωπηλό ΤΕΜ.
        const units = m.units.map((u) => ({ code: u.id, name: u.name }));
        const unitHit = matchUnit(initialUnit ?? '', units);
        setUnitNote(
          !initialUnit
            ? 'Η γραμμή δεν έχει τυπωμένη μονάδα.'
            : unitHit ? null
              : `Η μονάδα «${initialUnit}» δεν υπάρχει στο μητρώο μονάδων του SoftOne — διάλεξε την αντίστοιχη ή πρόσθεσέ τη στο SoftOne πρώτα. Δεν βάζουμε ΤΕΜΑΧΙΑ στην τύχη: η μονάδα μένει στην καρτέλα για πάντα.`,
        );
        setF((s) => ({ ...s, vat: vatHit?.id ?? '', unit: unitHit?.code ?? '' }));
      })
      .catch(() => setMeta(EMPTY_META));
  }, [open, kind, initialCode, initialName, initialVatRate, initialUnit]);

  // Προτεινόμενος κωδικός ΤΟΥ μητρώου που πραγματικά θα γραφτεί.
  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    const sc = initialCode ? `&supplierCode=${encodeURIComponent(initialCode)}` : '';
    fetch(`/api/admin/ocr/new-items/next-code?kind=${kind}${sc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => {
        if (ignore || !d?.code) return;
        setF((s) => (s.code === '' || s.code === proposed.current ? { ...s, code: d.code as string } : s));
        proposed.current = d.code;
      })
      .catch(() => null);
    return () => { ignore = true; };
  }, [open, kind, initialCode]);

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  /** Για χρεοπίστωση: διάβασε ζωντανά τι θα αντιγραφεί, ώστε να φαίνεται πριν σταλεί. */
  const pickTemplate = async (p: { id: number; code: string; name: string }) => {
    setTemplate(p);
    setCopied(null);
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, code: f.code || '—', name: f.name || '—', templateMtrl: p.id, dryRun: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message ?? 'Αποτυχία ανάγνωσης προτύπου'); return; }
      setCopied((d.template?.flags ?? null) as Record<string, unknown> | null);
      if (!f.vat && d.template?.flags?.VAT) set('vat', String(d.template.flags.VAT));
      if (!f.category && d.template?.flags?.MTRCATEGORY) set('category', String(d.template.flags.MTRCATEGORY));
    } catch {
      toast.error('Σφάλμα δικτύου');
    }
  };

  const body = () => ({
    kind,
    code: f.code.trim(),
    name: f.name.trim(),
    vat: f.vat || null,
    unit: hasUnit ? (f.unit || null) : null,
    price: isItem && f.price ? Number(f.price) : null,
    group: isItem ? (f.group || null) : null,
    category: f.category || null,
    templateMtrl: needsTemplate ? (template?.id ?? null) : null,
    lineId: lineId ?? null,
    supplierCode: initialCode || null,
    dryRun,
  });

  const submit = async () => {
    if (!f.name.trim() || !f.code.trim()) { toast.error('Συμπλήρωσε Περιγραφή και Κωδικό.'); return; }
    if (isItem && (!f.vat || !f.unit)) { toast.error('Για είδος/υπηρεσία χρειάζονται ΦΠΑ και μονάδα.'); return; }
    if (needsTemplate && !template) { toast.error('Διάλεξε υπάρχουσα χρεοπίστωση ως πρότυπο.'); return; }
    setSubmitting(true);
    setCodeError(null); setCodeOffer(null);
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d?.field === 'code') { setCodeError(d.message ?? 'Ο κωδικός δεν έγινε δεκτός.'); setCodeOffer(d.suggestion ?? null); }
        toast.error(d?.message ?? 'Αποτυχία δημιουργίας στο SoftOne');
        return;
      }
      if (d?.dryRun) {
        setDryPayload(d.payload); setTab('object');
        toast.success('Ετοιμάστηκε το object — δεν στάλθηκε τίποτα στο SoftOne.');
        return;
      }
      toast.success(`Δημιουργήθηκε: ${d.name} (${d.code})`, {
        description: d.remembered ? 'Θα συμπληρωθεί μόνη της στην ίδια περιγραφή του ίδιου εκδότη.' : undefined,
      });
      onCreated?.({ kind, mtrl: d.mtrl ?? null, expn: d.expn ?? null, lin: d.lin ?? null, code: d.code, name: d.name });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setSubmitting(false);
    }
  };

  const Combo = ({ label, k, opts, ph = 'Επιλογή…' }: { label: string; k: keyof typeof f; opts: Opt[]; ph?: string }) => (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={(f[k] as string) || ''} onValueChange={(v) => set(k, v)}>
        <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder={ph} /></SelectTrigger>
        <SelectContent className="max-h-72">
          {opts.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">— κενό —</div>}
          {opts.map((o) => <SelectItem key={o.id} value={o.id} className="text-[13px]">{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );

  const orderedUnits = meta
    ? unitOptions(initialUnit ?? '', meta.units.map((u) => ({ code: u.id, name: u.name }))).map((u) => ({ id: u.code, name: u.name }))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[15px]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600">{KIND_ICON[kind]}</span>
            Νέα εγγραφή: {LINE_KIND_LABEL[kind]}
          </DialogTitle>
          <DialogDescription className="text-[12px]">{KIND_WHERE[kind]}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border bg-muted/30 px-5 py-2">
          {([['form', 'Στοιχεία', <FiEdit3 key="a" className="h-3.5 w-3.5" />], ['object', 'Αντικείμενο', <FiCode key="b" className="h-3.5 w-3.5" />]] as const).map(([v, lbl, ic]) => (
            <button key={v} onClick={() => setTab(v)} type="button"
              className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                tab === v ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              {ic} {lbl}
            </button>
          ))}
        </div>

        {!meta ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">Φόρτωση πινάκων…</div>
        ) : tab === 'form' ? (
          <div className="max-h-[60vh] space-y-5 overflow-auto px-5 py-4">
            {/* Πρότυπο — ΥΠΟΧΡΕΩΤΙΚΟ για χρεοπίστωση, προαιρετικό αλλού. */}
            {needsTemplate && (
              <section className="space-y-2 rounded-xl border border-sisyphus-200 bg-sisyphus-50/40 p-3">
                <p className="text-[11px] font-medium text-sisyphus-700">
                  Πρότυπο χρεοπίστωσης <span className="text-destructive">*</span> — από εκεί αντιγράφονται ο
                  «Τύπος» (<code>MTRTYPE</code>) και ο <strong>λογαριασμός γενικής</strong> (<code>ACNMSK</code>).
                  Η εφαρμογή δεν τα παράγει από την περιγραφή της γραμμής.
                </p>
                <RegistrySearch
                  kind="lineitem"
                  id="lineitem-template"
                  label="Διάλεξε συναφή χρεοπίστωση"
                  onPick={(p) => pickTemplate({ id: p.id, code: p.code, name: p.name })}
                />
                {template && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                    <FiCheck className="h-3.5 w-3.5" /> Πρότυπο: <span className="font-medium">{template.code} — {template.name}</span>
                  </p>
                )}
                {copied && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg border border-border bg-card p-2 text-[11px]">
                    {Object.entries(copied).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt className="font-mono text-muted-foreground">{k}</dt>
                        <dd className="font-medium">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}

            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Βασικά στοιχεία</p>
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Περιγραφή <span className="text-destructive">*</span></span>
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} className="h-9 text-[13px]" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Κωδικός <span className="text-destructive">*</span></span>
                  <Input value={f.code} onChange={(e) => { set('code', e.target.value); setCodeError(null); }}
                    aria-invalid={codeError ? true : undefined} className="h-9 font-mono text-[13px]" />
                  {codeError && (
                    <span className="text-[11px]" style={{ color: '#B91C1C' }}>
                      {codeError}
                      {codeOffer && (
                        <button type="button" onClick={() => { set('code', codeOffer); setCodeError(null); }}
                          className="ml-1.5 cursor-pointer font-semibold underline">Χρήση του {codeOffer}</button>
                      )}
                    </span>
                  )}
                </label>
                {isItem && (
                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Τιμή χονδρικής (από τη γραμμή)</span>
                    <Input value={f.price} onChange={(e) => set('price', e.target.value)} type="number" placeholder="0,00" className="h-9 text-[13px]" />
                  </label>
                )}
                <div className="grid gap-1.5">
                  <Combo label={`Φ.Π.Α.${isItem ? ' *' : ''}`} k="vat" opts={meta.vats} ph="Επίλεξε ΦΠΑ" />
                  {vatNote && <Note>{vatNote}</Note>}
                </div>
                {hasUnit && (
                  <div className="grid gap-1.5">
                    <Combo label={`Μονάδα${isItem ? ' *' : ''}`} k="unit" opts={orderedUnits}
                      ph={kind === 'lineitem' ? 'Κενό = όπως το πρότυπο' : 'Επίλεξε μονάδα'} />
                    {unitNote && <Note>{unitNote}</Note>}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ταξινόμηση (προαιρετικά)</p>
              <div className="grid grid-cols-2 gap-3">
                {/* Οι δύο κατάλογοι είναι ΔΙΑΦΟΡΕΤΙΚΟΙ πίνακες: `MTRCATEGORY` (είδη) και
                    `LINCATEGORY` (δαπάνες, SODTYPE 53). Μια χρεοπίστωση σε κατηγορία ειδών δεν
                    βρίσκεται ποτέ ξανά από το φίλτρο «κατηγορία δαπάνης» του picker. */}
                <Combo
                  label={kind === 'lineitem' ? 'Κατηγορία δαπάνης' : 'Κατηγορία'}
                  k="category"
                  opts={kind === 'lineitem' ? meta.lineCategories : meta.categories}
                />
                {isItem && <Combo label="Ομάδα" k="group" opts={meta.groups} />}
              </div>
            </section>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-auto px-5 py-4">
            {dryPayload != null
              ? <p className="text-[11px] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              : <p className="text-[11px] text-muted-foreground">Πάτησε «Προετοιμασία object» για να δεις τι θα σταλεί.</p>}
            {dryPayload != null && (
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[11.5px] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="h-3.5 w-3.5 accent-sisyphus-600" />
            Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)
          </label>
          <div className="flex gap-2">
            {dryPayload != null && (
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(dryPayload, null, 2)); toast.success('Αντιγράφηκε'); }}>
                <FiCopy className="mr-1.5 h-4 w-4" /> Αντιγραφή JSON
              </Button>
            )}
            <Button onClick={submit} disabled={submitting}>
              {submitting ? '…' : dryRun ? 'Προετοιμασία object' : 'Δημιουργία στο SoftOne'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1 text-[11px]" style={{ color: '#B45309' }}>
      <FiAlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" /> {children}
    </span>
  );
}
