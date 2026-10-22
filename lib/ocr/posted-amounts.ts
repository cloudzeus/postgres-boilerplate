// SERVER: «Διόρθωση ποσών στη SoftOne» για ΗΔΗ καταχωρισμένα παραστατικά.
//
// Οι ειδικές συναλλαγές στέλνονταν χωρίς `LINEVAL` και η SoftOne τις έγραψε με ΜΗΔΕΝ (ΕΥΔΑΠ 115601,
// ΗΡΩΝ 115571 — βλ. `PurdocLinLine`). Η διόρθωση ενημερώνει ΤΟ ΙΔΙΟ παραστατικό (ίδιο FINDOC, ίδιες
// γραμμές με το ίδιο LINENUM), συμπληρώνοντας ΜΟΝΟ την «Αξία» κάθε γραμμής — δεν δημιουργεί νέο,
// δεν αλλάζει αριθμό, ημερομηνία, πιστωτή ή γραμμές.
//
// Ασφάλεια, με τη σειρά: (1) ζωντανή ανάγνωση του παραστατικού· (2) οι γραμμές της SoftOne πρέπει να
// είναι ΑΚΡΙΒΩΣ αυτές που στείλαμε (πλήθος + χρεοπίστωση, με τη σειρά) — αλλιώς δεν μαντεύουμε·
// (3) `calculate` με το ίδιο KEY (δεν αποθηκεύει) πρέπει να βγάζει την καθαρή αξία του χαρτιού·
// (4) `setData`· (5) νέα ανάγνωση: η καθαρή αξία πρέπει πλέον να είναι η σωστή. Επιβεβαιωμένο με
// `calculate` στη Demo (22/10/2026): 115601 → 898,30 + 117,37 · 115571 → 73.886,38 + 4.433,18.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { softoneCall, softoneGetData } from '@/lib/softone';
import { expectedNetOf, gatherForConversion } from '@/lib/ocr/post-softone';
import { softoneErrorLine } from '@/lib/ocr/softone-error-text';

export class PostedAmountsError extends Error {}

interface Totals { net: number | null; vat: number | null; total: number | null }
export interface PostedAmountsLine { linenum: number; mtrl: number; comment: string | null; saved: number | null; expected: number }
export interface PostedAmountsCheck {
  ref: string;
  object: string;
  status: 'ok' | 'mismatch';
  saved: Totals;
  /** Καθαρή αξία = άθροισμα γραμμών· ΦΠΑ και σύνολο = όπως τυπώθηκαν στο χαρτί. */
  expected: Totals;
  /** Τι θα κρατήσει η SoftOne ΜΕΤΑ τη διόρθωση (από `calculate`, χωρίς αποθήκευση). */
  preview: Totals | null;
  fixable: boolean;
  /** Γιατί δεν διορθώνεται αυτόματα (όταν `fixable` = false και υπάρχει διαφορά). */
  reason: string | null;
  /** Ο ΦΠΑ μετά τη διόρθωση διαφέρει από τον τυπωμένο — θέλει ρητή αποδοχή. */
  vatWarning: string | null;
  lines: PostedAmountsLine[];
}

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};
const eur = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const netTol = (x: number) => Math.max(0.1, Math.abs(x) * 0.002);
/** Ο ΦΠΑ στρογγυλοποιείται ανά γραμμή: ανοχή λίγα λεπτά ΑΝΑ ΓΡΑΜΜΗ — όχι ποσοστό (0,5% σε 4.412 € = 22 €, έκρυβε πραγματική διαφορά 21 €). */
const vatTol = (lines: number) => Math.max(0.1, 0.02 * lines);
const totalsOf = (row: Record<string, unknown> | undefined): Totals => ({ net: num(row?.NETAMNT), vat: num(row?.VATAMNT), total: num(row?.SUMAMNT) });

const LOCATE = (object: string) => `${object}:FINDOC,TRDR,NETAMNT,VATAMNT,SUMAMNT;LINLINES:LINENUM,MTRL,LINEVAL,NETLINEVAL,COMMENTS`;

async function load(docId: string) {
  const doc = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { postStatus: true, postedRef: true, postError: true } });
  if (!doc) throw new PostedAmountsError('Το παραστατικό δεν βρέθηκε.');
  if (doc.postStatus !== 'POSTED' || !doc.postedRef) throw new PostedAmountsError('Το παραστατικό δεν έχει καταχωριστεί στη SoftOne.');
  const g = await gatherForConversion(docId);
  return { doc, g, ref: doc.postedRef };
}

export async function checkPostedAmounts(docId: string): Promise<PostedAmountsCheck> {
  const { g, ref } = await load(docId);
  const object = g.payload.OBJECT;
  const tables = await softoneGetData(object, ref, LOCATE(object));
  const saved = totalsOf(tables[object]?.[0]);
  const expectedNet = expectedNetOf(g.document);
  const expected: Totals = { net: expectedNet, vat: g.document.totals?.vatAmount ?? null, total: g.document.totals?.total ?? null };
  const hasExpenses = ((g.payload.DATA as Record<string, unknown[] | undefined>).EXPANAL ?? []).length > 0;
  const netOk = saved.net != null && (hasExpenses ? !(Math.abs(expectedNet) > 0.5 && Math.abs(saved.net) < 0.005) : Math.abs(saved.net - expectedNet) <= netTol(expectedNet));
  const base = { ref, object, saved, expected, lines: [] as PostedAmountsLine[] };
  if (netOk) return { ...base, status: 'ok', preview: null, fixable: false, reason: null, vatWarning: null };

  // Αυτόματη διόρθωση ΜΟΝΟ για ειδικές συναλλαγές, όπου ξέρουμε την αιτία (λείπει το LINEVAL).
  if (g.ctx.target.lines !== 'LINLINES') {
    return { ...base, status: 'mismatch', preview: null, fixable: false, vatWarning: null,
      reason: 'Η αυτόματη διόρθωση αφορά παραστατικά ειδικών συναλλαγών. Διόρθωσε αυτό το παραστατικό στη SoftOne.' };
  }
  const sent = ((g.payload.DATA as { LINLINES?: { MTRL: number; LINEVAL: number }[] }).LINLINES ?? []);
  const rows = (tables.LINLINES ?? []) as Record<string, unknown>[];
  const lines: PostedAmountsLine[] = rows.map((r, i) => ({
    linenum: Number(r.LINENUM), mtrl: Number(r.MTRL), comment: r.COMMENTS == null ? null : String(r.COMMENTS),
    saved: num(r.LINEVAL), expected: sent[i]?.LINEVAL ?? 0,
  }));
  const sameShape = rows.length === sent.length && rows.every((r, i) => Number(r.MTRL) === sent[i].MTRL && Number.isFinite(Number(r.LINENUM)));
  if (!sameShape) {
    return { ...base, lines, status: 'mismatch', preview: null, fixable: false, vatWarning: null,
      reason: `Οι γραμμές στη SoftOne (${rows.length}) δεν είναι πια ίδιες με αυτές που στάλθηκαν (${sent.length}) — μάλλον άλλαξαν εκεί. Διόρθωσέ το στη SoftOne, για να μη γραφτεί ποσό σε λάθος γραμμή.` };
  }

  const res = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, Record<string, unknown>[]> }>('calculate', {
    OBJECT: object, KEY: ref, DATA: { LINLINES: lines.map((l) => ({ LINENUM: l.linenum, MTRL: l.mtrl, LINEVAL: l.expected })) },
    LOCATEINFO: `${object}:NETAMNT,VATAMNT,SUMAMNT`,
  });
  if (res.success === false) {
    return { ...base, lines, status: 'mismatch', preview: null, fixable: false, vatWarning: null, reason: softoneErrorLine(res.error ?? 'άγνωστο σφάλμα') };
  }
  const preview = totalsOf(res.data?.[object]?.[0]);
  const previewOk = preview.net != null && Math.abs(preview.net - expectedNet) <= netTol(expectedNet);
  const vatWarning = preview.vat != null && expected.vat != null && Math.abs(preview.vat - expected.vat) > vatTol(lines.length)
    ? `Μετά τη διόρθωση ο ΦΠΑ στη SoftOne θα είναι ${eur(preview.vat)}, ενώ το παραστατικό γράφει ${eur(expected.vat)} (διαφορά ${eur(Math.round((preview.vat - expected.vat) * 100) / 100)}). Μάλλον κάποια χρέωση έχει άλλον συντελεστή ΦΠΑ από αυτόν της γραμμής — η καθαρή αξία θα είναι σωστή, τον ΦΠΑ τον διορθώνεις μετά στη SoftOne.`
    : null;
  return {
    ...base, lines, status: 'mismatch', preview,
    fixable: previewOk,
    reason: previewOk ? null : `Ο έλεγχος στη SoftOne βγάζει καθαρή αξία ${eur(preview.net)} αντί για ${eur(expectedNet)} — δεν διορθώνεται αυτόματα.`,
    vatWarning,
  };
}

export async function fixPostedAmounts(
  docId: string,
  opts: { acknowledgeVat: boolean; actor: { id: string; email: string } | null },
): Promise<{ before: Totals; after: Totals; check: PostedAmountsCheck }> {
  // Ο έλεγχος ΞΑΝΑΓΙΝΕΤΑΙ εδώ — όχι εμπιστοσύνη σε ό,τι είδε ο browser πριν από λίγο.
  const check = await checkPostedAmounts(docId);
  if (check.status === 'ok') throw new PostedAmountsError('Τα ποσά στη SoftOne είναι ήδη σωστά — δεν χρειάζεται διόρθωση.');
  if (!check.fixable) throw new PostedAmountsError(check.reason ?? 'Δεν διορθώνεται αυτόματα.');
  if (check.vatWarning && !opts.acknowledgeVat) throw new PostedAmountsError('Επιβεβαίωσε ότι είδες τη διαφορά ΦΠΑ πριν από τη διόρθωση.');

  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', {
    OBJECT: check.object, KEY: check.ref,
    // ΟΛΕΣ οι γραμμές με το LINENUM τους (γραμμή που λείπει από το setData διαγράφεται) — μόνο η «Αξία» αλλάζει.
    DATA: { LINLINES: check.lines.map((l) => ({ LINENUM: l.linenum, MTRL: l.mtrl, LINEVAL: l.expected })) },
  });
  if (res.success === false) throw new PostedAmountsError(softoneErrorLine(res.error ?? `setData απέτυχε (code ${res.errorcode ?? '?'})`));

  // Το `success:true` δεν αποδεικνύει τίποτα — η νέα ανάγνωση αποφασίζει.
  const tables = await softoneGetData(check.object, check.ref, LOCATE(check.object));
  const after = totalsOf(tables[check.object]?.[0]);
  const ok = after.net != null && check.expected.net != null && Math.abs(after.net - check.expected.net) <= netTol(check.expected.net);

  if (opts.actor) {
    await logAudit({
      userId: opts.actor.id, userEmail: opts.actor.email, action: 'ocr.post.amounts_fix', resource: 'ocr_document', resourceId: docId,
      metadata: { summary: `FINDOC ${check.ref}: καθαρή ${eur(check.saved.net)} → ${eur(after.net)}`, ref: check.ref, before: check.saved, after, expected: check.expected, ok, vatAcknowledged: !!check.vatWarning },
    }).catch(() => null);
  }
  if (!ok) throw new PostedAmountsError(`Η SoftOne απάντησε επιτυχία, αλλά η νέα ανάγνωση δείχνει καθαρή αξία ${eur(after.net)} αντί για ${eur(check.expected.net)}. Έλεγξέ το στη SoftOne.`);

  await prisma.ocrDocument.update({
    where: { id: docId },
    data: { postError: `Τα ποσά διορθώθηκαν στη SoftOne στις ${new Date().toLocaleString('el-GR')}: καθαρή ${eur(after.net)}, ΦΠΑ ${eur(after.vat)}, σύνολο ${eur(after.total)}.${check.vatWarning ? ` ${check.vatWarning}` : ''}` },
  }).catch(() => null);
  return { before: check.saved, after, check };
}
