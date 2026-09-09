'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { slugDraft } from '@/lib/templates/schema';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';
import { useServerDraft } from './use-server-draft';
import { SupplierSearch, type SupplierPick } from './supplier-search';

export function DetailsStep() {
  const { dto, setDto, canManage, setDirty } = useDesigner();
  // Content-keyed drafts: a save elsewhere in the designer returns a fresh DTO and
  // must not reset what is typed here.
  const [name, setName] = useServerDraft(dto.name);
  const [slug, setSlug] = useServerDraft(dto.slug);
  const [department, setDepartment] = useServerDraft(dto.department ?? '');
  const [vat, setVat] = useServerDraft(dto.vatNumber ?? '');
  const [supplier, setSupplier] = useServerDraft<SupplierPick | null>(dto.traderTrdr ? { id: dto.traderTrdr, name: dto.supplierName ?? '', vat: dto.vatNumber ?? '' } : null);
  const [busy, setBusy] = React.useState(false);
  const slugLocked = dto.runsCount > 0;
  const dirty = name.trim() !== dto.name || slug !== dto.slug || department.trim() !== (dto.department ?? '') || vat !== (dto.vatNumber ?? '') || (supplier?.id ?? null) !== dto.traderTrdr;
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  const pickSupplier = (s: SupplierPick | null) => { setSupplier(s); if (s?.vat) setVat(s.vat); };
  const save = async () => {
    if (vat && !/^\d{9}$/.test(vat)) { toast.error('Το ΑΦΜ έχει 9 ψηφία'); return; }
    setBusy(true);
    try {
      setDto(await templatesApi.patch(dto.id, {
        name: name.trim(), ...(slugLocked ? {} : { slug }), department: department.trim() || null,
        vatNumber: vat || null, traderTrdr: supplier?.id ?? null, supplierName: supplier?.name ?? null,
      }));
      toast.success('Αποθηκεύτηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div><h2 className="text-[16px] font-semibold">Στοιχεία προτύπου</h2><p className="text-[12px] text-muted-foreground">Το πρότυπο είναι ανεξάρτητο. Η σύνδεση με προμηθευτή ή τμήμα είναι προαιρετική.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="tn">Όνομα</Label><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
        <div><Label htmlFor="ts">Slug</Label><Input id="ts" value={slug} onChange={(e) => setSlug(slugDraft(e.target.value))} disabled={!canManage || slugLocked} className="mt-1 font-mono" />
          <p className="mt-1 text-[10px] text-muted-foreground">{slugLocked ? 'Κλειδωμένο — το πρότυπο έχει εκτελέσεις.' : 'Κλειδί του JSON εξόδου.'}</p></div>
        <div><Label htmlFor="td">Τμήμα / κατηγορία</Label><Input id="td" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canManage} className="mt-1" placeholder="π.χ. Λογιστήριο, Συνεργείο" /></div>
        <div className="sm:col-span-2"><SupplierSearch value={supplier} onChange={pickSupplier} disabled={!canManage} /></div>
        <div><Label htmlFor="tv">ΑΦΜ εκδότη (προαιρετικό)</Label><Input id="tv" value={vat} onChange={(e) => setVat(e.target.value.replace(/\D/g, '').slice(0, 9))} disabled={!canManage} className="mt-1 font-mono" inputMode="numeric" />
          <p className="mt-1 text-[10px] text-muted-foreground">Με ΑΦΜ, το πρότυπο εφαρμόζεται αυτόματα στα έγγραφα του εκδότη.</p></div>
      </div>
      {canManage && <Button onClick={save} disabled={!dirty || busy || !name.trim() || !slug}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
    </div>
  );
}
