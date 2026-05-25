'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiShield, FiUsers, FiKey, FiLock, FiSettings, FiTrash2, FiCheck } from 'react-icons/fi';
import { toast } from 'sonner';
import { SortableList } from '@/components/ui/sortable-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';

type RoleItem = {
  id: string; name: string; description: string; isSystem: boolean; order: number;
  userCount: number; permissionCount: number; permissionIds: string[];
};
type Permission = { id: string; key: string; resource: string; action: string; description: string | null };

export function RolesList({ items, permissions }: { items: RoleItem[]; permissions: Permission[] }) {
  const router = useRouter();
  const [local, setLocal] = React.useState(items);
  const [openRole, setOpenRole] = React.useState<RoleItem | null>(null);

  React.useEffect(() => setLocal(items), [items]);

  const handleReorder = async (next: RoleItem[]) => {
    setLocal(next);
    const order = next.map((r, i) => ({ id: r.id, order: i }));
    const res = await fetch('/api/admin/roles/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) { toast.error('Αποτυχία αναδιάταξης'); setLocal(items); }
    else toast.success('Η σειρά αποθηκεύτηκε');
  };

  const byResource = React.useMemo(() => {
    const m: Record<string, Permission[]> = {};
    for (const p of permissions) (m[p.resource] ??= []).push(p);
    return m;
  }, [permissions]);

  return (
    <>
      <SortableList
        items={local}
        onReorder={handleReorder}
        renderItem={(role, handle) => (
          <div className="flex items-center gap-3 px-3 py-2.5 bg-card border border-border rounded-xl shadow-card hover:border-primary cx-transition">
            {handle}
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--cx-accent-soft)] text-primary shrink-0">
              <FiShield className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground truncate text-[13px]">{role.name}</span>
                {role.isSystem && <Badge variant="outline"><FiLock /> System</Badge>}
              </div>
              {role.description && <div className="text-[12px] text-muted-foreground truncate">{role.description}</div>}
            </div>
            <div className="hidden sm:flex items-center gap-3 text-[12px] text-muted-foreground shrink-0">
              <span className="inline-flex items-center gap-1"><FiUsers className="h-3.5 w-3.5" /> {role.userCount}</span>
              <span className="inline-flex items-center gap-1"><FiKey className="h-3.5 w-3.5" /> {role.permissionCount}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpenRole(role)} className="shrink-0">
              <FiSettings /> Δικαιώματα
            </Button>
            {!role.isSystem && (
              <Button
                variant="ghost" size="icon-sm" className="shrink-0"
                onClick={async () => {
                  if (!confirm(`Διαγραφή ρόλου ${role.name};`)) return;
                  const res = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
                  if (res.ok) { toast.success('Διαγράφηκε'); router.refresh(); }
                  else toast.error('Αποτυχία');
                }}
              >
                <FiTrash2 />
              </Button>
            )}
          </div>
        )}
      />

      <Dialog open={!!openRole} onOpenChange={(o) => !o && setOpenRole(null)}>
        <DialogContent className="!max-w-3xl w-[90vw] sm:!max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FiShield className="text-primary" /> {openRole?.name}
            </DialogTitle>
            <DialogDescription>Επίλεξε τα δικαιώματα που έχει αυτός ο ρόλος.</DialogDescription>
          </DialogHeader>

          {openRole && (
            <RolePermissionsEditor
              role={openRole}
              byResource={byResource}
              onSaved={() => { setOpenRole(null); router.refresh(); }}
              onCancel={() => setOpenRole(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RolePermissionsEditor({
  role, byResource, onSaved, onCancel,
}: {
  role: RoleItem;
  byResource: Record<string, Permission[]>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(role.permissionIds));
  const [saving, setSaving] = React.useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/admin/roles/${role.id}/permissions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionIds: Array.from(selected) }),
    });
    setSaving(false);
    if (res.ok) { toast.success('Αποθηκεύτηκε'); onSaved(); }
    else toast.error('Αποτυχία αποθήκευσης');
  };

  const totalByResource = (perms: Permission[]) => perms.length;
  const selectedByResource = (perms: Permission[]) =>
    perms.filter((p) => selected.has(p.id)).length;

  const toggleAllInResource = (perms: Permission[], on: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      for (const p of perms) on ? next.add(p.id) : next.delete(p.id);
      return next;
    });
  };

  return (
    <>
      <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
        <Accordion type="multiple" className="w-full">
          {Object.entries(byResource).map(([resource, perms]) => {
            const total = totalByResource(perms);
            const sel = selectedByResource(perms);
            const allOn = sel === total;
            const someOn = sel > 0 && sel < total;
            return (
              <AccordionItem key={resource} value={resource} className="border-b border-border last:border-b-0">
                <div className="flex items-center gap-2 px-2 py-1">
                  <span
                    role="checkbox"
                    aria-checked={allOn ? 'true' : someOn ? 'mixed' : 'false'}
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); toggleAllInResource(perms, !allOn); }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault(); e.stopPropagation();
                        toggleAllInResource(perms, !allOn);
                      }
                    }}
                    className={`inline-flex size-4 shrink-0 items-center justify-center rounded-sm border cursor-pointer transition-colors ${
                      allOn || someOn
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-card border-input hover:border-primary'
                    }`}
                  >
                    {allOn ? <FiCheck className="h-3 w-3" /> : someOn ? <span className="block h-0.5 w-2 bg-current" /> : null}
                  </span>
                  <AccordionTrigger className="hover:no-underline py-2 flex-1 group min-w-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{resource}</span>
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums ml-auto mr-2">
                        {sel}/{total}
                      </span>
                    </div>
                  </AccordionTrigger>
                </div>
                <AccordionContent className="pb-2">
                  <div className="space-y-0.5 pl-6">
                    {perms.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/60 cursor-pointer"
                      >
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggle(p.id)}
                          className="size-3.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-foreground leading-tight">{p.action}</div>
                          {p.description && (
                            <div className="text-[10px] text-muted-foreground leading-tight">{p.description}</div>
                          )}
                        </div>
                        <code className="text-[10px] text-muted-foreground/70 font-mono">{p.key}</code>
                      </label>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Άκυρο</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση...' : 'Αποθήκευση'}</Button>
      </DialogFooter>
    </>
  );
}
