'use client';

import * as React from 'react';
import { FiTruck, FiCheckCircle, FiAlertTriangle, FiDownloadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

type Preview = {
  afm: string; name: string;
  doyDescr: string | null; doyCode: string | null;
  profession: string | null; address: string | null; zip: string | null; city: string | null;
  legalForm: string | null; isActive: boolean;
};

/**
 * Creates a SoftOne supplier. For Greek ΑΦΜ it pulls authoritative data from AADE
 * (afm2info) + resolves the Δ.Ο.Υ. code; for foreign/invalid ΑΦΜ it falls back to
 * manual entry. Shows the data for confirmation, then writes to SoftOne.
 */
export function CreateSupplierFromAadeDialog({
  open, onOpenChange, afm, docId, fallbackName, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  afm: string;
  docId?: string;
  fallbackName?: string;
  onCreated?: (m: { trdr: number; code: string; name: string }) => void;
}) {
  const [afmInput, setAfmInput] = React.useState('');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Preview | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);

  const cleanAfm = afmInput.replace(/\D/g, '');
  const isGreek = /^\d{9}$/.test(cleanAfm);

  const runLookup = React.useCallback(async (theAfm: string) => {
    const clean = theAfm.replace(/\D/g, '');
    if (!/^\d{9}$/.test(clean)) { setError('Μη έγκυρο ελληνικό ΑΦΜ (9 ψηφία).'); return; }
    setLoading(true); setError(null); setData(null); setDryPayload(null);
    try {
      const res = await fetch('/api/admin/ocr/supplier-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afm: clean }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error === 'not_found' ? 'Δεν βρέθηκε στην ΑΑΔΕ.' : (d?.message ?? 'Αποτυχία άντλησης από ΑΑΔΕ.'));
      } else {
        setData(d);
        if (d?.name) setName(d.name);
      }
    } catch {
      setError('Σφάλμα δικτύου.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset + auto-fetch when opened.
  React.useEffect(() => {
    if (!open) return;
    const initAfm = (afm || '').replace(/\D/g, '');
    setAfmInput(initAfm);
    setName(fallbackName || '');
    setCode(''); setData(null); setError(null); setDryPayload(null); setDryRun(true);
    if (/^\d{9}$/.test(initAfm)) void runLookup(initAfm);
    else setError('Το ΑΦΜ της γραμμής δεν είναι ελληνικό 9ψήφιο — διόρθωσέ το για άντληση ΑΑΔΕ ή συμπλήρωσε χειροκίνητα.');
  }, [open, afm, fallbackName, runLookup]);

  const submit = async () => {
    if (!name.trim() || !cleanAfm) { toast.error('Συμπλήρωσε Επωνυμία και ΑΦΜ.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/ocr/create-supplier', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          afm: cleanAfm, name: name.trim(),
          code: code.trim() || null, doyCode: data?.doyCode ?? null,
          profession: data?.profession ?? null, address: data?.address ?? null,
          zip: data?.zip ?? null, city: data?.city ?? null,
          docId: docId ?? null,
          dryRun,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.message ?? 'Αποτυχία δημιουργίας στο SoftOne'); return; }
      if (d?.dryRun) {
        setDryPayload(d.payload);
        toast.success('Ετοιμάστηκε το object (δεν στάλθηκε στο SoftOne)');
        return;
      }
      toast.success(`Δημιουργήθηκε προμηθευτής: ${d.name}${d.code ? ` (${d.code})` : ''}`);
      onCreated?.({ trdr: d.trdr, code: d.code, name: d.name });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[15px]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiTruck className="h-4 w-4" /></span>
            Νέος προμηθευτής {isGreek ? 'από ΑΑΔΕ' : ''}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Για ελληνικό ΑΦΜ τα στοιχεία αντλούνται από την ΑΑΔΕ· διαφορετικά συμπλήρωσέ τα χειροκίνητα. Καταχωρούνται στο SoftOne.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
          {/* ΑΦΜ (editable) + lookup */}
          <div className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">ΑΦΜ <span className="text-destructive">*</span></span>
            <div className="flex gap-2">
              <Input value={afmInput} onChange={(e) => setAfmInput(e.target.value)} placeholder="9ψήφιο ελληνικό ΑΦΜ" className="h-9 font-mono text-[13px]" />
              <Button variant="outline" className="h-9 shrink-0 text-[12px]" disabled={!isGreek || loading} onClick={() => runLookup(afmInput)}>
                <FiDownloadCloud className="mr-1.5 h-3.5 w-3.5" /> {loading ? 'Άντληση…' : 'Άντληση ΑΑΔΕ'}
              </Button>
            </div>
            {!isGreek && afmInput && (
              <span className="text-[11px] text-amber-700">Μη ελληνικό/μη έγκυρο ΑΦΜ — η ΑΑΔΕ δεν είναι διαθέσιμη. Μπορείς να δημιουργήσεις χειροκίνητα.</span>
            )}
          </div>

          {/* Επωνυμία (editable) */}
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Επωνυμία <span className="text-destructive">*</span></span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Επωνυμία προμηθευτή" className="h-9 text-[13px]" />
          </label>

          {loading && <div className="py-2 text-center text-[12px] text-muted-foreground">Άντληση από ΑΑΔΕ…</div>}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border p-3 text-[12px]" style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
              <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {data && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Νομική μορφή" value={data.legalForm} />
                <Field
                  label="Δ.Ο.Υ."
                  value={data.doyDescr}
                  hint={data.doyCode
                    ? <span className="text-emerald-700">→ κωδ. SoftOne {data.doyCode}</span>
                    : <span className="text-amber-700">δεν αντιστοιχίστηκε — θα μείνει κενή</span>}
                />
              </div>
              <Field label="Επάγγελμα (ΚΑΔ)" value={data.profession} />
              <Field label="Διεύθυνση" value={[data.address, data.zip, data.city].filter(Boolean).join(', ') || null} />
              {!data.isActive && (
                <div className="rounded-md border p-2.5 text-[12px]" style={{ borderColor: '#FCD9A8', backgroundColor: '#FFF8EE', color: '#92400E' }}>
                  Προσοχή: η ΑΑΔΕ δηλώνει το ΑΦΜ ως ανενεργό.
                </div>
              )}
            </div>
          )}

          {/* Κωδικός (optional) */}
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Κωδικός SoftOne (προαιρετικό — κενό = αυτόματος)</span>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="αυτόματος" className="h-9 font-mono text-[13px]" />
          </label>

          {dryPayload != null && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[11px] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="h-3.5 w-3.5 accent-sisyphus-600" />
            Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Άκυρο</Button>
            <Button onClick={submit} disabled={submitting || !name.trim() || !cleanAfm}>
              <FiCheckCircle className="mr-1.5 h-4 w-4" />
              {submitting ? '…' : dryRun ? 'Προετοιμασία object' : 'Δημιουργία στο SoftOne'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, hint }: { label: string; value: string | null; hint?: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[13px] text-foreground">{value || <span className="text-muted-foreground">—</span>}</span>
      {hint && <span className="text-[11px]">{hint}</span>}
    </div>
  );
}
