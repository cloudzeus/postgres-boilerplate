// app/admin/ocr/[id]/field-correction.tsx
'use client';
import { useState, useMemo } from 'react';
import { Button, Input } from '@/lib/design-system';
import { useMarquee, type NormBox } from './use-marquee';

type Hints = Record<string, { page: number; bbox: [number, number, number, number] }>;

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Επωνυμία Εκδότη', vatNumber: 'ΑΦΜ Εκδότη',
  customerName: 'Επωνυμία Πελάτη', customerVatNumber: 'ΑΦΜ Πελάτη',
  invoiceNumber: 'Αρ. Παραστατικού', date: 'Ημερομηνία',
  subtotal: 'Καθαρή Αξία', vatAmount: 'ΦΠΑ', totalAmount: 'Σύνολο',
  storeName: 'Κατάστημα',
};

export function FieldCorrection({ docId, mimeType, fileUrl, initialData, fields }: {
  docId: string; mimeType: string; fileUrl: string;
  initialData: Record<string, any>; fields: string[];
}) {
  const [data, setData] = useState<Record<string, any>>(initialData ?? {});
  const [activeField, setActiveField] = useState<string | null>(null);
  const [hints, setHints] = useState<Hints>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const page = 0; // single-page marquee for v1

  const onComplete = useMemo(() => async (box: NormBox) => {
    if (!activeField) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/read-region`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: activeField, page, bbox: [box.x, box.y, box.w, box.h] }),
      });
      const json = await res.json();
      if (res.ok && json.value) {
        setData((d) => ({ ...d, [activeField]: json.value }));
        setHints((h) => ({ ...h, [activeField]: { page, bbox: [box.x, box.y, box.w, box.h] } }));
      }
    } finally { setBusy(false); setActiveField(null); }
  }, [activeField, docId]);

  const { ref, box, active, handlers } = useMarquee(onComplete);

  async function saveCorrections() {
    setBusy(true);
    try {
      await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: data, items: Array.isArray(data.items) ? data.items : undefined }) });
      setSaved('Οι διορθώσεις αποθηκεύτηκαν.');
    } finally { setBusy(false); }
  }
  async function saveTemplate() {
    setBusy(true);
    try {
      await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: data }) });
      const res = await fetch(`/api/admin/ocr/${docId}/save-template`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldHints: hints }) });
      const json = await res.json();
      setSaved(res.ok ? 'Αποθηκεύτηκε ως πρότυπο προμηθευτή.' : (json.error ?? 'Σφάλμα'));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Document with marquee overlay */}
      <div className="relative rounded-lg overflow-hidden shadow-fluent-8 bg-neutral-4">
        <div ref={ref} {...handlers}
          className={`relative ${activeField ? 'cursor-crosshair' : ''}`}>
          {mimeType.startsWith('image/')
            ? <img src={fileUrl} alt="" className="w-full select-none pointer-events-none" />
            : <iframe src={fileUrl} className="w-full h-[70vh] pointer-events-none" title="doc" />}
          {active && box && (
            <div className="absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.w*100}%`, height: `${box.h*100}%` }} />
          )}
        </div>
        {activeField && <p className="p-2 text-xs text-sisyphus-600">Σύρε πλαίσιο πάνω στο «{FIELD_LABELS[activeField] ?? activeField}»…</p>}
      </div>

      {/* Field editors */}
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f} className={`flex items-end gap-2 p-2 rounded-md ${activeField===f ? 'ring-2 ring-sisyphus-500' : ''}`}>
            <Input label={FIELD_LABELS[f] ?? f} value={data[f] ?? ''}
              onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))} className="flex-1" />
            <Button size="sm" variant="subtle" type="button" disabled={busy}
              onClick={() => setActiveField((cur) => cur===f ? null : f)}>🎯</Button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button variant="primary" onClick={saveCorrections} isLoading={busy}>Αποθήκευση διορθώσεων</Button>
          <Button variant="secondary" onClick={saveTemplate} isLoading={busy}>Αποθήκευση ως πρότυπο</Button>
        </div>
        {saved && <p className="text-sm text-green-600">{saved}</p>}
      </div>
    </div>
  );
}
