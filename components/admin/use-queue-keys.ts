'use client';

import * as React from 'react';

export interface UseQueueKeysArgs {
  /** Ids of the visible queue rows, in the order they are rendered. */
  ids: string[];
  /** Currently selected row id, or `null` when nothing is selected. */
  selectedId: string | null;
  /** Called with the id that should become selected. */
  onSelect: (id: string) => void;
  /** Enter — primary action for the selected row (e.g. «Δημιουργία»). */
  onPrimary?: (id: string) => void;
  /** Escape — clear the selection / search. */
  onEscape?: () => void;
  /** Detach the listener (e.g. while a dialog owns the keyboard). Default `true`. */
  enabled?: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Στοιχεία που έχουν δική τους σημασία για το Enter (ενεργοποίηση κουμπιού,
 * άνοιγμα `details`, επιλογή option…). Η ουρά δεν κλέβει το πλήκτρο από αυτά.
 */
const INTERACTIVE_SELECTOR =
  'button, a[href], summary, select, [role="button"], [role="tab"], [role="option"], [contenteditable]';

/**
 * True when the key press belongs to a text-entry surface, in which case the
 * queue must not steal it (typing «j» in the search box means the letter j).
 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (TYPING_TAGS.has(el.tagName)) return true;
  return el.isContentEditable === true;
}

/**
 * True όταν η εστίαση είναι σε (ή μέσα σε) στοιχείο που χειρίζεται μόνο του το
 * Enter — τότε το Enter είναι δικό του, όχι της ουράς.
 */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest(INTERACTIVE_SELECTOR) != null;
}

/**
 * Keyboard navigation for a master–detail queue:
 * `j` / `ArrowDown` next · `k` / `ArrowUp` previous · `Enter` primary action ·
 * `Escape` clear. Ignored while focus is in an input/textarea/select/
 * contenteditable, and while a modifier key is held; `Enter` is additionally
 * left alone on buttons/links/summary/options. Navigation clamps at the
 * ends (no wrap-around); with nothing selected, next picks the first row and
 * previous the last.
 */
export function useQueueKeys({
  ids,
  selectedId,
  onSelect,
  onPrimary,
  onEscape,
  enabled = true,
}: UseQueueKeysArgs): void {
  // Latest values live in a ref so the window listener is attached only once.
  const latest = React.useRef({ ids, selectedId, onSelect, onPrimary, onEscape });
  latest.current = { ids, selectedId, onSelect, onPrimary, onEscape };

  React.useEffect(() => {
    if (!enabled) return;

    function handle(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const { ids, selectedId, onSelect, onPrimary, onEscape } = latest.current;
      const key = e.key;
      // `code` keeps j/k working on a Greek keyboard layout (ξ/κ report KeyJ/KeyK).
      const code = e.code;

      const isNext = key === 'ArrowDown' || key === 'j' || key === 'J' || code === 'KeyJ';
      const isPrev = key === 'ArrowUp' || key === 'k' || key === 'K' || code === 'KeyK';

      if (isNext || isPrev) {
        if (ids.length === 0) return;
        e.preventDefault();
        const at = selectedId ? ids.indexOf(selectedId) : -1;
        let next: string;
        if (at < 0) {
          next = isNext ? ids[0] : ids[ids.length - 1];
        } else {
          next = ids[Math.min(ids.length - 1, Math.max(0, at + (isNext ? 1 : -1)))];
        }
        if (next !== selectedId) onSelect(next);
        return;
      }

      if (key === 'Enter') {
        if (!selectedId || !onPrimary) return;
        // Κουμπί/σύνδεσμος/summary/option έχουν δική τους ενέργεια στο Enter.
        if (isInteractive(e.target)) return;
        e.preventDefault();
        onPrimary(selectedId);
        return;
      }

      if (key === 'Escape') {
        if (!onEscape) return;
        e.preventDefault();
        onEscape();
      }
    }

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [enabled]);
}
