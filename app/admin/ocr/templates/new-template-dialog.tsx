'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { slugDraft, templateSlug } from '@/lib/templates/schema';
import { templatesApi, errorMessage } from '@/components/templates/api';

export function NewTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  // Until the user edits the slug it tracks the name; after that it is theirs.
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [department, setDepartment] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) { setName(''); setSlug(''); setSlugTouched(false); setDepartment(''); setBusy(false); }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !name.trim()) return;
    // `slugDraft` keeps a just-typed trailing `_`; strip it before it reaches the server.
    // An untouched slug is left to the server: it derives one from the name and de-duplicates
    // it with `freeSlug`, where sending our own copy would 409 on the second «Τιμολόγιο».
    const clean = slug.replace(/_+$/, '');
    setBusy(true);
    try {
      const r = await templatesApi.create({ name: name.trim(), slug: slugTouched && clean ? clean : undefined, department: department.trim() || null });
      toast.success('Το πρότυπο δημιουργήθηκε');
      onOpenChange(false);
      router.push(`/admin/ocr/templates/${r.id}`);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><FiPlus className="mr-1.5 size-3.5" /> Νέο πρότυπο</Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Νέο πρότυπο</DialogTitle>
            <DialogDescription>Δώσε ένα όνομα. Προμηθευτή ή τμήμα συνδέεις αργότερα, αν χρειάζεται.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="nm">Όνομα</Label>
              <Input id="nm" value={name} onChange={(e) => { const v = e.target.value; setName(v); if (!slugTouched) setSlug(v.trim() ? templateSlug(v) : ''); }} className="mt-1" placeholder="π.χ. ΗΡΩΝ — Εκκαθαριστικός" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="sl">Slug</Label>
              <Input id="sl" value={slug} onChange={(e) => { setSlug(slugDraft(e.target.value)); setSlugTouched(true); }} className="mt-1 font-mono" autoComplete="off" />
              <p className="mt-1 text-[length:var(--fs-10)] text-muted-foreground">Κλειδί του JSON εξόδου. Παράγεται από το όνομα, μπορείς να το αλλάξεις.</p>
            </div>
            <div>
              <Label htmlFor="dp">Τμήμα / κατηγορία (προαιρετικό)</Label>
              <Input id="dp" value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-1" placeholder="π.χ. Λογιστήριο, Συνεργείο" autoComplete="off" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Άκυρο</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
