'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiFileText } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormSection, RowHint, fieldCls } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';
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
        <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 [&_svg]:size-4"><FiFileText /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[length:var(--fs-15)]">Νέο πρότυπο</DialogTitle>
              <DialogDescription className="truncate text-[length:var(--fs-11)]" title="Δώσε ένα όνομα. Προμηθευτή ή τμήμα συνδέεις αργότερα, αν χρειάζεται.">
                Δώσε ένα όνομα. Προμηθευτή ή τμήμα συνδέεις αργότερα, αν χρειάζεται.
              </DialogDescription>
            </div>
          </DialogHeader>
          <form onSubmit={submit}>
            <div className="space-y-3 bg-muted/20 px-4 py-3">
              <FormSection tone="blue" icon={<FiFileText />} title="Ταυτότητα προτύπου">
                <Field label="Όνομα" required htmlFor="nm">
                  <Input id="nm" value={name} onChange={(e) => { const v = e.target.value; setName(v); if (!slugTouched) setSlug(v.trim() ? templateSlug(v) : ''); }} className={fieldCls} placeholder="π.χ. ΗΡΩΝ — Εκκαθαριστικός" autoComplete="off" />
                </Field>
                <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                  <Field label="Slug" htmlFor="sl" className="col-span-12 sm:col-span-6">
                    <Input id="sl" value={slug} onChange={(e) => { setSlug(slugDraft(e.target.value)); setSlugTouched(true); }} className={cn(fieldCls, 'font-mono')} autoComplete="off" aria-describedby="sl-hint" />
                  </Field>
                  <Field label="Τμήμα / κατηγορία (προαιρετικό)" htmlFor="dp" className="col-span-12 sm:col-span-6">
                    <Input id="dp" value={department} onChange={(e) => setDepartment(e.target.value)} className={fieldCls} placeholder="π.χ. Λογιστήριο, Συνεργείο" autoComplete="off" />
                  </Field>
                </div>
                <div id="sl-hint"><RowHint>Slug: κλειδί του JSON εξόδου. Παράγεται από το όνομα, μπορείς να το αλλάξεις.</RowHint></div>
              </FormSection>
            </div>
            <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Άκυρο</Button>
              <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Δημιουργία…' : 'Δημιουργία'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
