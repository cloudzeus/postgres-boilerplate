'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader><DialogTitle>Επιλογή Δήμου / Περιοχής</DialogTitle></DialogHeader>
        {roots == null ? (
          <div className="text-sm text-muted-foreground p-4 text-center">Φόρτωση…</div>
        ) : (
          <RegionTree
            initialRoots={roots}
            onPick={(n) => { onSelect(n.code, n.nameEL); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
