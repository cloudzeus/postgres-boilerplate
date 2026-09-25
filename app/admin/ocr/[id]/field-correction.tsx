// app/admin/ocr/[id]/field-correction.tsx
'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { Button } from '@/lib/design-system';
import { useMarquee, type NormBox } from './use-marquee';

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Επωνυμία Εκδότη', vatNumber: 'ΑΦΜ Εκδότη',
  documentTypeLabel: 'Τύπος παραστατικού',
  invoiceNumber: 'Αρ. Παραστατικού', date: 'Ημερομηνία',
  subtotal: 'Καθαρή Αξία', vatAmount: 'ΦΠΑ', totalAmount: 'Σύνολο',
  storeName: 'Κατάστημα',
  companyPhone: 'Τηλέφωνο Εκδότη', companyEmail: 'Email Εκδότη',
  phone: 'Τηλέφωνο', email: 'Email',
};

/**
 * ΛΟΓΙΚΗ ΣΕΙΡΑ, ΟΧΙ ΣΕΙΡΑ ΠΙΝΑΚΑ. Τα πεδία έρχονταν σε μία επίπεδη λίστα όπου το ΑΦΜ του εκδότη
 * καθόταν δίπλα στο σύνολο του παραστατικού. Ο χρήστης διορθώνει κατά ΕΝΟΤΗΤΑ — ποιος εκδίδει,
 * τι παραστατικό, σε ποιον, πόσα — οπότε αυτή είναι και η σειρά που πρέπει να βλέπει.
 */
const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Εκδότης',      keys: ['companyName', 'vatNumber', 'storeName', 'companyPhone', 'companyEmail', 'phone', 'email'] },
  { title: 'Παραστατικό',  keys: ['documentTypeLabel', 'invoiceNumber', 'date'] },
  { title: 'Ποσά',         keys: ['subtotal', 'vatAmount', 'totalAmount'] },
];

export function FieldCorrection({ docId, mimeType, fileUrl, initialData, fields }: {
  docId: string; mimeType: string; fileUrl: string;
  initialData: Record<string, any>; fields: string[];
}) {
  const [data, setData] = useState<Record<string, any>>(initialData ?? {});
  const [activeField, setActiveField] = useState<string | null>(null);
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
      if (res.ok && json.value) setData((d) => ({ ...d, [activeField]: json.value }));
    } finally { setBusy(false); setActiveField(null); }
  }, [activeField, docId]);

  const { ref, box, active, handlers } = useMarquee(onComplete);

  /**
   * ΤΟ ΠΑΡΑΣΤΑΤΙΚΟ ΚΛΕΙΝΕΙ — ίδια συμπεριφορά με το ανοιγμένο πλαίσιο της λίστας, ΙΔΙΟ κλειδί
   * μνήμης: ο χρήστης το κλείνει μία φορά και μένει κλειστό όπου κι αν δουλεύει.
   */
  const [showDoc, setShowDoc] = useState(true);
  useEffect(() => {
    try { setShowDoc(localStorage.getItem('admin.ocr.rowdetail.pdf') !== '0'); } catch { /* ιδιωτική περιήγηση */ }
  }, []);
  const toggleDoc = useCallback(() => {
    setShowDoc((v) => {
      const next = !v;
      try { localStorage.setItem('admin.ocr.rowdetail.pdf', next ? '1' : '0'); } catch { /* αδιάφορο */ }
      return next;
    });
  }, []);

  async function saveCorrections() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: data, items: Array.isArray(data.items) ? data.items : undefined }) });
      setSaved(res.ok ? 'Οι διορθώσεις αποθηκεύτηκαν.' : 'Σφάλμα αποθήκευσης.');
    } finally { setBusy(false); }
  }

  return (
    <>
      {!showDoc && (
        <button type="button" onClick={toggleDoc}
          className="mb-2 inline-flex items-center gap-1.5 rounded bg-sisyphus-500 px-3 py-1.5 text-[length:var(--fs-12)] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600">
          <FiChevronRight className="size-3.5" /> Εμφάνιση παραστατικού
        </button>
      )}
    <div
      style={{ '--doc-col': showDoc ? '1fr' : '0px' } as React.CSSProperties}
      className="grid grid-cols-1 gap-4 lg:grid-cols-[var(--doc-col)_1fr] lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out"
    >
      {/* Document with marquee overlay */}
      <div className={`relative rounded-lg overflow-hidden shadow-fluent-8 bg-neutral-4 transition-opacity duration-200 ${showDoc ? '' : 'pointer-events-none max-lg:hidden lg:h-0 lg:overflow-hidden lg:opacity-0'}`}>
        <button type="button" onClick={toggleDoc}
          title="Κλείσιμο παραστατικού — περισσότερος χώρος για τη δουλειά"
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded bg-card/90 px-2 py-1 text-[length:var(--fs-11)] font-semibold text-foreground shadow-fluent-2 backdrop-blur transition hover:bg-card">
          <FiChevronLeft className="size-3.5" /> Κλείσιμο
        </button>
        <div ref={ref} {...handlers}
          className={`relative ${activeField ? 'cursor-crosshair' : ''}`}>
          {mimeType.startsWith('image/')
            ? <img src={fileUrl} alt="" className="w-full select-none pointer-events-none" />
            /* Το PDF είναι ΑΔΡΑΝΕΣ ΜΟΝΟ όσο σχεδιάζεις πλαίσιο σε πεδίο.
               Πριν, το `pointer-events-none` ήταν ΜΟΝΙΜΟ ώστε το σύρσιμο να φτάνει στο wrapper —
               με αποτέλεσμα ένα PDF που δεν κυλάει, δεν κάνει ζουμ και δεν δίνει πρόσβαση στη
               δεύτερη σελίδα του: «παγωμένο». Ο marquee χρειάζεται τα γεγονότα ΜΟΝΟ όταν υπάρχει
               ενεργό πεδίο — τον υπόλοιπο χρόνο το παραστατικό πρέπει να διαβάζεται κανονικά. */
            : <iframe
                src={fileUrl} title="doc"
                className={`w-full h-[70vh] ${activeField ? 'pointer-events-none' : ''}`}
              />}
          {active && box && (
            <div className="absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x*100}%`, top: `${box.y*100}%`, width: `${box.w*100}%`, height: `${box.h*100}%` }} />
          )}
        </div>
        {activeField && <p className="p-2 text-xs text-sisyphus-600">Σύρε πλαίσιο πάνω στο «{FIELD_LABELS[activeField] ?? activeField}»…</p>}
      </div>

      {/* Field editors */}
      <div>
        {FIELD_GROUPS.map((g) => {
          const keys = g.keys.filter((k) => fields.includes(k));
          if (keys.length === 0) return null;
          return (
        <section key={g.title} className="mb-2.5 rounded-lg border border-border bg-card p-2.5 shadow-fluent-2">
        <h3 className="mb-1.5 border-b border-border/60 pb-1 text-[length:var(--fs-12)] font-extrabold uppercase tracking-wider text-sisyphus-800 dark:text-sisyphus-200">{g.title}</h3>
        <div className={`grid gap-2 ${showDoc ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'}`}>
        {keys.map((f) => (
          <div key={f} className={`flex items-end gap-1.5 rounded p-1 ${activeField===f ? 'ring-2 ring-sisyphus-500' : ''}`}>
            <label className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[length:var(--fs-10)] font-semibold uppercase tracking-wide text-muted-foreground">{FIELD_LABELS[f] ?? f}</span>
              <input value={data[f] ?? ''}
                onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))}
                className="h-8 w-full rounded border border-border bg-neutral-4 px-2 text-[length:var(--fs-12)] focus:border-sisyphus-500 focus:bg-card focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25" />
            </label>
            <Button size="sm" variant="subtle" type="button" disabled={busy}
              aria-label={`Μαρκάρισμα περιοχής για ${FIELD_LABELS[f] ?? f}`}
              title={`Μαρκάρισμα περιοχής για ${FIELD_LABELS[f] ?? f}`}
              onClick={() => setActiveField((cur) => cur===f ? null : f)}>🎯</Button>
          </div>
        ))}
        </div>
        </section>
          );
        })}
        {/* Ό,τι δεν ανήκει σε ενότητα δεν εξαφανίζεται — μπαίνει στο τέλος. */}
        {(() => {
          const known = new Set(FIELD_GROUPS.flatMap((g) => g.keys));
          const rest = fields.filter((f) => !known.has(f));
          if (rest.length === 0) return null;
          return (
            <section className="mb-2.5 rounded-lg border border-border bg-card p-2.5 shadow-fluent-2">
              <h3 className="mb-1.5 border-b border-border/60 pb-1 text-[length:var(--fs-12)] font-extrabold uppercase tracking-wider text-foreground">Λοιπά</h3>
              <div className={`grid gap-2 ${showDoc ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'}`}>
                {rest.map((f) => (
                  <label key={f} className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[length:var(--fs-10)] font-semibold uppercase tracking-wide text-muted-foreground">{FIELD_LABELS[f] ?? f}</span>
                    <input value={data[f] ?? ''}
                      onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))}
                      className="h-8 w-full rounded border border-border bg-neutral-4 px-2 text-[length:var(--fs-12)] focus:border-sisyphus-500 focus:bg-card focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25" />
                  </label>
                ))}
              </div>
            </section>
          );
        })()}
        <div className="flex gap-2 pt-1">
          <Button variant="primary" onClick={saveCorrections} isLoading={busy}>Αποθήκευση διορθώσεων</Button>
        </div>
        {saved && <p className="text-sm text-green-600">{saved}</p>}
      </div>
    </div>
    </>
  );
}
