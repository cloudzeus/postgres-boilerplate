'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

export function SupplierStep() {
  const { dto, setDto, canManage } = useDesigner();
  const [name, setName] = React.useState(dto.name);
  const [supplierName, setSupplierName] = React.useState(dto.supplierName ?? '');
  const [busy, setBusy] = React.useState(false);
  const dirty = name !== dto.name || supplierName !== (dto.supplierName ?? '');

  const save = async () => {
    setBusy(true);
    try { setDto(await templatesApi.patch(dto.id, { name: name.trim(), supplierName: supplierName.trim() || null })); toast.success('Αποθηκεύτηκε'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div><h2 className="text-[16px] font-semibold">Προμηθευτής</h2><p className="text-[12px] text-muted-foreground">Το πρότυπο εφαρμόζεται αυτόματα σε έγγραφα με αυτό το ΑΦΜ εκδότη.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>ΑΦΜ</Label><Input value={dto.vatNumber} readOnly className="mt-1 font-mono bg-neutral-4" /></div>
        <div><Label>Τύπος εγγράφου</Label><Input value={dto.docType === 'RECEIPT' ? 'Απόδειξη' : 'Τιμολόγιο'} readOnly className="mt-1 bg-neutral-4" /></div>
        <div className="sm:col-span-2"><Label htmlFor="sn">Επωνυμία προμηθευτή</Label><Input id="sn" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
        <div className="sm:col-span-2"><Label htmlFor="tn">Όνομα προτύπου</Label><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
      </div>
      {dto.traderTrdr && <p className="text-[11px] text-muted-foreground">Συνδεδεμένο με συναλλασσόμενο SoftOne TRDR {dto.traderTrdr}.</p>}
      {canManage && <Button onClick={save} disabled={!dirty || busy || !name.trim()}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
    </div>
  );
}
