'use client';

import * as React from 'react';

/**
 * Πλάτος του περιέκτη ενός γραφήματος, σε CSS pixels.
 *
 * Τα SVG γραφήματα εδώ γράφονται σε ένα `viewBox` και τεντώνονται στο 100 %.
 * Αν το `viewBox` είναι σταθερό (π.χ. 920) ενώ ο περιέκτης στο κινητό είναι ~300 px,
 * ΟΛΟ το γράφημα συρρικνώνεται — και οι ετικέτες των αξόνων (9 px) καταλήγουν στα
 * ~3 px, δηλαδή αδιάβαστες. Ταιριάζοντας το `viewBox` με το μετρημένο πλάτος,
 * μία μονάδα SVG = ένα pixel οθόνης και τα γράμματα βγαίνουν πάντα στο μέγεθός τους.
 *
 * Επιστρέφει το `fallback` στο SSR και μέχρι την πρώτη μέτρηση.
 */
// `useLayoutEffect` προειδοποιεί στο SSR· στον server δεν τρέχει τίποτα ούτως ή άλλως.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export function useChartWidth(ref: React.RefObject<HTMLElement | null>, fallback = 920): number {
  const [width, setWidth] = React.useState(fallback);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const apply = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
