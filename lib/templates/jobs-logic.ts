// lib/templates/jobs-logic.ts — PURE. Ό,τι ξέρει μια εργασία σάρωσης για τον εαυτό της (spec §12, §13).
// Καμία I/O: ο worker (`jobs.ts`) ρωτά αυτές τις συναρτήσεις και μετά γράφει.
import { emptyDocument } from '@/lib/ocr/canonical';
import { projectToDocument } from './mapping';
import type { SheetInput } from './excel';
import type { FieldDef, FieldValue, MappingRowExcel, MappingRowInvoice } from './schema';

/**
 * Πόσο μένει ένα αντικείμενο RUNNING πριν θεωρηθεί εγκαταλειμμένο. Ο λόγος που υπάρχει καθόλου:
 * ο worker ζει ΜΕΣΑ στη διεργασία του server (spec §12) — ένα deploy ή ένα crash στη μέση μιας
 * ανάγνωσης αφήνει τη γραμμή RUNNING για πάντα, και κανείς δεν θα την ξαναπιάσει.
 *
 * 10 λεπτά: μια σελίδα με 20 πεδία είναι 20 κλήσεις όρασης, άρα ένα αργό αρχείο μπορεί κάλλιστα να
 * θέλει λεπτά. Πιο κοντά και θα «ανακτούσαμε» δουλειά που τρέχει ακόμη — δύο worker στο ίδιο αρχείο.
 */
export const STALE_MS = 10 * 60 * 1000;

/** Πόσα αρχεία δέχεται μία εργασία — και μία εργασία ανεβαίνει με ΕΝΑ αίτημα. */
export const MAX_JOB_FILES = 200;

/**
 * Πόσα bytes συνολικά δέχεται ΕΝΑ ανέβασμα εργασίας.
 *
 * Το όριο των 25 MB ανά αρχείο από μόνο του δεν φράζει τίποτα: 200 × 25 MB είναι 5 GB σε ένα αίτημα,
 * και το σώμα ενός multipart αιτήματος περνά ολόκληρο από τη μνήμη πριν το δει κώδικας δικός μας.
 * Ένα OOM εδώ δεν χαλάει απλώς το ανέβασμα — σκοτώνει τη διεργασία του Node, που ΕΙΝΑΙ ο worker των
 * εργασιών (spec §12), παρασύροντας κάθε εργασία που έτρεχε. Όποιος έχει περισσότερα, τα χωρίζει σε
 * δεύτερη εργασία· η ουρά τις δουλεύει τη μία μετά την άλλη ούτως ή άλλως.
 */
export const MAX_JOB_TOTAL_BYTES = 300 * 1024 * 1024;

/** Καταστάσεις που ο χρήστης μπορεί ακόμη να ακυρώσει, και καταστάσεις που δεν αλλάζουν πια. */
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type JobItemStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

/** True όσο η εργασία μπορεί ακόμη να κινηθεί μόνη της — το UI κάνει polling μόνο τότε. */
export function isActive(status: string): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

/**
 * Ένα αντικείμενο που «κόλλησε»: RUNNING εδώ και πάνω από `staleMs`. Ένα RUNNING χωρίς `startedAt`
 * είναι επίσης κολλημένο — η γραμμή γράφτηκε μισή, και κανείς δεν πρόκειται να την τελειώσει.
 */
export function isStale(item: { status: string; startedAt: Date | null }, now: Date, staleMs: number = STALE_MS): boolean {
  if (item.status !== 'RUNNING') return false;
  if (!item.startedAt) return true;
  return now.getTime() - item.startedAt.getTime() > staleMs;
}

export type JobProgress = { total: number; done: number; failed: number; processed: number; pct: number };

/** Η πρόοδος όπως τη δείχνει η μπάρα: τελειωμένα (πετυχημένα + αποτυχημένα) προς σύνολο. */
export function progressOf(job: { total: number; done: number; failed: number }): JobProgress {
  const total = Math.max(0, job.total);
  const done = Math.max(0, job.done);
  const failed = Math.max(0, job.failed);
  const processed = Math.min(total, done + failed);
  return { total, done, failed, processed, pct: total === 0 ? 0 : Math.round((processed / total) * 100) };
}

/**
 * Τι γίνεται η εργασία όταν δεν έχει μείνει αντικείμενο να πιάσει. FAILED μόνο όταν ΚΑΝΕΝΑ αρχείο
 * δεν διαβάστηκε: μια εργασία με 199 επιτυχίες και ένα σκουπίδι είναι επιτυχημένη — το σκουπίδι το
 * λέει η γραμμή του, όχι η κεφαλίδα.
 */
export function finalJobStatus(job: { total: number; done: number; failed: number }): 'DONE' | 'FAILED' {
  return job.done === 0 && job.failed > 0 ? 'FAILED' : 'DONE';
}

/** Η σειρά του επόμενου αντικειμένου μιας εργασίας — 0 όταν δεν υπάρχει κανένα. */
export function nextItemOrder(orders: number[]): number {
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

/**
 * Τα αρχεία μιας εργασίας ως γραμμές Excel (spec §12). Ίδιος εξαγωγέας με τις εκτελέσεις
 * (`buildSheets`), ώστε το φύλλο μιας σάρωσης να είναι αναγνωρίσιμα το ίδιο πράγμα με το φύλλο ενός
 * φακέλου: ένα κανονικό έγγραφο ανά αρχείο, με τις στήλες του EXCEL mapping αν υπάρχει.
 *
 * Το κανονικό έγγραφο χτίζεται ΕΔΩ, από τις τιμές — μια εργασία δεν αγγίζει `OcrDocument`, άρα δεν
 * υπάρχει έγγραφο να φορτωθεί: το `projectToDocument` πάνω σε άδειο τιμολόγιο κάνει ακριβώς αυτό
 * που κάνει και σε μια εκτέλεση (διαδρομές όπου υπάρχει mapping, `custom[fieldKey]` για τα υπόλοιπα).
 *
 * Μόνο τα DONE αρχεία εξάγονται: μια αποτυχημένη ανάγνωση δεν έχει τιμές, και μια κενή γραμμή στο
 * Excel διαβάζεται ως «το τιμολόγιο δεν είχε ποσά» αντί για «το αρχείο δεν διαβάστηκε».
 */
export function jobToSheetInputs(input: {
  templateSlug: string;
  templateName: string;
  fields: FieldDef[];
  invoiceRows: MappingRowInvoice[];
  excelRows: MappingRowExcel[] | null;
  items: { fileName: string; status: string; values: unknown }[];
}): SheetInput[] {
  const { fields } = input;
  return input.items
    .filter((i) => i.status === 'DONE')
    .map((i) => {
      const values = (i.values ?? {}) as Record<string, FieldValue>;
      return {
        templateSlug: input.templateSlug,
        templateName: input.templateName,
        file: i.fileName,
        fields,
        excelRows: input.excelRows,
        values,
        document: projectToDocument(values, input.invoiceRows, emptyDocument('invoice'), fields),
      };
    });
}
