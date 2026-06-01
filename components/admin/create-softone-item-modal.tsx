'use client';

import * as React from 'react';
import { FiPackage, FiTool, FiCopy, FiCode, FiEdit3, FiCheck, FiCopy as FiClone, FiPlusCircle } from 'react-icons/fi';
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
import { SoftoneSearchPanel } from '@/components/admin/softone-match-picker';

type Opt = { id: string; name: string };
type Meta = { vats: Opt[]; units: Opt[]; groups: Opt[]; categories: Opt[]; manufacturers: Opt[]; brands: Opt[] };

export function CreateSoftoneItemModal({
  open, onOpenChange, lineId, initialCode, initialName, defaultService, initialVatRate, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lineId?: string;
  initialCode?: string;
  initialName?: string;
  defaultService?: boolean;
  initialVatRate?: string | number | null;
  onCreated?: (m: { mtrl: number; code: string; name: string }) => void;
}) {
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [tab, setTab] = React.useState<'form' | 'object'>('form');
  const [mode, setMode] = React.useState<'blank' | 'similar'>('blank');
  const [copiedFrom, setCopiedFrom] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [f, setF] = React.useState({
    code: '', name: '', isService: false, vat: '', unit: '', group: '', category: '', manufacturer: '', brand: '', price: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setTab('form');
    setMode('blank');
    setCopiedFrom(null);
    setDryPayload(null);
    setDryRun(true);
    setF((s) => ({ ...s, code: initialCode ?? '', name: initialName ?? '', isService: !!defaultService }));
    fetch('/api/admin/softone/item-meta').then((r) => r.json()).then((m: Meta) => {
      setMeta(m);
      // Prefer the line's own VAT rate, then standard 24%, then first.
      const pct = (n: string) => { const x = n.match(/\(([\d.,]+)\s*%\)/); return x ? parseFloat(x[1].replace(',', '.')) : NaN; };
      const lineRate = initialVatRate != null && initialVatRate !== '' ? parseFloat(String(initialVatRate).replace(',', '.')) : NaN;
      const byRate = Number.isFinite(lineRate) ? m.vats.find((v) => pct(v.name) === lineRate) : undefined;
      setF((s) => ({
        ...s,
        vat: s.vat || (byRate?.id ?? m.vats.find((v) => pct(v.name) === 24)?.id ?? m.vats[0]?.id ?? ''),
        unit: s.unit || (m.units.find((u) => /τεμ/i.test(u.name))?.id ?? m.units[0]?.id ?? ''),
      }));
    }).catch(() => setMeta({ vats: [], units: [], groups: [], categories: [], manufacturers: [], brands: [] }));
  }, [open, initialCode, initialName, defaultService, initialVatRate]);

  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  // "Copy from similar" — live-read the picked item's full classification and prefill.
  const copyFromSimilar = async (picked: { id: number; name: string }) => {
    setCopiedFrom(picked.name);
    try {
      const res = await fetch(`/api/admin/softone/item-detail?mtrl=${picked.id}`);
      if (!res.ok) { toast.error('Αποτυχία ανάγνωσης χαρακτηριστικών'); return; }
      const d = await res.json();
      setF((s) => ({
        ...s,
        isService: typeof d.isService === 'boolean' ? d.isService : s.isService,
        vat: d.vat ?? s.vat,
        unit: d.unit ?? s.unit,
        group: d.group ?? '',
        category: d.category ?? '',
        manufacturer: d.manufacturer ?? '',
        brand: d.brand ?? '',
      }));
      toast.success(`Αντιγράφηκαν χαρακτηριστικά από: ${picked.name}`);
    } catch {
      toast.error('Σφάλμα δικτύου');
    }
  };

  const submit = async () => {
    if (!f.name.trim() || !f.code.trim() || !f.vat || !f.unit) {
      toast.error('Συμπλήρωσε Περιγραφή, Κωδικό, ΦΠΑ και Μονάδα.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: f.code, name: f.name, isService: f.isService, vat: f.vat, unit: f.unit,
          price: f.price ? Number(f.price) : null,
          group: f.group || null, category: f.category || null,
          manufacturer: f.manufacturer || null, brand: f.brand || null,
          lineId: lineId ?? null,
          dryRun,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message ?? 'Αποτυχία δημιουργίας στο SoftOne'); return; }
      if (d?.dryRun) {
        setDryPayload(d.payload);
        setTab('object');
        toast.success('Ετοιμάστηκε το object (δεν στάλθηκε στο SoftOne)');
        return;
      }
      toast.success(`Δημιουργήθηκε: ${d.name} (${d.code})`);
      onCreated?.({ mtrl: d.mtrl, code: d.code, name: d.name });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setSubmitting(false);
    }
  };

  const payload = React.useMemo(() => {
    const ITEM: Record<string, unknown> = {
      CODE: f.code, NAME: f.name, SODTYPE: f.isService ? 52 : 51, MTRTYPE: 0,
      VAT: f.vat || null, MTRUNIT1: f.unit || null, MTRUNIT3: f.unit || null, MTRUNIT4: f.unit || null, ISACTIVE: 1,
    };
    if (f.price) ITEM.PRICER = Number(f.price);
    if (f.group) ITEM.MTRGROUP = f.group;
    if (f.category) ITEM.MTRCATEGORY = f.category;
    if (f.manufacturer) ITEM.MTRMANFCTR = f.manufacturer;
    if (f.brand) ITEM.MTRMARK = f.brand;
    return { service: 'setData', OBJECT: 'ITEM', KEY: '', DATA: { ITEM: [ITEM] }, _lineId: lineId ?? null };
  }, [f, lineId]);
  const json = JSON.stringify(payload, null, 2);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* Header */}
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[15px]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600">
              {f.isService ? <FiTool className="h-4 w-4" /> : <FiPackage className="h-4 w-4" />}
            </span>
            Νέο {f.isService ? 'υπηρεσία' : 'είδος'} στο SoftOne
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Συμπλήρωσε τα στοιχεία· στην καρτέλα «Αντικείμενο» βλέπεις ό,τι θα σταλεί.
          </DialogDescription>
        </DialogHeader>

        {/* Segmented tabs */}
        <div className="flex gap-1 border-b border-border bg-muted/30 px-5 py-2">
          {([['form', 'Στοιχεία', <FiEdit3 key="a" className="h-3.5 w-3.5" />], ['object', 'Αντικείμενο', <FiCode key="b" className="h-3.5 w-3.5" />]] as const).map(([v, lbl, ic]) => (
            <button key={v} onClick={() => setTab(v)}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                tab === v ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              {ic} {lbl}
            </button>
          ))}
        </div>

        {!meta ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">Φόρτωση πινάκων…</div>
        ) : tab === 'form' ? (
          <div className="max-h-[60vh] space-y-5 overflow-auto px-5 py-4">
            {/* Mode: copy-from-similar vs blank */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted p-1">
              {([['Αντιγραφή από συναφές', 'similar', <FiClone key="c" className="h-4 w-4" />], ['Κενή φόρμα', 'blank', <FiPlusCircle key="b" className="h-4 w-4" />]] as const).map(([lbl, val, ic]) => (
                <button key={val} onClick={() => setMode(val)}
                  className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold transition-all',
                    mode === val ? 'bg-card text-sisyphus-700 shadow-sm ring-1 ring-sisyphus-200' : 'text-muted-foreground hover:text-foreground')}>
                  {ic} {lbl}
                </button>
              ))}
            </div>

            {mode === 'similar' && (
              <section className="space-y-2 rounded-xl border border-sisyphus-200 bg-sisyphus-50/40 p-3">
                <p className="text-[11px] font-medium text-sisyphus-700">
                  Διάλεξε συναφές {f.isService ? 'υπηρεσία' : 'είδος'} — θα αντιγραφεί η ταξινόμηση (ΦΠΑ, μονάδα, ομάδα, κατηγορία, κατασκευαστής, μάρκα).
                </p>
                <SoftoneSearchPanel
                  type="items"
                  service={f.isService ? '1' : '0'}
                  autoFocus={false}
                  placeholder="Αναζήτησε συναφές είδος/υπηρεσία…"
                  onPick={(r) => copyFromSimilar({ id: r.id, name: r.name })}
                />
                {copiedFrom && (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                    <FiCheck className="h-3.5 w-3.5" /> Αντιγράφηκε από: <span className="font-medium">{copiedFrom}</span>
                  </p>
                )}
              </section>
            )}

            {/* Type segmented control */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted p-1">
              {([['Είδος', false, <FiPackage key="p" className="h-4 w-4" />], ['Υπηρεσία', true, <FiTool key="t" className="h-4 w-4" />]] as const).map(([lbl, val, ic]) => (
                <button key={lbl} onClick={() => set('isService', val)}
                  className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold transition-all',
                    f.isService === val ? 'bg-card text-sisyphus-700 shadow-sm ring-1 ring-sisyphus-200' : 'text-muted-foreground hover:text-foreground')}>
                  {ic} {lbl}
                </button>
              ))}
            </div>

            {/* Βασικά */}
            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Βασικά στοιχεία</p>
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Περιγραφή <span className="text-destructive">*</span></span>
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="π.χ. Κατοχύρωση Ονόματος Χώρου GR" className="h-9 text-[13px]" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Κωδικός <span className="text-destructive">*</span></span>
                  <Input value={f.code} onChange={(e) => set('code', e.target.value)} className="h-9 font-mono text-[13px]" />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Τιμή λιανικής</span>
                  <Input value={f.price} onChange={(e) => set('price', e.target.value)} type="number" placeholder="0,00" className="h-9 text-[13px]" />
                </label>
                <Combo label="Φ.Π.Α. *" k="vat" opts={meta.vats} ph="Επίλεξε ΦΠΑ" />
                <Combo label="Μονάδα *" k="unit" opts={meta.units} ph="Επίλεξε μονάδα" />
              </div>
            </section>

            {/* Ταξινόμηση */}
            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ταξινόμηση (προαιρετικά)</p>
              <div className="grid grid-cols-2 gap-3">
                <Combo label="Ομάδα" k="group" opts={meta.groups} />
                <Combo label="Κατηγορία" k="category" opts={meta.categories} />
                <Combo label="Κατασκευαστής" k="manufacturer" opts={meta.manufacturers} />
                <Combo label="Μάρκα" k="brand" opts={meta.brands} />
              </div>
            </section>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-auto px-5 py-4">
            {dryPayload != null && (
              <p className="text-[11px] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
            )}
            <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[11.5px] leading-relaxed text-[#d6e2f5]">{dryPayload != null ? JSON.stringify(dryPayload, null, 2) : json}</pre>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="h-3.5 w-3.5 accent-sisyphus-600" />
            Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(dryPayload != null ? JSON.stringify(dryPayload, null, 2) : json); toast.success('Αντιγράφηκε το αντικείμενο'); }}>
              <FiCopy className="mr-1.5 h-4 w-4" /> Αντιγραφή JSON
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? '…' : dryRun ? 'Προετοιμασία object' : 'Δημιουργία στο SoftOne'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
