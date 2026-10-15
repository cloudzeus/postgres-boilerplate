'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FiAlertTriangle, FiBookOpen, FiCheckCircle, FiEdit3 } from 'react-icons/fi';
import { BTN_GHOST, BTN_PRIMARY } from '@/components/admin/bulk-ui';
import { Field, FormSection, fieldCls } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';

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
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiBookOpen className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Άνοιγμα λογαριασμού στο SoftOne</DialogTitle>
            <DialogDescription className="truncate font-mono text-[length:var(--fs-11)]">{req?.code}</DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-3 bg-muted/20 px-4 py-3">
          <FormSection tone="blue" icon={<FiEdit3 />} title="Λογαριασμός">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Κωδικός" htmlFor="open-account-code" className="col-span-12 sm:col-span-4">
                <input id="open-account-code" value={req?.code ?? ''} readOnly tabIndex={-1}
                  className={cn(fieldCls, 'w-full rounded-md border border-input bg-muted/40 px-2.5 font-mono text-muted-foreground')} />
              </Field>
              <Field label="Περιγραφή" htmlFor="open-account-name" className="col-span-12 sm:col-span-8">
                <input id="open-account-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void preview()}
                  className={cn(fieldCls, 'w-full rounded-md border border-input bg-background px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')} />
              </Field>
            </div>
          </FormSection>
          {plan && (
            <FormSection tone="emerald" icon={<FiCheckCircle />} title="Τι θα σταλεί" aside="προεπισκόπηση">
              <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[length:var(--fs-12)]">
                <dt className="text-muted-foreground">Κάτω από</dt><dd className="min-w-0"><span className="font-mono">{plan.parent.code}</span> {plan.parent.name}</dd>
                <dt className="text-muted-foreground">Ρυθμίσεις από</dt><dd className="min-w-0"><span className="font-mono">{plan.template.code}</span> {plan.template.name}</dd>
                <dt className="text-muted-foreground">ΦΠΑ</dt><dd className="min-w-0">{plan.vat ? `${plan.vat.rate}% (κωδ. ${plan.vat.code})` : 'Χωρίς ΦΠΑ'}</dd>
                {plan.vatAccount && <><dt className="text-muted-foreground">Λογ. ΦΠΑ</dt><dd className="min-w-0"><span className="font-mono">{plan.vatAccount.code}</span> {plan.vatAccount.name}</dd></>}
              </dl>
            </FormSection>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-50/70 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <FiAlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Άκυρο</button>
          <button type="button" className={BTN_PRIMARY} onClick={create} disabled={busy || !plan}>
            {busy ? 'Περιμένε…' : 'Άνοιγμα στο SoftOne'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
