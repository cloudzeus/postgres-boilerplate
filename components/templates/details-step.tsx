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
  // Seeded from EITHER id or name: a template can carry a supplier name with no SoftOne link,
  // and seeding from the id alone made the next save send `supplierName: null` and wipe it.
  const [supplier, setSupplier] = useServerDraft<SupplierPick | null>(dto.traderTrdr || dto.supplierName ? { id: dto.traderTrdr, name: dto.supplierName ?? '', vat: dto.vatNumber ?? '' } : null);
  // Τα κατώφλια της εκπαίδευσης (§11) ζουν εδώ, μαζί με τα υπόλοιπα «στοιχεία» του προτύπου: ο
  // βαθμός μετριέται στο βήμα «Εκπαίδευση», αλλά ΠΟΣΟΣ φτάνει είναι απόφαση, όχι μέτρηση.
  const [minPct, setMinPct] = useServerDraft(String(Math.round(dto.minTrainingScore * 100)));
  const [minSamples, setMinSamples] = useServerDraft(String(dto.minTrainingSamples));
  const [busy, setBusy] = React.useState(false);
  const slugLocked = dto.runsCount > 0;
  const pctNum = Number(minPct);
  const samplesNum = Number(minSamples);
  const gateDirty = pctNum !== Math.round(dto.minTrainingScore * 100) || samplesNum !== dto.minTrainingSamples;
  const dirty = name.trim() !== dto.name || slug !== dto.slug || department.trim() !== (dto.department ?? '') || vat !== (dto.vatNumber ?? '') || (supplier?.id ?? null) !== dto.traderTrdr || (supplier?.name ?? null) !== dto.supplierName || gateDirty;
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  const pickSupplier = (s: SupplierPick | null) => { setSupplier(s); if (s?.vat) setVat(s.vat); };
  const save = async () => {
    if (vat && !/^\d{9}$/.test(vat)) { toast.error('Το ΑΦΜ έχει 9 ψηφία'); return; }
    // `slugDraft` keeps a just-typed trailing `_` so the next word can be joined; it must never be saved.
    const cleanSlug = slug.replace(/_+$/, '');
    if (!slugLocked && !cleanSlug) { toast.error('Δώσε slug'); return; }
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) { toast.error('Το κατώφλι βαθμού είναι 0-100 %'); return; }
    if (!Number.isInteger(samplesNum) || samplesNum < 0 || samplesNum > 100) { toast.error('Τα ελάχιστα δείγματα είναι 0-100'); return; }
    setBusy(true);
    try {
      setDto(await templatesApi.patch(dto.id, {
        name: name.trim(), ...(slugLocked ? {} : { slug: cleanSlug }), department: department.trim() || null,
        vatNumber: vat || null, traderTrdr: supplier?.id ?? null, supplierName: supplier?.name || null,
        minTrainingScore: pctNum / 100, minTrainingSamples: samplesNum,
      }));
      toast.success('Αποθηκεύτηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div><h2 className="text-[length:var(--fs-16)] font-semibold">Στοιχεία προτύπου</h2><p className="text-[length:var(--fs-12)] text-muted-foreground">Το πρότυπο είναι ανεξάρτητο. Η σύνδεση με προμηθευτή ή τμήμα είναι προαιρετική.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="tn">Όνομα</Label><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="mt-1" /></div>
        <div><Label htmlFor="ts">Slug</Label><Input id="ts" value={slug} onChange={(e) => setSlug(slugDraft(e.target.value))} disabled={!canManage || slugLocked} className="mt-1 font-mono" />
          <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">{slugLocked ? 'Κλειδωμένο — το πρότυπο έχει εκτελέσεις.' : 'Κλειδί του JSON εξόδου.'}</p></div>
        <div><Label htmlFor="td">Τμήμα / κατηγορία</Label><Input id="td" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canManage} className="mt-1" placeholder="π.χ. Λογιστήριο, Συνεργείο" /></div>
        <div className="sm:col-span-2"><SupplierSearch value={supplier} onChange={pickSupplier} disabled={!canManage} /></div>
        <div><Label htmlFor="tv">ΑΦΜ εκδότη (προαιρετικό)</Label><Input id="tv" value={vat} onChange={(e) => setVat(e.target.value.replace(/\D/g, '').slice(0, 9))} disabled={!canManage} className="mt-1 font-mono" inputMode="numeric" />
          <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">Με ΑΦΜ, το πρότυπο θα εφαρμόζεται αυτόματα στα έγγραφα του εκδότη μόλις ενεργοποιηθεί η ροή εκτέλεσης.</p></div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div>
          <h3 className="text-[length:var(--fs-13)] font-semibold">Πύλη εκπαίδευσης</h3>
          <p className="text-[length:var(--fs-11)] text-muted-foreground">
            Πόσο εκπαιδευμένο πρέπει να είναι το πρότυπο πριν επιτραπεί η ενεργοποίησή του. Ο βαθμός μετριέται
            στο βήμα «Εκπαίδευση»: ποσοστό των πεδίων που το πρότυπο διάβασε όπως τα επιβεβαίωσε άνθρωπος.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="tms">Ελάχιστα επιβεβαιωμένα δείγματα</Label>
            <Input id="tms" value={minSamples} onChange={(e) => setMinSamples(e.target.value.replace(/\D/g, '').slice(0, 3))} disabled={!canManage} className="mt-1 font-mono" inputMode="numeric" />
            <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">0 = χωρίς έλεγχο εκπαίδευσης (το πρότυπο ενεργοποιείται όπως πριν).</p>
          </div>
          <div>
            <Label htmlFor="tmp">Ελάχιστος βαθμός (%)</Label>
            <Input id="tmp" value={minPct} onChange={(e) => setMinPct(e.target.value.replace(/\D/g, '').slice(0, 3))} disabled={!canManage} className="mt-1 font-mono" inputMode="numeric" />
            <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">Προεπιλογή 90 % σε 3 δείγματα. Ισχύει μόνο στην ενεργοποίηση, όχι σε κάθε αποθήκευση.</p>
          </div>
        </div>
      </div>

      {canManage && <Button onClick={save} disabled={!dirty || busy || !name.trim() || !slug}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>}
    </div>
  );
}
