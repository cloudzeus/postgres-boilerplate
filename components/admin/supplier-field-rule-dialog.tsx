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
  const [previewError, setPreviewError] = React.useState(false);

  React.useEffect(() => {
    if (open) { setLabel(''); setDescription(''); setRegion(null); setMarking(false); setFoundValue(null); setScope('document'); setValueType('text'); setPreviewError(false); }
  }, [open, docId]);

  const onMarqueeComplete = React.useCallback((b: NormBox) => {
    setRegion({ page: 0, bbox: [b.x, b.y, b.w, b.h] });
    setMarking(false);
  }, []);
  const { ref, box, active, handlers } = useMarquee(onMarqueeComplete);

  const fileUrl = docId ? `/api/admin/ocr/${docId}/file` : '';
  const isPdf = mimeType === 'application/pdf';
  // For marking we need a raster the user can drag over: PDFs → rasterized page,
  // images → the original. (A native PDF iframe can't be marqueed reliably.)
  const previewSrc = docId ? (isPdf ? `/api/admin/ocr/${docId}/page-image?scale=2` : fileUrl) : '';

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
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1500px] flex-col overflow-hidden sm:max-w-[1500px]">
        <DialogHeader>
          <DialogTitle>Νέο ειδικό πεδίο{supplierName ? ` — ${supplierName}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-3 overflow-auto pr-1">
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

          <div className="relative min-h-0 h-full overflow-auto rounded-lg border border-border bg-muted">
            {docId && !previewError ? (
              <div
                ref={ref}
                {...(marking ? handlers : {})}
                className="relative w-full select-none"
                style={{ cursor: marking ? 'crosshair' : 'default', touchAction: marking ? 'none' : undefined }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewSrc} alt="" className="block w-full" draggable={false} onError={() => setPreviewError(true)} />
                {/* live selection */}
                {marking && active && box && (
                  <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
                    style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
                )}
                {/* persisted selection */}
                {!active && region && (
                  <div className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-500/10"
                    style={{ left: `${region.bbox[0] * 100}%`, top: `${region.bbox[1] * 100}%`, width: `${region.bbox[2] * 100}%`, height: `${region.bbox[3] * 100}%` }} />
                )}
              </div>
            ) : docId ? (
              <div className="space-y-2 p-3 text-[12px] text-muted-foreground">
                <p>Δεν ήταν δυνατή η εικόνα για μαρκάρισμα.</p>
                <a href={fileUrl} target="_blank" rel="noreferrer" className="font-semibold text-sisyphus-600 hover:underline">Άνοιγμα πρωτότυπου</a>
                <p>Δώσε οδηγία με κείμενο για να το βρει το AI.</p>
              </div>
            ) : null}
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
