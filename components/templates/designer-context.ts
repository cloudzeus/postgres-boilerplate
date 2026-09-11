'use client';
import * as React from 'react';
import type { TemplateDto } from '@/lib/templates/serialize';
import type { SampleDto } from '@/lib/templates/samples';
import type { FlowScores } from '@/lib/templates/flow';

export type DesignerCtx = {
  dto: TemplateDto;
  setDto: (next: TemplateDto) => void;
  canManage: boolean;
  canPost: boolean;
  /** Field key currently highlighted (list ⇄ canvas ⇄ flow). */
  focusKey: string | null;
  setFocusKey: (k: string | null) => void;
  /** Ask the shell to switch step (used by flow-node clicks). */
  goToStep: (step: number) => void;
  /** True while the mounted step holds unsaved edits — the shell guards navigation on it. */
  dirty: boolean;
  setDirty: (v: boolean) => void;
  /**
   * Τα δείγματα εκπαίδευσης (spec §11), φορτωμένα ΜΙΑ φορά από το κέλυφος. `null` = δεν έχουν
   * φορτωθεί ακόμη — διαφορετικό από «δεν υπάρχουν».
   */
  samples: SampleDto[] | null;
  setSamples: (s: SampleDto[]) => void;
  /**
   * Ο βαθμός ανά πεδίο, ξαναμετρημένος στον browser από τα ίδια δείγματα με τον ίδιο κανόνα που
   * χρησιμοποιεί ο server — έτσι τα chips και το διάγραμμα κινούνται τη στιγμή της επιβεβαίωσης,
   * χωρίς να ξαναφορτωθεί το πρότυπο.
   */
  scores: FlowScores;
};

export const DesignerContext = React.createContext<DesignerCtx | null>(null);
export function useDesigner(): DesignerCtx {
  const c = React.useContext(DesignerContext);
  if (!c) throw new Error('useDesigner outside DesignerContext');
  return c;
}
