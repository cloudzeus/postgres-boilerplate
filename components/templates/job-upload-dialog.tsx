'use client';

// components/templates/job-upload-dialog.tsx — «Σάρωση αρχείων»: πολλά αρχεία + τα μεταδεδομένα της
// παρτίδας (spec §12). Ό,τι δηλώνει ο χρήστης εδώ ταξιδεύει μαζί με την εργασία: στη λίστα, στην
// κεφαλίδα της, και στο email που φεύγει όταν τελειώσει.
//
// Το ανέβασμα είναι ΕΝΑ αίτημα: ο server χρειάζεται όλα τα αρχεία μαζί για να μετρήσει το `total`
// της εργασίας πριν την ξεκινήσει. Γι' αυτό και το route έχει `maxDuration = 300` — μόνο bytes,
// καμία κλήση όρασης· εκείνες γίνονται μετά, στον worker.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiFile, FiInfo, FiMail, FiPlay, FiUploadCloud, FiX } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormSection, RowHint, fieldCls } from '@/components/admin/form-kit';
import { cn } from '@/lib/utils';
import { MAX_JOB_FILES, MAX_JOB_TOTAL_BYTES } from '@/lib/templates/jobs-logic';
import { templatesApi, errorMessage } from '@/components/templates/api';

const ALLOWED = /\.(pdf|png|jpe?g|webp)$/i;
const MAX_BYTES = 25 * 1024 * 1024;

const MAX_TOTAL_MB = Math.round(MAX_JOB_TOTAL_BYTES / (1024 * 1024));

const humanSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const today = () => new Date().toISOString().slice(0, 10);

type Props = {
  templateId: string;
  templateName: string;
  /** Τα emails του προτύπου — προσυμπληρώνουν το «Ειδοποίηση σε», ώστε να φαίνεται ποιος θα μάθει. */
  defaultEmails?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function JobUploadDialog({ templateId, templateName, defaultEmails, open, onOpenChange }: Props) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [title, setTitle] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [docDate, setDocDate] = React.useState(today());
  const [description, setDescription] = React.useState('');
  const [emails, setEmails] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Κάθε άνοιγμα ξεκινά καθαρό, με τον τίτλο και τους παραλήπτες ήδη προτεινόμενους: η συνηθισμένη
  // περίπτωση είναι «αυτά τα αρχεία, σήμερα, με τα emails του προτύπου» και δεν πρέπει να θέλει πληκτρολόγηση.
  React.useEffect(() => {
    if (!open) return;
    setFiles([]);
    setTitle(`${templateName} · ${new Date().toLocaleDateString('el-GR')}`);
    setReference('');
    setDocDate(today());
    setDescription('');
    setEmails(defaultEmails ?? '');
    setBusy(false);
  }, [open, templateName, defaultEmails]);

  const addFiles = (picked: File[]) => {
    const valid = picked.filter((f) => ALLOWED.test(f.name) && f.size > 0);
    const skipped = picked.length - valid.length;
    const tooBig = valid.filter((f) => f.size > MAX_BYTES);
    const ok = valid.filter((f) => f.size <= MAX_BYTES);
    setFiles((prev) => {
      // Ίδιο όνομα + ίδιο μέγεθος = ίδιο αρχείο· ένας φάκελος που επιλέγεται δύο φορές δεν διπλασιάζει τη δουλειά.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const next = [...prev, ...ok.filter((f) => !seen.has(`${f.name}:${f.size}`))];
      if (next.length > MAX_JOB_FILES) toast.error(`Έως ${MAX_JOB_FILES} αρχεία ανά εργασία — κρατήθηκαν τα πρώτα.`);
      return next.slice(0, MAX_JOB_FILES);
    });
    if (skipped) toast.error(`${skipped} αρχεία αγνοήθηκαν (δεκτά μόνο PDF, PNG, JPEG, WebP)`);
    if (tooBig.length) toast.error(`${tooBig.length} αρχεία ξεπερνούν τα 25 MB`);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || files.length === 0 || !title.trim() || totalBytes > MAX_JOB_TOTAL_BYTES) return;
    setBusy(true);
    try {
      const { jobId } = await templatesApi.jobs.create(templateId, files, {
        title: title.trim(),
        reference: reference.trim() || undefined,
        docDate: docDate || undefined,
        description: description.trim() || undefined,
        notifyEmails: emails.trim() || undefined,
      });
      toast.success(`Η εργασία ξεκίνησε — ${files.length} αρχεία`);
      // Η πλοήγηση ΠΡΙΝ το κλείσιμο: ο διάλογος ζει μέσα σε conditional render, και κλείνοντάς τον
      // πρώτα ξηλώνουμε το component που μόλις ζήτησε το push.
      router.push(`/admin/ocr/templates/jobs/${jobId}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  // Το ίδιο ταβάνι που θα έβαζε ο server — αλλά ΠΡΙΝ ανέβει το πρώτο byte: ένα 413 μετά από πέντε
  // λεπτά ανεβάσματος είναι η χειρότερη στιγμή για να μάθει κανείς ότι η παρτίδα ήταν μεγάλη.
  const tooMuch = totalBytes > MAX_JOB_TOTAL_BYTES;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="flex max-h-[92dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 [&_svg]:size-4"><FiUploadCloud /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[length:var(--fs-15)]" title={`Σάρωση αρχείων — ${templateName}`}>Σάρωση αρχείων — {templateName}</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]" title="Τα αρχεία διαβάζονται στο παρασκήνιο, ένα-ένα. Μπορείς να κλείσεις τη σελίδα· η εργασία συνεχίζει.">
              Τα αρχεία διαβάζονται στο παρασκήνιο, ένα-ένα. Μπορείς να κλείσεις τη σελίδα· η εργασία συνεχίζει.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            <FormSection tone="blue" icon={<FiInfo />} title="Στοιχεία εργασίας">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label="Τίτλος εργασίας" required htmlFor="job-title" className="col-span-12">
                  <Input id="job-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={fieldCls} autoComplete="off" />
                </Field>
                <Field label="Σήμανση (προαιρετικό)" htmlFor="job-ref" className="col-span-12 sm:col-span-7">
                  <Input id="job-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={fieldCls} placeholder="π.χ. ΠΑΡ-2026-05" autoComplete="off" />
                </Field>
                <Field label="Ημερομηνία" htmlFor="job-date" className="col-span-12 sm:col-span-5">
                  <Input id="job-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={cn(fieldCls, 'tabular-nums')} />
                </Field>
                <Field label="Περιγραφή (προαιρετικό)" htmlFor="job-desc" className="col-span-12">
                  <textarea
                    id="job-desc" value={description} maxLength={500} rows={2}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[3.5rem] w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[length:var(--fs-13)] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
                    placeholder="Τι είναι αυτή η παρτίδα"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection tone="violet" icon={<FiMail />} title="Ειδοποίηση" aside="προαιρετικά">
              <Field label="Ειδοποίηση σε (προαιρετικό)" htmlFor="job-mail">
                <Input id="job-mail" value={emails} maxLength={500} onChange={(e) => setEmails(e.target.value)} className={fieldCls} placeholder="a@x.gr, b@x.gr" autoComplete="off" aria-describedby="job-mail-hint" />
              </Field>
              <div id="job-mail-hint"><RowHint>Ένα email μόλις ολοκληρωθεί η εργασία. Κενό = τα emails του προτύπου.</RowHint></div>
            </FormSection>

            <FormSection
              tone={tooMuch ? 'amber' : 'emerald'} icon={<FiFile />} title="Αρχεία"
              aside={files.length > 0 ? (
                <span className="flex items-center gap-2">
                  <span className={cn('tabular-nums', tooMuch && 'font-medium text-dg-red-600')}>{files.length} αρχεία · {humanSize(totalBytes)}</span>
                  <button type="button" className="cursor-pointer rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed" onClick={() => setFiles([])} disabled={busy}>Καθαρισμός</button>
                </span>
              ) : undefined}
            >
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files ?? [])); }}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5"
              >
                <FiUploadCloud className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[length:var(--fs-12)] text-muted-foreground">Σύρε αρχεία εδώ ή</p>
                  <p className="text-[length:var(--fs-10)] text-muted-foreground">PDF, PNG, JPEG, WebP · έως 25 MB το καθένα · έως {MAX_JOB_FILES} αρχεία · έως {MAX_TOTAL_MB} MB συνολικά</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => inputRef.current?.click()} disabled={busy}>
                  Επιλογή αρχείων
                </Button>
                <input
                  ref={inputRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
                />
              </div>

              {tooMuch && (
                <RowHint tone="bad">
                  Πάνω από το όριο των {MAX_TOTAL_MB} MB ανά εργασία· αφαίρεσε αρχεία ή χώρισέ τα σε δεύτερη εργασία
                </RowHint>
              )}

              {files.length > 0 && (
                <ul className="max-h-40 divide-y divide-border overflow-auto rounded-md border border-border bg-card">
                  {files.map((f, i) => (
                    <li key={`${f.name}:${f.size}:${i}`} className="flex h-8 items-center gap-2 px-2 text-[length:var(--fs-11)] hover:bg-muted/40">
                      <FiFile className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{humanSize(f.size)}</span>
                      <button
                        type="button" aria-label={`Αφαίρεση ${f.name}`} disabled={busy}
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-dg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FiX className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>
          </div>

          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Άκυρο</Button>
            <Button type="submit" disabled={busy || files.length === 0 || !title.trim() || tooMuch}>
              <FiPlay className="mr-1.5 size-3.5" />
              {busy ? 'Ανέβασμα…' : `Έναρξη σάρωσης${files.length ? ` (${files.length})` : ''}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
