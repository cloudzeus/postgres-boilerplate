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
