'use client';

// components/templates/regions-toolbar.tsx — the two header rows of the regions step: the canvas
// one (test / result, marking hint, page nav) and the field-list one (count, «Πεδίο», «Από περιοχή»,
// scan, «Αποθήκευση»). Presentational only: every decision belongs to the step.
import * as React from 'react';
import { FiEye, FiFileText, FiPlay, FiPlus, FiSave, FiTarget } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ACCENT, COLOR_CAP_MSG } from './use-detection';

export type CanvasToolbarProps = {
  canManage: boolean;
  /** A finished run is on hand — reopen it instead of paying for the same read again. */
  hasResult: boolean;
  testing: boolean;
  canTest: boolean;
  detecting: boolean;
  /** Hint shown while a box is being drawn, or null when nothing is being marked. */
  markingText: string | null;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  onOpenResult: () => void;
  onRunTest: () => void;
};

export function CanvasToolbar({ canManage, hasResult, testing, canTest, detecting, markingText, page, pageCount, onPage, onOpenResult, onRunTest }: CanvasToolbarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[length:var(--fs-12)]">
      <span className="font-semibold">Περιοχές</span>
      {canManage && (hasResult
        ? <>
            <Button size="sm" variant="secondary" onClick={onOpenResult} title="Άνοιξε ξανά το αποτέλεσμα της τελευταίας δοκιμής"><FiFileText className="mr-1 size-3.5" /> Αποτέλεσμα</Button>
            <Button size="sm" variant="ghost" onClick={onRunTest} disabled={!canTest} title="Τρέξε ξανά τη δοκιμή">Ξανά</Button>
          </>
        : <Button size="sm" variant="secondary" onClick={onRunTest} disabled={testing || !canTest} title="Διαβάζει όλα τα αποθηκευμένα πεδία από το δείγμα"><FiPlay className="mr-1 size-3.5" /> Δοκιμή προτύπου</Button>)}
      {markingText && <span role="status" className="rounded-full px-2 py-0.5 text-[length:var(--fs-11)] font-medium" style={{ backgroundColor: ACCENT.bg, color: ACCENT.fg }}>{markingText}</span>}
      <span className="ml-auto text-muted-foreground">Σελίδα {page + 1} / {pageCount}</span>
      <Button variant="ghost" size="sm" aria-label="Προηγούμενη σελίδα" disabled={page === 0 || detecting} onClick={() => onPage(page - 1)}>‹</Button>
      <Button variant="ghost" size="sm" aria-label="Επόμενη σελίδα" disabled={page >= pageCount - 1 || detecting} onClick={() => onPage(page + 1)}>›</Button>
    </div>
  );
}

export type RegionsToolbarProps = {
  count: number;
  canManage: boolean;
  detecting: boolean;
  busy: boolean;
  dirty: boolean;
  atColorCap: boolean;
  canAdd: boolean;
  scanMode: 'marks' | 'all';
  onScanMode: (m: 'marks' | 'all') => void;
  onAdd: () => void;
  onMarkNew: () => void;
  onScan: () => void;
  onSave: () => void;
};

export function RegionsToolbar({ count, canManage, detecting, busy, dirty, atColorCap, canAdd, scanMode, onScanMode, onAdd, onMarkNew, onScan, onSave }: RegionsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[length:var(--fs-12)] font-semibold">Πεδία <span className="ml-1 rounded-full bg-sisyphus-50 px-1.5 text-[length:var(--fs-10)] text-sisyphus-700">{count}</span></span>
      {canManage && <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" onClick={onAdd} disabled={!canAdd || atColorCap || detecting} title={atColorCap ? COLOR_CAP_MSG : undefined}><FiPlus className="mr-1 size-3.5" /> Πεδίο</Button>
        <Button size="sm" variant="secondary" onClick={onMarkNew} disabled={atColorCap || detecting} title="Σύρε πλαίσιο — το μοντέλο ονομάζει το πεδίο"><FiTarget className="mr-1 size-3.5" /> Από περιοχή</Button>
        <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-input">
          <select aria-label="Τρόπος σάρωσης" value={scanMode} onChange={(e) => onScanMode(e.target.value as 'marks' | 'all')} disabled={detecting} className="h-8 cursor-pointer border-r border-input bg-background px-1.5 text-[length:var(--fs-11)] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="all">Όλα τα πεδία</option>
            <option value="marks">Μόνο σημειωμένα</option>
          </select>
          <button type="button" onClick={onScan} disabled={detecting || atColorCap} aria-busy={detecting} className="inline-flex h-8 cursor-pointer items-center gap-1 px-2 text-[length:var(--fs-12)] hover:bg-[var(--cx-hover)] disabled:cursor-not-allowed disabled:opacity-50">
            <FiEye className={cn('size-3.5', detecting && 'animate-pulse')} /> Αυτόματη σάρωση
          </button>
        </div>
        <Button size="sm" onClick={onSave} disabled={!dirty || busy || detecting}><FiSave className="mr-1 size-3.5" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
      </div>}
    </div>
  );
}
