'use client';

import * as React from 'react';
import { FiDownloadCloud, FiSearch, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FiDownloadCloud className="text-primary" /> Στοιχεία από ΑΕΔΕΕ
            </DialogTitle>
            <DialogDescription>
              Εισάγετε ΑΦΜ για ανάκτηση των επίσημων στοιχείων από το Μητρώο.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end gap-2">
            <div className="flex-1 grid gap-1">
              <Label htmlFor="aade-afm" className="text-[11px]">ΑΦΜ</Label>
              <Input
                id="aade-afm" value={afm} maxLength={9}
                onChange={(e) => setAfm(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAade(); } }}
                placeholder="123456789" inputMode="numeric"
              />
            </div>
            <Button onClick={fetchAade} disabled={loading || afm.length !== 9}>
              <FiSearch className="mr-1" /> {loading ? 'Αναζήτηση…' : 'Αναζήτηση'}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <FiAlertCircle /> {error}
            </div>
          )}

          {data && (
            <div className="space-y-3 rounded-sm border p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">{data.mapped.name}</div>
                  {data.mapped.shortName && (
                    <div className="text-[11px] text-muted-foreground truncate">{data.mapped.shortName}</div>
                  )}
                </div>
                <Badge variant="outline" className={data.mapped.isActive ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}>
                  {data.mapped.aadeStatus ?? (data.mapped.isActive ? 'Ενεργός' : 'Ανενεργός')}
                </Badge>
              </div>

              <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                <Row label="ΑΦΜ">{data.mapped.afm}</Row>
                <Row label="ΔΟΥ">{data.mapped.doy ?? '—'}</Row>
                <Row label="Νομική μορφή">{data.mapped.legalForm ?? '—'}</Row>
                <Row label="Ίδρυση">{data.mapped.foundingDate ?? '—'}</Row>
                <Row label="Διεύθυνση" wide>{[data.mapped.address, data.mapped.zip, data.mapped.city].filter(Boolean).join(', ') || '—'}</Row>
                <Row label="Κύρια δραστηριότητα" wide>{data.mapped.profession ?? '—'}</Row>
              </dl>

              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                  ΚΑΔ ({data.activities.length})
                </div>
                <ul className="max-h-40 overflow-y-auto divide-y divide-border rounded-sm border">
                  {data.activities.map((a) => (
                    <li key={a.code} className="flex items-center gap-2 px-2 py-1">
                      <span className="font-mono text-[11px] tabular-nums w-20 shrink-0">{a.code}</span>
                      <span className="flex-1 text-[11px] truncate" title={a.description}>{a.description}</span>
                      <Badge
                        variant="outline"
                        className={a.kind === 'PRIMARY' ? 'text-[9px] border-emerald-300 text-emerald-700' : 'text-[9px]'}
                      >
                        {a.kind === 'PRIMARY' ? 'ΚΥΡΙΑ' : 'ΔΕΥΤ.'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <DialogFooter>
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

function Row({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground truncate">{children}</dd>
    </div>
  );
}
