'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMarquee, type NormBox } from '@/app/admin/ocr/[id]/use-marquee';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docId: string | null;
  mimeType: string | null;
  supplierName?: string | null;
};

export function SupplierFieldRuleDialog({ open, onOpenChange, docId, mimeType, supplierName }: Props) {
  const router = useRouter();
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [scope, setScope] = React.useState<'document' | 'line'>('document');
  const [valueType, setValueType] = React.useState<'text' | 'list'>('text');
  const [region, setRegion] = React.useState<{ page: number; bbox: [number, number, number, number] } | null>(null);
  const [marking, setMarking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [foundValue, setFoundValue] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setLabel(''); setDescription(''); setRegion(null); setMarking(false); setFoundValue(null); setScope('document'); setValueType('text'); }
  }, [open, docId]);

  const onMarqueeComplete = React.useCallback((b: NormBox) => {
    setRegion({ page: 0, bbox: [b.x, b.y, b.w, b.h] });
    setMarking(false);
  }, []);
  const { ref, box, active, handlers } = useMarquee(onMarqueeComplete);

  const fileUrl = docId ? `/api/admin/ocr/${docId}/file` : '';
  const isPdf = mimeType === 'application/pdf';

  async function submit() {
    if (!docId || !label.trim()) { toast.error('Δώσε όνομα πεδίου.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/field-rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          description: description.trim() || undefined,
          regionHint: scope === 'document' ? (region ?? undefined) : undefined,
          scope, valueType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      if (scope === 'line') {
        const n = json?.value?.matchedLines ?? 0;
        setFoundValue(`βρέθηκε σε ${n} γραμμές`);
      } else {
        setFoundValue(json.value != null ? String(json.value) : '—');
      }
      toast.success('Ο κανόνας αποθηκεύτηκε.');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Σφάλμα: ${msg}`);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Νέο ειδικό πεδίο{supplierName ? ` — ${supplierName}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Όνομα πεδίου</span>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="π.χ. Αριθμός Παραγγελίας" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Οδηγία (πού/τι να ψάξει)</span>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="π.χ. Ο αριθμός παραγγελίας, συνήθως πάνω δεξιά κάτω από τον τίτλο."
                className="rounded-md border border-input bg-background p-2 text-[12px]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Εμβέλεια</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as 'document' | 'line')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
                  <option value="document">Έγγραφο</option>
                  <option value="line">Γραμμή</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Τύπος τιμής</span>
                <select value={valueType} onChange={(e) => setValueType(e.target.value as 'text' | 'list')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
                  <option value="text">Μία τιμή</option>
                  <option value="list">Λίστα (π.χ. serials)</option>
                </select>
              </label>
            </div>
            {scope === 'document' && (
              <button
                type="button" onClick={() => setMarking((m) => !m)}
                aria-label="Μαρκάρισμα περιοχής" title="Μαρκάρισμα περιοχής"
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
              >
                🎯 {region ? 'Περιοχή ορίστηκε — ξανά' : marking ? 'Σύρε πλαίσιο στο έγγραφο…' : 'Μαρκάρισμα περιοχής (προαιρετικό)'}
              </button>
            )}
            {foundValue !== null && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[12px]">
                Βρέθηκε: <strong>{foundValue}</strong>
              </div>
            )}
          </div>

          <div className="relative max-h-[420px] overflow-auto rounded-lg border border-border bg-muted">
            {docId && (isPdf ? (
              <iframe src={fileUrl} title="doc" className="h-[420px] w-full border-0 bg-white" />
            ) : (
              <div ref={ref} {...(marking ? handlers : {})} className="relative select-none" style={{ cursor: marking ? 'crosshair' : 'default' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl} alt="" className="w-full" draggable={false} />
                {marking && active && box && (
                  <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
                    style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
                )}
              </div>
            ))}
            {isPdf && marking && (
              <p className="p-2 text-[11px] text-muted-foreground">Το μαρκάρισμα περιοχής υποστηρίζεται σε εικόνες· για PDF δώσε οδηγία με κείμενο.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <button type="button" disabled={busy} onClick={() => onOpenChange(false)}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
            Κλείσιμο
          </button>
          <button type="button" disabled={busy || !label.trim()} onClick={submit}
            className="inline-flex h-8 items-center rounded-md bg-sisyphus-500 px-3.5 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50">
            {busy ? 'Αποθήκευση…' : 'Αποθήκευση & εφαρμογή'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
