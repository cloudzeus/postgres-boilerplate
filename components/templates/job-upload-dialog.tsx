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
import { FiFile, FiPlay, FiUploadCloud, FiX } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Σάρωση αρχείων — {templateName}</DialogTitle>
          <DialogDescription>
            Τα αρχεία διαβάζονται στο παρασκήνιο, ένα-ένα. Μπορείς να κλείσεις τη σελίδα· η εργασία συνεχίζει.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="job-title">Τίτλος εργασίας</Label>
              <Input id="job-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="mt-1" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="job-ref">Σήμανση (προαιρετικό)</Label>
              <Input id="job-ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className="mt-1" placeholder="π.χ. ΠΑΡ-2026-05" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="job-date">Ημερομηνία</Label>
              <Input id="job-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="job-desc">Περιγραφή (προαιρετικό)</Label>
              <textarea
                id="job-desc" value={description} maxLength={500} rows={2}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-400"
                placeholder="Τι είναι αυτή η παρτίδα"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="job-mail">Ειδοποίηση σε (προαιρετικό)</Label>
              <Input id="job-mail" value={emails} maxLength={500} onChange={(e) => setEmails(e.target.value)} className="mt-1" placeholder="a@x.gr, b@x.gr" autoComplete="off" />
              <p className="mt-1 text-[10px] text-muted-foreground">Ένα email μόλις ολοκληρωθεί η εργασία. Κενό = τα emails του προτύπου.</p>
            </div>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files ?? [])); }}
            className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center"
          >
            <FiUploadCloud className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-1 text-[12px] text-muted-foreground">Σύρε αρχεία εδώ ή</p>
            <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => inputRef.current?.click()} disabled={busy}>
              Επιλογή αρχείων
            </Button>
            <input
              ref={inputRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">PDF, PNG, JPEG, WebP · έως 25 MB το καθένα · έως {MAX_JOB_FILES} αρχεία · έως {MAX_TOTAL_MB} MB συνολικά</p>
          </div>

          {files.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className={tooMuch ? 'font-medium text-dg-red-600' : undefined}>
                  {files.length} αρχεία · {humanSize(totalBytes)}
                  {tooMuch && ` — πάνω από το όριο των ${MAX_TOTAL_MB} MB ανά εργασία· αφαίρεσε αρχεία ή χώρισέ τα σε δεύτερη εργασία`}
                </span>
                <button type="button" className="hover:underline" onClick={() => setFiles([])} disabled={busy}>Καθαρισμός</button>
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-auto rounded-md border border-border p-1.5">
                {files.map((f, i) => (
                  <li key={`${f.name}:${f.size}:${i}`} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[11px] hover:bg-muted/40">
                    <FiFile className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{humanSize(f.size)}</span>
                    <button
                      type="button" aria-label={`Αφαίρεση ${f.name}`} disabled={busy}
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-dg-red-600"
                    >
                      <FiX className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Άκυρο</Button>
            <Button type="submit" disabled={busy || files.length === 0 || !title.trim() || tooMuch}>
              <FiPlay className="mr-1.5 size-3.5" />
              {busy ? 'Ανέβασμα…' : `Έναρξη σάρωσης${files.length ? ` (${files.length})` : ''}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
