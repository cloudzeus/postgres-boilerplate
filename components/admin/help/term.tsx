'use client';

import * as React from 'react';
import { FiHelpCircle } from 'react-icons/fi';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GLOSSARY, type GlossaryKey } from '@/lib/ocr/glossary';

/**
 * Λογιστικός όρος με εξήγηση: διακεκομμένη υπογράμμιση + «;» — με κλικ (όχι μόνο hover, ώστε να
 * δουλεύει και σε αφή και σε πληκτρολόγιο) ανοίγει τι σημαίνει, ένα παράδειγμα, και τι σημαίνει για
 * τον χρήστη. Ο ίδιος ο όρος γράφεται όπως θέλει ο καλών (`children`), αλλιώς ο όρος του λεξικού.
 */
export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const g = GLOSSARY[k];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-help items-baseline gap-0.5 rounded-sm border-b border-dotted border-current font-medium text-sisyphus-700 outline-none hover:text-sisyphus-800 focus-visible:ring-2 focus-visible:ring-sisyphus-500/40 dark:text-sisyphus-300"
          aria-label={`Τι σημαίνει «${g.term}»;`}
        >
          {children ?? g.term}
          <FiHelpCircle aria-hidden className="size-3 self-center opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-1.5 text-[length:var(--fs-12)]">
        <p className="text-[length:var(--fs-13)] font-semibold text-foreground">{g.term}</p>
        <p className="text-foreground/90">{g.what}</p>
        <p className="text-muted-foreground"><span className="font-medium text-foreground">Παράδειγμα:</span> {g.example}</p>
        {g.forYou && <p className="rounded-md bg-sisyphus-500/[0.07] px-2 py-1.5 text-foreground">{g.forYou}</p>}
      </PopoverContent>
    </Popover>
  );
}
