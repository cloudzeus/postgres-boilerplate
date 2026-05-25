'use client';

import * as React from 'react';
import { FiKey, FiShield } from 'react-icons/fi';
import { toast } from 'sonner';
import { SortableList } from '@/components/ui/sortable-list';
import { Badge } from '@/components/ui/badge';

type PermItem = {
  id: string; key: string; resource: string; action: string;
  description: string; order: number; roleCount: number;
};

export function PermissionsList({ items }: { items: PermItem[] }) {
  const grouped = React.useMemo(() => {
    const m: Record<string, PermItem[]> = {};
    for (const p of items) (m[p.resource] ??= []).push(p);
    return m;
  }, [items]);

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([resource, perms]) => (
        <ResourceGroup key={resource} resource={resource} initial={perms} />
      ))}
    </div>
  );
}

function ResourceGroup({ resource, initial }: { resource: string; initial: PermItem[] }) {
  const [local, setLocal] = React.useState(initial);
  React.useEffect(() => setLocal(initial), [initial]);

  const handleReorder = async (next: PermItem[]) => {
    setLocal(next);
    const order = next.map((p, i) => ({ id: p.id, order: i }));
    const res = await fetch('/api/admin/permissions/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) { toast.error('Αποτυχία'); setLocal(initial); }
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{resource}</h3>
        <Badge variant="outline" className="text-[10px]">{local.length}</Badge>
      </div>
      <SortableList
        items={local}
        onReorder={handleReorder}
        renderItem={(p, handle) => (
          <div className="flex items-center gap-3 px-3 py-2 bg-card border border-border rounded-xl shadow-card hover:border-primary cx-transition">
            {handle}
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
              <FiKey className="h-3.5 w-3.5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-foreground text-[12px]">{p.action}</span>
                <code className="text-[10px] text-muted-foreground font-mono truncate">{p.key}</code>
              </div>
              {p.description && <div className="text-[11px] text-muted-foreground truncate">{p.description}</div>}
            </div>
            <Badge variant="outline" className="shrink-0"><FiShield /> {p.roleCount}</Badge>
          </div>
        )}
      />
    </section>
  );
}
