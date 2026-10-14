'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';

export type OpenRequest = { code: string; name: string; vatRate: number | null };
type Plan = {
  code: string; name: string;
  parent: { code: string; name: string };
  template: { code: string; name: string };
  vat: { rate: number; code: string } | null;
  vatAccount: { code: string; name: string } | null;
};

/**
 * Άνοιγμα λογαριασμού στο SoftOne σε δύο βήματα: πρώτα η εφαρμογή δείχνει ΤΙ θα σταλεί (πρότυπο,
 * ΦΠΑ, λογαριασμός ΦΠΑ), και μόνο μετά από ρητό «Άνοιγμα» φεύγει η εγγραφή.
 */
export function OpenAccountDialog({ req, onClose, onDone }: { req: OpenRequest | null; onClose: () => void; onDone: (code: string) => void }) {
  const [name, setName] = React.useState('');
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Η περιγραφή της τελευταίας προεπισκόπησης: χωρίς αλλαγή, η απομάκρυνση από το πεδίο δεν ξανατρέχει
  // προεπισκόπηση (που θα απενεργοποιούσε το κουμπί ακριβώς τη στιγμή του κλικ).
  const previewed = React.useRef('');

  React.useEffect(() => {
    if (!req) return;
    setName(req.name); setPlan(null); setError(null); previewed.current = '';
    void preview(req.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  async function call(body: object) {
    const res = await fetch('/api/admin/softone/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req!.code, name, vatRate: req!.vatRate, ...body }),
    });
    return { ok: res.ok, d: await res.json().catch(() => ({})) };
  }
  async function preview(n = name) {
    if (!req || !n.trim() || n === previewed.current) return;
    previewed.current = n;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/softone/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: req.code, name: n, vatRate: req.vatRate, dryRun: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setPlan(d); setError(null); } else { setPlan(null); setError(d.message ?? 'Η προεπισκόπηση απέτυχε.'); }
    } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try {
      const { ok, d } = await call({});
      if (!ok) { setError(d.message ?? 'Η δημιουργία απέτυχε.'); return; }
      toast.success(`Ο λογαριασμός ${d.code} άνοιξε στο SoftOne και επαληθεύτηκε.`);
      onDone(d.code ?? req!.code);
    } catch {
      setError('Σφάλμα δικτύου — έλεγξε στο SoftOne αν δημιουργήθηκε πριν ξαναπροσπαθήσεις.');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!req} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Άνοιγμα λογαριασμού στο SoftOne</DialogTitle>
          <DialogDescription className="font-mono">{req?.code}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1">
          <span className="text-[length:var(--fs-12)] font-semibold text-foreground">Περιγραφή</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void preview()}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-[length:var(--fs-14)]" />
        </label>
        {plan && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-[length:var(--fs-12)]">
            <dt className="text-muted-foreground">Κάτω από</dt><dd><span className="font-mono">{plan.parent.code}</span> {plan.parent.name}</dd>
            <dt className="text-muted-foreground">Ρυθμίσεις από</dt><dd><span className="font-mono">{plan.template.code}</span> {plan.template.name}</dd>
            <dt className="text-muted-foreground">ΦΠΑ</dt><dd>{plan.vat ? `${plan.vat.rate}% (κωδ. ${plan.vat.code})` : 'Χωρίς ΦΠΑ'}</dd>
            {plan.vatAccount && <><dt className="text-muted-foreground">Λογ. ΦΠΑ</dt><dd><span className="font-mono">{plan.vatAccount.code}</span> {plan.vatAccount.name}</dd></>}
          </dl>
        )}
        {error && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-[length:var(--fs-12)] text-foreground">{error}</p>}
        <DialogFooter className="mx-0 mb-0">
          <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Άκυρο</button>
          <button type="button" className={BTN_PRIMARY} onClick={create} disabled={busy || !plan}>
            {busy ? 'Περιμένε…' : 'Άνοιγμα στο SoftOne'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
