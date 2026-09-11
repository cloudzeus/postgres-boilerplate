// lib/templates/jobs-notify.ts — PURE. Το email που φεύγει όταν τελειώνει μια εργασία σάρωσης (§12).
// Καμία I/O: το `jobs.ts` φτιάχνει το κείμενο εδώ και το δίνει στο Mailgun.
import type { JobStatus } from './jobs-logic';

/** Η κατάσταση με την οποία μπορεί να τελειώσει μια εργασία — και μόνο αυτή στέλνει email. */
export type TerminalJobStatus = Extract<JobStatus, 'DONE' | 'FAILED' | 'CANCELLED'>;

export type JobMailInput = {
  status: TerminalJobStatus;
  /** Ο τίτλος που έγραψε ο χρήστης, ή το όνομα του προτύπου όταν δεν έγραψε. */
  title: string;
  templateName: string;
  reference: string | null;
  /** Η ημερομηνία ΑΝΑΦΟΡΑΣ του χρήστη — όχι η στιγμή που έτρεξε η εργασία. */
  docDate: Date | null;
  description: string | null;
  total: number;
  done: number;
  failed: number;
  durationMs: number | null;
  /** Απόλυτος σύνδεσμος προς τη σελίδα της εργασίας, ή '' όταν δεν έχει ρυθμιστεί APP_URL. */
  link: string;
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);

const VERB: Record<TerminalJobStatus, string> = {
  DONE: 'Ολοκληρώθηκε',
  FAILED: 'Απέτυχε',
  CANCELLED: 'Ακυρώθηκε',
};

/** «Ολοκληρώθηκε η εργασία «Τιμολόγια Μαΐου»» — ο τίτλος του χρήστη είναι ό,τι αναγνωρίζει. */
export function jobCompletionSubject(i: Pick<JobMailInput, 'status' | 'title'>): string {
  return `${VERB[i.status]} η εργασία «${i.title}»`;
}

/** «2 λ 13 δ» — η διάρκεια όπως τη διαβάζει άνθρωπος· κενό όταν δεν μετρήθηκε. */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} δ`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} λ ${rest} δ` : `${m} λ`;
  return `${Math.floor(m / 60)} ω ${m % 60} λ`;
}

const dateText = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '';

const row = (label: string, value: string) =>
  value ? `<tr><td style="padding:4px 10px 4px 0;color:#6b6b6b">${esc(label)}</td><td style="padding:4px 0"><strong>${esc(value)}</strong></td></tr>` : '';

/**
 * Το σώμα του email. Ίδιο ύφος με το `notify.ts`: λίγες γραμμές πίνακα και ένας σύνδεσμος — και,
 * όταν το `APP_URL` είναι κενό (όπως στο .env αυτή τη στιγμή), ΚΑΝΕΝΑΣ σύνδεσμος αντί για σπασμένος.
 */
export function jobCompletionHtml(i: JobMailInput): string {
  const head = i.status === 'CANCELLED'
    ? `Η εργασία σάρωσης <strong>${esc(i.title)}</strong> ακυρώθηκε.`
    : i.status === 'FAILED'
      ? `Η εργασία σάρωσης <strong>${esc(i.title)}</strong> απέτυχε — κανένα αρχείο δεν διαβάστηκε.`
      : `Η εργασία σάρωσης <strong>${esc(i.title)}</strong> ολοκληρώθηκε.`;

  const rows = [
    row('Πρότυπο', i.templateName),
    row('Σήμανση', i.reference ?? ''),
    row('Ημερομηνία', dateText(i.docDate)),
    row('Αρχεία', `${i.done} από ${i.total}${i.failed ? ` · ${i.failed} με σφάλμα` : ''}`),
    row('Διάρκεια', formatDuration(i.durationMs)),
  ].join('');

  const note = i.description ? `<p style="color:#444">${esc(i.description)}</p>` : '';
  const tail = i.link ? `<p><a href="${esc(i.link)}">Άνοιγμα εργασίας</a></p>` : '';
  return `<p>${head}</p>${note}<table>${rows}</table>${tail}`;
}
