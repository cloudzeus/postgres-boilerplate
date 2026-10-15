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
import { FormSection } from '@/components/admin/form-kit';
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
                <span className="font-semibold text-foreground truncate text-[length:var(--fs-13)]">{role.name}</span>
                {role.isSystem && <Badge variant="outline"><FiLock /> System</Badge>}
              </div>
              {role.description && <div className="text-[length:var(--fs-12)] text-muted-foreground truncate">{role.description}</div>}
            </div>
            <div className="hidden sm:flex items-center gap-3 text-[length:var(--fs-12)] text-muted-foreground shrink-0">
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
        <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15"><FiShield className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[length:var(--fs-15)]">{openRole?.name}</DialogTitle>
              <DialogDescription className="truncate text-[length:var(--fs-11)]">Επίλεξε τα δικαιώματα που έχει αυτός ο ρόλος.</DialogDescription>
            </div>
            {openRole && (
              <div className="hidden shrink-0 items-center gap-3 text-[length:var(--fs-12)] text-muted-foreground sm:flex">
                <span className="inline-flex items-center gap-1"><FiUsers aria-hidden className="size-3.5" /> {openRole.userCount}</span>
                {openRole.isSystem && <Badge variant="outline"><FiLock /> System</Badge>}
              </div>
            )}
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
      <div className="max-h-[66vh] space-y-3 overflow-y-auto bg-muted/20 px-4 py-3">
        <FormSection
          tone="blue" icon={<FiKey />} title="Δικαιώματα"
          aside={<span className="font-mono tabular-nums">{selected.size}/{Object.values(byResource).reduce((n, ps) => n + ps.length, 0)}</span>}
        >
        <div className="-mx-3 -my-2.5">
        <Accordion type="multiple" className="w-full">
          {Object.entries(byResource).map(([resource, perms]) => {
            const total = totalByResource(perms);
            const sel = selectedByResource(perms);
            const allOn = sel === total;
            const someOn = sel > 0 && sel < total;
            return (
              <AccordionItem key={resource} value={resource} className="border-b border-border last:border-b-0">
                <div className="flex items-center gap-2 px-3">
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
                    className={`inline-flex size-4 shrink-0 items-center justify-center rounded-sm border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      allOn || someOn
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-card border-input hover:border-primary'
                    }`}
                  >
                    {allOn ? <FiCheck className="h-3 w-3" /> : someOn ? <span className="block h-0.5 w-2 bg-current" /> : null}
                  </span>
                  <AccordionTrigger className="hover:no-underline py-1.5 flex-1 group min-w-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate text-[length:var(--fs-11)] font-bold uppercase tracking-wider text-foreground">{resource}</span>
                      <span className={`ml-auto mr-2 rounded px-1.5 font-mono text-[length:var(--fs-10)] tabular-nums ${allOn ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : someOn ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>
                        {sel}/{total}
                      </span>
                    </div>
                  </AccordionTrigger>
                </div>
                <AccordionContent className="pb-1.5">
                  <div className="space-y-0.5 pl-7 pr-3">
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
                          <div className="text-[length:var(--fs-11)] font-medium text-foreground leading-tight">{p.action}</div>
                          {p.description && (
                            <div className="text-[length:var(--fs-10)] text-muted-foreground leading-tight">{p.description}</div>
                          )}
                        </div>
                        <code className="max-w-[40%] truncate text-[length:var(--fs-10)] text-muted-foreground/70 font-mono">{p.key}</code>
                      </label>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        </div>
        </FormSection>
      </div>
      <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
        <Button variant="outline" onClick={onCancel}>Άκυρο</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση...' : 'Αποθήκευση'}</Button>
      </DialogFooter>
    </>
  );
}
