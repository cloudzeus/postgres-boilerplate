'use client';

import * as React from 'react';
import { FiDownloadCloud, FiSearch, FiCheck, FiAlertCircle, FiBriefcase, FiList } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Field, FormSection, fieldCls } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';

export type AadeActivity = {
  code: string;
  description: string;
  kind: 'PRIMARY' | 'SECONDARY';
  order?: number;
};

export type AadeMapped = {
  afm: string;
  name: string;
  shortName: string | null;
  doy: string | null;
  /** Ο επίσημος κωδικός Δ.Ο.Υ. της ΑΑΔΕ. */
  doyCode?: string | null;
  legalForm: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  foundingDate: string | null;
  profession: string | null;
  aadeStatus: string | null;
  aadeFirmKind: string | null;
  isActive: boolean;
};

export type AadeResult = { mapped: AadeMapped; activities: AadeActivity[] };

type Props = {
  initialAfm?: string;
  onApply: (data: AadeResult) => void;
  /** size of the trigger icon button */
  size?: 'sm' | 'md';
  label?: string;
};

export function AadeLookupButton({ initialAfm, onApply, size = 'sm', label = 'Άντληση από ΑΕΔΕΕ' }: Props) {
  const [open, setOpen] = React.useState(false);
  const [afm, setAfm] = React.useState(initialAfm ?? '');
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<AadeResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (open) { setAfm(initialAfm ?? ''); setData(null); setError(null); } }, [open, initialAfm]);

  const fetchAade = async () => {
    setError(null); setData(null);
    if (!/^\d{9}$/.test(afm)) { setError('ΑΦΜ 9 ψηφία'); return; }
    setLoading(true);
    const res = await fetch('/api/admin/aade-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm }),
    });
    setLoading(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setError(
        e.error === 'not_found' ? 'Δεν βρέθηκε ΑΦΜ' :
        e.error === 'aade_unreachable' ? 'Η υπηρεσία ΑΕΔΕΕ δεν είναι προσβάσιμη' :
        'Σφάλμα ανάκτησης',
      );
      return;
    }
    const json = await res.json() as AadeResult;
    setData(json);
  };

  const apply = () => {
    if (!data) return;
    onApply(data);
    toast.success('Εφαρμόστηκαν τα στοιχεία από ΑΕΔΕΕ');
    setOpen(false);
  };

  const triggerCls = size === 'sm'
    ? 'inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
    : 'inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={triggerCls} aria-label={label} onClick={() => setOpen(true)}>
              <FiDownloadCloud className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiDownloadCloud className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[length:var(--fs-15)]">Στοιχεία από ΑΕΔΕΕ</DialogTitle>
              <DialogDescription className="truncate text-[length:var(--fs-11)]">
                Εισάγετε ΑΦΜ για ανάκτηση των επίσημων στοιχείων από το Μητρώο.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            <FormSection tone="blue" icon={<FiSearch />} title="Αναζήτηση">
              <div className="grid grid-cols-12 items-end gap-x-3 gap-y-2">
                <Field label="ΑΦΜ" htmlFor="aade-afm" className="col-span-12 sm:col-span-8">
                  <Input
                    id="aade-afm" value={afm} maxLength={9}
                    className={cn(fieldCls, 'font-mono tabular-nums')}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setAfm(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAade(); } }}
                    placeholder="123456789" inputMode="numeric"
                  />
                </Field>
                <Button className="col-span-12 h-8 text-[length:var(--fs-13)] sm:col-span-4" onClick={fetchAade} disabled={loading || afm.length !== 9}>
                  <FiSearch className="mr-1" /> {loading ? 'Αναζήτηση…' : 'Αναζήτηση'}
                </Button>
              </div>
              {error && (
                <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-[length:var(--fs-12)] text-destructive">
                  <FiAlertCircle aria-hidden className="shrink-0" /> {error}
                </div>
              )}
            </FormSection>

            {data && (
              <FormSection
                tone="emerald" icon={<FiBriefcase />} title="Μητρώο"
                aside={
                  <Badge variant="outline" className={data.mapped.isActive ? 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300' : 'border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300'}>
                    {data.mapped.aadeStatus ?? (data.mapped.isActive ? 'Ενεργός' : 'Ανενεργός')}
                  </Badge>
                }
              >
                <div className="min-w-0">
                  <div className="text-[length:var(--fs-13)] font-semibold text-foreground">{data.mapped.name}</div>
                  {data.mapped.shortName && (
                    <div className="truncate text-[length:var(--fs-11)] text-muted-foreground">{data.mapped.shortName}</div>
                  )}
                </div>
                <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[length:var(--fs-12)]">
                  <Row label="ΑΦΜ"><span className="font-mono tabular-nums">{data.mapped.afm}</span></Row>
                  <Row label="ΔΟΥ">{data.mapped.doy ? `${data.mapped.doy}${data.mapped.doyCode ? ` (${data.mapped.doyCode})` : ''}` : '—'}</Row>
                  <Row label="Νομική μορφή">{data.mapped.legalForm ?? '—'}</Row>
                  <Row label="Ίδρυση">{data.mapped.foundingDate ?? '—'}</Row>
                  <Row label="Διεύθυνση">{[data.mapped.address, data.mapped.zip, data.mapped.city].filter(Boolean).join(', ') || '—'}</Row>
                  <Row label="Κύρια δραστηριότητα">{data.mapped.profession ?? '—'}</Row>
                </dl>
              </FormSection>
            )}

            {data && (
              <FormSection tone="amber" icon={<FiList />} title={`ΚΑΔ (${data.activities.length})`}>
                <ul className="-mx-3 -my-2.5 max-h-40 divide-y divide-border overflow-y-auto">
                  {data.activities.map((a) => (
                    <li key={a.code} className="flex items-center gap-2 px-3 py-1">
                      <span className="w-20 shrink-0 font-mono text-[length:var(--fs-11)] tabular-nums">{a.code}</span>
                      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-11)]" title={a.description}>{a.description}</span>
                      <Badge
                        variant="outline"
                        className={a.kind === 'PRIMARY' ? 'text-[length:var(--fs-9)] border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300' : 'text-[length:var(--fs-9)]'}
                      >
                        {a.kind === 'PRIMARY' ? 'ΚΥΡΙΑ' : 'ΔΕΥΤ.'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </FormSection>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
            <Button variant="outline" onClick={() => setOpen(false)}>Άκυρο</Button>
            <Button onClick={apply} disabled={!data}>
              <FiCheck className="mr-1" /> Εφαρμογή στη φόρμα
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="truncate text-muted-foreground" title={label}>{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{children}</dd>
    </>
  );
}
