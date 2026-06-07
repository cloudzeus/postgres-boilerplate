'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiPlus } from 'react-icons/fi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function TaxTemplateNewButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!code.trim() || !name.trim()) { toast.error('Συμπλήρωσε κωδικό και όνομα.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tax-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), name: name.trim(), year: year ? Number(year) : null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('Το πρότυπο δημιουργήθηκε.');
      setOpen(false);
      router.push(`/admin/tax-templates/${json.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setCode(''); setName(''); setYear(String(new Date().getFullYear())); setOpen(true); }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600"
      >
        <FiPlus className="size-3.5" /> Νέο πρότυπο
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Νέο πρότυπο εντύπου</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Κωδικός (π.χ. Ε3)</span>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ε3" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Όνομα</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Κατάσταση αποτελεσμάτων" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Έτος (προαιρετικό)</span>
              <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2024" type="number" />
            </label>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
              Ακύρωση
            </button>
            <button type="button" onClick={create} disabled={busy || !code.trim() || !name.trim()}
              className="inline-flex h-8 items-center rounded-md bg-sisyphus-500 px-3.5 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
              {busy ? 'Δημιουργία…' : 'Δημιουργία'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
