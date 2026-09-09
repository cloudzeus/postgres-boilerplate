'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiSearch } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { templatesApi, errorMessage } from '@/components/templates/api';

type Supplier = { id: number; code: string; name: string; sub: string };

export function NewTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Supplier[]>([]);
  const [supplier, setSupplier] = React.useState<Supplier | null>(null);
  const [vat, setVat] = React.useState('');
  const [name, setName] = React.useState('');
  const [docType, setDocType] = React.useState<'INVOICE' | 'RECEIPT'>('INVOICE');
  const [busy, setBusy] = React.useState(false);

  // Debounced supplier search (≥2 chars).
  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    // `ignore` so a slow in-flight search cannot land after a newer query's results.
    let ignore = false;
    const h = setTimeout(() => {
      templatesApi.searchSuppliers(q.trim())
        .then((r) => { if (!ignore) setResults(r.results); })
        .catch(() => { if (!ignore) setResults([]); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q]);

  const pick = (s: Supplier) => {
    setSupplier(s);
    const afm = /\b(\d{9})\b/.exec(s.sub)?.[1] ?? '';
    setVat(afm);
    if (!name) setName(`${s.name} — ${docType === 'RECEIPT' ? 'Απόδειξη' : 'Τιμολόγιο'}`);
    setResults([]); setQ(s.name);
  };

  const submit = async () => {
    if (!/^\d{9}$/.test(vat)) { toast.error('ΑΦΜ 9 ψηφίων'); return; }
    if (!name.trim()) { toast.error('Δώσε όνομα προτύπου'); return; }
    setBusy(true);
    try {
      const r = await templatesApi.create({ name: name.trim(), vatNumber: vat, traderTrdr: supplier?.id ?? null, supplierName: supplier?.name ?? null, docType });
      toast.success('Το πρότυπο δημιουργήθηκε');
      setOpen(false);
      router.push(`/admin/ocr/templates/${r.id}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><FiPlus className="mr-1.5 size-3.5" /> Νέο πρότυπο</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Νέο πρότυπο προμηθευτή</DialogTitle>
            <DialogDescription>Διάλεξε προμηθευτή από το SoftOne ή δώσε ΑΦΜ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Label htmlFor="sup">Προμηθευτής</Label>
              <div className="relative mt-1">
                <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input id="sup" value={q} onChange={(e) => { setQ(e.target.value); setSupplier(null); }} placeholder="Αναζήτηση επωνυμίας / ΑΦΜ…" className="pl-8" autoComplete="off" />
              </div>
              {results.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-white shadow-fluent-8">
                  {results.map((s) => (
                    <li key={s.id}><button type="button" onClick={() => pick(s)} className="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-[var(--cx-hover)]">
                      <span className="text-[13px] font-medium">{s.name}</span><span className="text-[11px] text-muted-foreground">{s.sub}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="vat">ΑΦΜ</Label><Input id="vat" value={vat} onChange={(e) => setVat(e.target.value.replace(/\D/g, '').slice(0, 9))} className="mt-1 font-mono" inputMode="numeric" /></div>
              <div><Label htmlFor="dt">Τύπος εγγράφου</Label>
                <select id="dt" value={docType} onChange={(e) => setDocType(e.target.value as 'INVOICE' | 'RECEIPT')} className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-2 text-[13px]">
                  <option value="INVOICE">Τιμολόγιο</option><option value="RECEIPT">Απόδειξη</option>
                </select></div>
            </div>
            <div><Label htmlFor="nm">Όνομα προτύπου</Label><Input id="nm" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="π.χ. COSMOTE — Τιμολόγιο υπηρεσιών" /></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>Άκυρο</Button>
              <Button onClick={submit} disabled={busy}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
