'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FiMap, FiMapPin } from 'react-icons/fi';
import { FormSection } from '@/components/admin/form-kit';
import { RegionTree, type RegionTreeNodeData } from '@/components/regions/region-tree';

export function RegionPicker({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (code: string, nameEL: string) => void;
}) {
  const [roots, setRoots] = React.useState<RegionTreeNodeData[] | null>(null);

  React.useEffect(() => {
    if (open && !roots) {
      fetch('/api/regions/children').then((r) => r.json()).then((d) => setRoots(d.nodes ?? []));
    }
  }, [open, roots]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiMapPin className="size-4" /></span>
          <DialogTitle className="min-w-0 flex-1 truncate text-[length:var(--fs-15)]">Επιλογή Δήμου / Περιοχής</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto bg-muted/20 px-4 py-3">
          <FormSection tone="blue" icon={<FiMap />} title="Διοικητική διαίρεση">
            {roots == null ? (
              <div role="status" className="p-4 text-center text-[length:var(--fs-13)] text-muted-foreground">Φόρτωση…</div>
            ) : (
              <RegionTree
                initialRoots={roots}
                onPick={(n) => { onSelect(n.code, n.nameEL); onOpenChange(false); }}
              />
            )}
          </FormSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
