// app/admin/ocr/[id]/field-correction.tsx
'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { FiChevronLeft, FiChevronRight, FiCrosshair, FiSave } from 'react-icons/fi';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { DOC_SECTION, emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import { useMarquee, type NormBox } from './use-marquee';

const FIELD_LABELS: Record<string, string> = {
  companyName: 'Επωνυμία Εκδότη', vatNumber: 'ΑΦΜ Εκδότη',
  documentTypeLabel: 'Τύπος παραστατικού',
  invoiceNumber: 'Αρ. Παραστατικού', date: 'Ημερομηνία',
  subtotal: 'Καθαρή Αξία', vatAmount: 'ΦΠΑ', otherCharges: 'Επιβαρύνσεις', totalAmount: 'Σύνολο',
  storeName: 'Κατάστημα',
  companyPhone: 'Τηλέφωνο Εκδότη', companyEmail: 'Email Εκδότη',
  companyPhone2: 'Τηλέφωνο 2 Εκδότη', companyFax: 'Fax Εκδότη', companyWebsite: 'Ιστοσελίδα Εκδότη',
  phone: 'Τηλέφωνο', email: 'Email',
};

/**
 * ΛΟΓΙΚΗ ΣΕΙΡΑ, ΟΧΙ ΣΕΙΡΑ ΠΙΝΑΚΑ. Τα πεδία έρχονταν σε μία επίπεδη λίστα όπου το ΑΦΜ του εκδότη
 * καθόταν δίπλα στο σύνολο του παραστατικού. Ο χρήστης διορθώνει κατά ΕΝΟΤΗΤΑ — ποιος εκδίδει,
 * τι παραστατικό, σε ποιον, πόσα — οπότε αυτή είναι και η σειρά που πρέπει να βλέπει.
 */
const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  // Η ΣΕΙΡΑ ΤΟΥ ΤΙΜΟΛΟΓΙΟΥ: τύπος και αριθμός παραστατικού πρώτα — αυτό κοιτά πρώτο ο λογιστής
  // και έτσι είναι τυπωμένο στο χαρτί. Ο εκδότης ακολουθεί, τα ποσά κλείνουν.
  { title: 'Παραστατικό',  keys: ['documentTypeLabel', 'invoiceNumber', 'date'] },
  { title: 'Εκδότης',      keys: ['companyName', 'vatNumber', 'storeName', 'companyPhone', 'companyEmail', 'companyPhone2', 'companyFax', 'companyWebsite', 'phone', 'email'] },
  { title: 'Ποσά',         keys: ['subtotal', 'vatAmount', 'otherCharges', 'totalAmount'] },
];

export function FieldCorrection({ docId, mimeType, fileUrl, initialData, fields }: {
  docId: string; mimeType: string; fileUrl: string;
  initialData: Record<string, any>; fields: string[];
}) {
  const [data, setData] = useState<Record<string, any>>(initialData ?? {});
  const [base, setBase] = useState<string>(() => JSON.stringify(initialData ?? {}));
  const dirty = JSON.stringify(data) !== base;
  const [activeField, setActiveField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const router = useRouter();
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
      // ΜΟΝΟ τα πεδία της κεφαλίδας. Πριν στέλνονταν και οι γραμμές (`items`), και ο server τις
      // ξαναέχτιζε από την αρχή σε ΚΑΘΕ αποθήκευση — σβήνοντας κέντρα κόστους, έργα, επιμερισμούς και
      // μονάδα αγοράς. Οι γραμμές διορθώνονται πλέον από την «Επεξεργασία γραμμών».
      const { items: _lines, ...header } = data as Record<string, unknown>;
      void _lines;
      const res = await fetch(`/api/admin/ocr/${docId}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extractedData: header }) });
      if (res.ok) {
        setBase(JSON.stringify(data));
        toast.success('Οι διορθώσεις αποθηκεύτηκαν.');
        // Έλεγχοι, εμπόδια και σύνολα της σελίδας ξαναϋπολογίζονται με τα νέα πεδία.
        emitDocLinesChanged(docId);
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(res.status === 403 ? 'Δεν έχεις δικαίωμα διόρθωσης πεδίων.' : d?.message ?? d?.error ?? 'Σφάλμα αποθήκευσης.');
      }
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
      {/* ΧΩΡΙΣ `overflow-hidden` ΕΔΩ. Το `overflow-hidden` σε πρόγονο ΑΚΥΡΩΝΕΙ το `sticky` του
          παιδιού: το κουμπί κλεισίματος μετρήθηκε να φεύγει στο y=-204 ενώ ήταν δηλωμένο sticky.
          Η στρογγυλή γωνία του PDF περνά τώρα σε δικό του wrapper, πιο κάτω. */}
      <div className={`relative rounded-lg shadow-fluent-8 bg-neutral-4 transition-opacity duration-200 ${showDoc ? '' : 'pointer-events-none max-lg:hidden lg:h-0 lg:overflow-hidden lg:opacity-0'}`}>
        <div className="sticky top-0 z-20 flex justify-end rounded-t-lg bg-neutral-4/95 p-1.5 backdrop-blur">
          <button type="button" onClick={toggleDoc}
            title="Κλείσιμο παραστατικού — περισσότερος χώρος για τη δουλειά"
            className="inline-flex items-center gap-1 rounded bg-card px-2 py-1 text-[length:var(--fs-11)] font-semibold text-foreground shadow-fluent-4 transition hover:bg-muted">
            <FiChevronLeft className="size-3.5" /> Κλείσιμο παραστατικού
          </button>
        </div>
        <div ref={ref} {...handlers}
          className={`relative overflow-hidden rounded-b-lg ${activeField ? 'cursor-crosshair' : ''}`}>
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
        {/* ΜΙΑ ΚΑΡΤΑ, ΟΧΙ ΤΡΕΙΣ. Μετρημένο πριν: κάθε ενότητα 173px για 3 πεδία, από τα οποία
            μόνο ~49px ήταν το ίδιο το πεδίο — το ~72% ήταν περίγραμμα, κεφαλίδα και padding.
            Η ετικέτα της ομάδας πάει ΑΡΙΣΤΕΡΑ, σε δική της στενή στήλη: γλιτώνει μια ολόκληρη
            σειρά κεφαλίδας ανά ομάδα και το μάτι σαρώνει κάθετα τις ενότητες. */}
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border border-l-4 border-l-sisyphus-500 bg-card shadow-fluent-2">
        {FIELD_GROUPS.map((g) => {
          const keys = g.keys.filter((k) => fields.includes(k));
          if (keys.length === 0) return null;
          return (
            <section key={g.title} className="grid gap-x-3 px-3 py-2 sm:grid-cols-[6.5rem_1fr]">
              <h3 className="pt-1 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground sm:pt-6">
                {g.title}
              </h3>
              {/* ΧΩΡΙΣ ΚΕΝΑ ΚΕΛΙΑ: flex-wrap όπου κάθε πεδίο ΜΕΓΑΛΩΝΕΙ για να γεμίσει τη σειρά του. Το
                  πλέγμα 2 στηλών άφηνε την «Ημερομηνία» και το «Σύνολο» μόνα τους με μισή σειρά κενή —
                  το ίδιο λάθος που διορθώθηκε στη λίστα. Τα πεδία που εμφανίζονται αλλάζουν ανά
                  παραστατικό, οπότε σταθερά πλάτη δεν θα έκλειναν ποτέ σωστά. */}
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {keys.map((f) => (
                  <div key={f} className={`flex min-w-[10rem] flex-1 basis-[11rem] items-end gap-1 rounded ${activeField === f ? 'ring-2 ring-sisyphus-500 ring-offset-2' : ''}`}>
                    {/* Ετικέτα ΠΑΝΩ από το πεδίο αλλά μικροσκοπική και κολλητά: μένει ορατή
                        (δεν γίνεται placeholder) χωρίς να κοστίζει δική της σειρά 14px. */}
                    <label className="flex min-w-0 flex-1 flex-col">
                      <span className={LABEL}>{FIELD_LABELS[f] ?? f}</span>
                      <input
                        value={data[f] ?? ''}
                        onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))}
                        className={INPUT}
                      />
                    </label>
                    <button
                      type="button" disabled={busy}
                      aria-label={`Μαρκάρισμα περιοχής για ${FIELD_LABELS[f] ?? f}`}
                      title={`Μαρκάρισμα περιοχής στο παραστατικό για «${FIELD_LABELS[f] ?? f}»`}
                      onClick={() => setActiveField((cur) => (cur === f ? null : f))}
                      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition ${activeField === f ? 'border-sisyphus-500 bg-sisyphus-500 text-white' : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    ><FiCrosshair className="size-3.5" aria-hidden /></button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {(() => {
          const known = new Set(FIELD_GROUPS.flatMap((g) => g.keys));
          const rest = fields.filter((f) => !known.has(f));
          if (rest.length === 0) return null;
          return (
            <section className="grid gap-x-3 px-3 py-2 sm:grid-cols-[6.5rem_1fr]">
              <h3 className="pt-1 text-[length:var(--fs-11)] font-bold uppercase tracking-wide text-foreground sm:pt-6">Λοιπά</h3>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                {rest.map((f) => (
                  <label key={f} className="flex min-w-[10rem] flex-1 basis-[11rem] flex-col gap-0.5">
                    <span className={LABEL}>{FIELD_LABELS[f] ?? f}</span>
                    <input value={data[f] ?? ''}
                      onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))}
                      className={INPUT} />
                  </label>
                ))}
              </div>
            </section>
          );
        })()}
        </div>

        {/* Συμπαγές μπλε όταν υπάρχει αλλαγή, ΟΥΔΕΤΕΡΟ όταν δεν υπάρχει — ποτέ ξεθωριασμένο χρώμα. */}
        <div className="flex justify-end pt-2">
          <button type="button" onClick={saveCorrections} disabled={busy || !dirty}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3.5 text-[length:var(--fs-12)] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none">
            <FiSave className="size-3.5" /> {busy ? 'Αποθήκευση…' : dirty ? 'Αποθήκευση διορθώσεων' : 'Χωρίς αλλαγές'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

/** Ίδιο μέγεθος ετικέτας και πεδίου με τη λίστα (`row-detail.tsx`): μία εμφάνιση φόρμας σε όλη την εφαρμογή. */
const LABEL = 'truncate text-[length:var(--fs-11)] font-semibold text-muted-foreground';
const INPUT =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-[length:var(--fs-12)] text-foreground ' +
  'transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25';
