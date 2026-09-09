'use client';
import * as React from 'react';
import type { TemplateDto } from '@/lib/templates/serialize';

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
};

export const DesignerContext = React.createContext<DesignerCtx | null>(null);
export function useDesigner(): DesignerCtx {
  const c = React.useContext(DesignerContext);
  if (!c) throw new Error('useDesigner outside DesignerContext');
  return c;
}
