'use client';

import * as React from 'react';

/**
 * Ένα σήμα «οι γραμμές αυτού του παραστατικού άλλαξαν», για τις κάρτες της σελίδας
 * `/admin/ocr/<id>` που φορτώνουν μόνες τους (έλεγχοι SoftOne, προεπισκόπηση καταχώρισης).
 *
 * Γιατί event και όχι state: οι κάρτες είναι ΑΔΕΛΦΙΑ σε server component, φορτώνουν με δικό
 * τους `fetch` στο mount, και το `router.refresh()` δεν τις ξαναρωτά. Χωρίς αυτό ο χρήστης
 * διόρθωνε τις γραμμές και το «Υπάρχουν γραμμές χωρίς αντιστοίχιση» έμενε εκεί μέχρι να
 * κάνει reload — δηλαδή η σελίδα του έλεγε γιατί δεν μπορεί να καταχωρίσει και μετά του
 * έκρυβε ότι το έλυσε.
 */
const EVENT = 'ocr:doc-lines-changed';

/** Κάλεσέ το μετά από κάθε επιτυχημένη αλλαγή γραμμής (αντιστοίχιση, καθαρισμός, αναλυτική). */
export function emitDocLinesChanged(docId: string): void {
  if (typeof window === 'undefined' || !docId) return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { docId } }));
}

/** Ξαναφόρτωσε όταν αλλάξουν οι γραμμές ΑΥΤΟΥ του παραστατικού. */
export function useDocLinesChanged(docId: string, onChange: () => void): void {
  const ref = React.useRef(onChange);
  ref.current = onChange;
  React.useEffect(() => {
    if (!docId) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ docId?: string }>).detail?.docId === docId) ref.current();
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [docId]);
}

/**
 * «Πήγαινε και άνοιξε ΑΥΤΗ τη γραμμή» — το σήμα που στέλνει η λωρίδα ελέγχων στον πίνακα γραμμών.
 *
 * Γιατί υπάρχει: η λωρίδα είχε **δικό της** δημιουργό εγγραφών, με άλλους κανόνες από τον picker
 * του πίνακα — δύο δρόμοι για την ίδια δουλειά, και ο ένας από τους δύο έφτιαχνε κάτι που το
 * παραστατικό δεν μπορούσε να χρησιμοποιήσει. Ο δρόμος της λωρίδας καταργήθηκε· το «Λύσε»
 * **παραπέμπει** τώρα στη γραμμή, όπου ζει ο ΕΝΑΣ picker.
 */
const FOCUS = 'ocr:focus-line';

/**
 * Στέλνει το σήμα και λέει αν το ΑΚΟΥΣΕ κάποιος. Στην καρτέλα της λίστας δεν υπάρχει πίνακας
 * γραμμών να ακούσει — εκεί ο καλών πρέπει να ανοίξει τη σελίδα του παραστατικού (`focusLineHref`),
 * αλλιώς το κουμπί «δεν κάνει τίποτα».
 */
export function emitFocusLine(lineId: string): boolean {
  if (typeof window === 'undefined' || !lineId) return false;
  const detail = { lineId, handled: false };
  window.dispatchEvent(new CustomEvent(FOCUS, { detail }));
  return detail.handled;
}

/** Η σελίδα του παραστατικού με ανοιχτό τον picker αυτής της γραμμής. */
export const focusLineHref = (docId: string, lineId: string) => `/admin/ocr/${docId}?line=${encodeURIComponent(lineId)}`;

/** Άνοιξε τον picker αυτής της γραμμής όταν ζητηθεί από αλλού μέσα στη σελίδα. */
export function useFocusLine(lineId: string, onFocus: () => void): void {
  const ref = React.useRef(onFocus);
  ref.current = onFocus;
  React.useEffect(() => {
    if (!lineId) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ lineId?: string; handled?: boolean }>).detail;
      if (d?.lineId === lineId) { d.handled = true; ref.current(); }
    };
    window.addEventListener(FOCUS, handler);
    // Ήρθαμε από τη λίστα με `?line=<id>`: ανοίγουμε αμέσως τη γραμμή που ζητήθηκε.
    if (new URLSearchParams(window.location.search).get('line') === lineId) {
      const t = setTimeout(() => ref.current(), 300);
      return () => { clearTimeout(t); window.removeEventListener(FOCUS, handler); };
    }
    return () => window.removeEventListener(FOCUS, handler);
  }, [lineId]);
}

/**
 * «Μοίρασε ΑΥΤΗ τη γραμμή» — από τον οδηγό αντιστοίχισης («Αφορά πολλά μαζί») προς τον επιμερισμό
 * της ίδιας γραμμής, που ζει σε άλλη σειρά του πίνακα.
 */
const START_SPLIT = 'ocr:start-split';

export function emitStartSplit(lineId: string): void {
  if (typeof window === 'undefined' || !lineId) return;
  window.dispatchEvent(new CustomEvent(START_SPLIT, { detail: { lineId } }));
}

export function useStartSplit(lineId: string, onStart: () => void): void {
  const ref = React.useRef(onStart);
  ref.current = onStart;
  React.useEffect(() => {
    if (!lineId) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ lineId?: string }>).detail?.lineId === lineId) ref.current();
    };
    window.addEventListener(START_SPLIT, handler);
    return () => window.removeEventListener(START_SPLIT, handler);
  }, [lineId]);
}
