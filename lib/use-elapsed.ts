'use client';

import * as React from 'react';

/**
 * Δευτερόλεπτα από τη στιγμή που το `active` έγινε `true` (0 όσο είναι `false`).
 *
 * Για αναμονές που εξαρτώνται από τη SoftOne: ένα σκέτο «Καταχώριση…» που μένει ακίνητο για 20″
 * μοιάζει με κόλλημα· ένας μετρητής δείχνει ότι η εφαρμογή περιμένει απάντηση, και πόση.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

/** « 12″» μετά τα πρώτα 3″ — οι γρήγορες απαντήσεις δεν χρειάζονται μετρητή. */
export const elapsedSuffix = (seconds: number): string => (seconds >= 3 ? ` ${seconds}″` : '');

/** «σε 4,2″» από χιλιοστά (για το μήνυμα επιτυχίας). */
export const durationText = (ms: unknown): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? ` σε ${(ms / 1000).toLocaleString('el-GR', { maximumFractionDigits: 1 })}″` : '';
