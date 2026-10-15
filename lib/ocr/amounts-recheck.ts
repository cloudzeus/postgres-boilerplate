// lib/ocr/amounts-recheck.ts — SERVER. ΕΠΑΝΕΛΕΓΧΟΣ ΠΟΣΩΝ από το ίδιο το χαρτί.
//
// Όταν τα ποσά δεν κλείνουν, η απάντηση είναι στο αρχείο — όπως και στο ΑΦΜ (`afm-recovery.ts`).
// Ξαναδιαβάζουμε ΜΟΝΟ τα ποσά (μια στοχευμένη ερώτηση δίνει στο μοντέλο λιγότερη ευκαιρία να
// «διορθώσει») και η νέα ανάγνωση περνά από τους ΙΔΙΟΥΣ ελέγχους (`totalsClose`). Προτείνεται ως
// διόρθωση μόνο αν κλείνει· αλλιώς το λέμε ρητά, χωρίς να γράψουμε τίποτα.
//
// Τίποτα δεν γράφεται εδώ — η εφαρμογή γίνεται από τον χρήστη (`applyAmounts`).
import 'server-only';
import { prisma } from '@/lib/db';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { callPdfNative, callVisionLLM, parseJsonLoose, resolveCfg } from '@/lib/ocr/extract';
import { supportsPdfNative } from '@/lib/ai/vision-provider';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { logAudit } from '@/lib/audit';
import { n, totalsClose, totalsPlans, type FixStep, type TotalsInput } from '@/lib/ocr/invoice-math';

const PROMPT = [
  'Είσαι ελεγκτής λογιστικών παραστατικών. Ξαναδιάβασε ΜΟΝΟ τα ποσά αυτού του παραστατικού.',
  'ΑΝΤΕΓΡΑΨΕ ΤΑ ΨΗΦΙΑ ΑΚΡΙΒΩΣ ΟΠΩΣ ΕΙΝΑΙ ΤΥΠΩΜΕΝΑ. Μην υπολογίζεις ό,τι δεν τυπώνεται.',
  'Για ΚΑΘΕ γραμμή ειδών, με τη σειρά: quantity, unitPrice, discountPercent (έκπτωση %, αν τυπώνεται),',
  'discountAmount (ποσό έκπτωσης, αν τυπώνεται), net (καθαρή αξία γραμμής ΜΕΤΑ την έκπτωση), vatRate (%).',
  'Σύνολα: net (καθαρή αξία), vatAmount (σύνολο ΦΠΑ), fees (επιβαρύνσεις/τέλη/μεταφορικά που ΔΕΝ είναι γραμμή),',
  'feesTaxed (true αν ο ΦΠΑ υπολογίζεται και πάνω στις επιβαρύνσεις), total (ΓΕΝΙΚΟ ΣΥΝΟΛΟ), payable (ΠΛΗΡΩΤΕΟ).',
  'Απάντησε ΜΟΝΟ με JSON: {"lines":[{"quantity":0,"unitPrice":0,"discountPercent":null,"discountAmount":null,"net":0,"vatRate":24}],',
  '"totals":{"net":0,"vatAmount":0,"fees":null,"feesTaxed":false,"total":0,"payable":null}}. null για ό,τι δεν φαίνεται.',
].join('\n');

export interface RecheckLine { rowIndex: number; quantity: number | null; price: number | null; discount: number | null; total: number | null; vatRate: number | null }
export interface AmountsProposal {
  subtotal: number | null; vatAmount: number | null; otherCharges: number | null; totalAmount: number | null;
  lines: RecheckLine[];
}
export interface RecheckResult {
  /** Η νέα ανάγνωση περνά ΟΛΟΥΣ τους ελέγχους. */
  closes: boolean;
  proposal: AmountsProposal | null;
  /** Οι γραμμές της ανάγνωσης δεν ήταν όσες του παραστατικού — οι γραμμές δεν προτείνονται. */
  lineCountMismatch: boolean;
  /** Η ανάγνωση κλείνει ΜΕ αυτές τις εξηγήσεις (π.χ. έκπτωση που ούτε η νέα ανάγνωση έγραψε). */
  steps?: FixStep[];
  message: string;
}

const numOrNull = (v: unknown) => n(v);

/** Η απάντηση του μοντέλου → πρόταση ποσών, ευθυγραμμισμένη με τις γραμμές του παραστατικού. ΚΑΘΑΡΟ. */
export function proposalFromReread(raw: unknown, current: { rowIndex: number }[]): { proposal: AmountsProposal; lineCountMismatch: boolean } {
  const o = (raw ?? {}) as { lines?: unknown[]; totals?: Record<string, unknown> };
  const rows = Array.isArray(o.lines) ? (o.lines as Record<string, unknown>[]) : [];
  const t = o.totals ?? {};
  const lineCountMismatch = rows.length !== current.length;
  const lines: RecheckLine[] = lineCountMismatch ? [] : rows.map((r, i) => {
    const pct = numOrNull(r.discountPercent);
    return {
      rowIndex: current[i].rowIndex,
      quantity: numOrNull(r.quantity), price: numOrNull(r.unitPrice),
      // Η έκπτωση κρατιέται ως % όταν τυπώνεται ως %, αλλιώς ως ποσό — όπως τη διαβάζει ο έλεγχος γραμμής.
      discount: pct ?? numOrNull(r.discountAmount),
      total: numOrNull(r.net), vatRate: numOrNull(r.vatRate),
    };
  });
  return {
    lineCountMismatch,
    proposal: {
      subtotal: numOrNull(t.net), vatAmount: numOrNull(t.vatAmount),
      otherCharges: numOrNull(t.fees), totalAmount: numOrNull(t.total),
      lines,
    },
  };
}

/** Τα ποσά της πρότασης ως είσοδος ελέγχων — με τις τωρινές γραμμές όπου η ανάγνωση δεν τις έδωσε. */
export function proposalInput(p: AmountsProposal, currentItems: (TotalsInput['items'][number] & { rowIndex: number })[]): TotalsInput {
  const byRow = new Map(p.lines.map((l) => [l.rowIndex, l]));
  return {
    items: currentItems.map((it) => {
      const l = byRow.get(it.rowIndex);
      return l ? { quantity: l.quantity, price: l.price, discount: l.discount, vatRate: l.vatRate, total: l.total } : it;
    }),
    subtotal: p.subtotal, vatAmount: p.vatAmount, otherCharges: p.otherCharges, totalAmount: p.totalAmount,
  };
}

export async function recheckAmounts(docId: string): Promise<RecheckResult> {
  const doc = await prisma.ocrDocument.findUnique({
    where: { id: docId },
    select: { storageKey: true, mimeType: true, items: { orderBy: { rowIndex: 'asc' }, select: { rowIndex: true, quantity: true, price: true, discount: true, vatRate: true, total: true } } },
  });
  if (!doc) return { closes: false, proposal: null, lineCountMismatch: false, message: 'Το παραστατικό δεν βρέθηκε.' };

  const cfg = await resolveCfg();
  const file = await bunnyDownload(doc.storageKey);
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(file);
  const isPdf = doc.mimeType === 'application/pdf';
  const native = isPdf && [cfg.visionUrl, ...(cfg.visionAlternates ?? []).map((e) => e.url)].some((u) => supportsPdfNative(u));
  const out = native
    ? await callPdfNative(cfg, PROMPT, buf)
    : await callVisionLLM(cfg, PROMPT, (await renderPage(buf, doc.mimeType, 0)).toString('base64'), 'image/png');
  const { proposal, lineCountMismatch } = proposalFromReread(parseJsonLoose(out.content), doc.items);
  const items = doc.items.map((i) => ({
    rowIndex: i.rowIndex, quantity: n(i.quantity), price: n(i.price), discount: n(i.discount), vatRate: n(i.vatRate), total: n(i.total),
  }));
  const input = proposalInput(proposal, items);
  let closes = totalsClose(input);
  let steps: FixStep[] | undefined;
  let final = proposal;
  // Η νέα ανάγνωση δεν κλείνει μόνη της: περνά από τις ΙΔΙΕΣ ελεγμένες εξηγήσεις (π.χ. η έκπτωση της
  // γραμμής που κανένα μοντέλο δεν γράφει, ή «σύνολο χωρίς το τέλος»). Μόνο ό,τι κλείνει γίνεται δεκτό.
  if (!closes && !lineCountMismatch) {
    const [plan] = totalsPlans(input, 1);
    if (plan) {
      closes = true; steps = plan.steps;
      final = {
        subtotal: n(plan.result.subtotal), vatAmount: n(plan.result.vatAmount),
        otherCharges: n(plan.result.otherCharges), totalAmount: n(plan.result.totalAmount),
        lines: plan.result.items.map((l, i) => ({
          rowIndex: items[i].rowIndex, quantity: n(l.quantity), price: n(l.price), discount: n(l.discount), total: n(l.total), vatRate: n(l.vatRate),
        })),
      };
    }
  }
  return {
    closes, proposal: final, lineCountMismatch, steps,
    message: closes
      ? steps ? 'Η νέα ανάγνωση από το χαρτί, μαζί με την εξήγηση παρακάτω, κλείνει σε όλους τους ελέγχους.' : 'Η νέα ανάγνωση από το χαρτί κλείνει σε όλους τους ελέγχους.'
      : lineCountMismatch
        ? 'Η νέα ανάγνωση βρήκε διαφορετικό αριθμό γραμμών — δεν κλείνει. Έλεγξε τα ποσά χειροκίνητα με το πρωτότυπο.'
        : 'Ούτε η νέα ανάγνωση κλείνει — μάλλον το ίδιο το χαρτί έχει κάτι ιδιαίτερο. Έλεγξε τα ποσά χειροκίνητα με το πρωτότυπο.',
  };
}

/**
 * Εφαρμόζει ποσά ΕΠΙΤΟΠΟΥ: κανονικό JSON (σύνολα + γραμμές) και οι γραμμές της βάσης ανά `rowIndex`
 * — ΧΩΡΙΣ αντικατάσταση γραμμών, ώστε να μη χάνονται αντιστοιχίσεις SoftOne και επιμερισμοί.
 */
export async function applyAmounts(docId: string, p: AmountsProposal, actor: { id: string; email: string } | null, source: string): Promise<void> {
  const doc = await loadDocumentJson(docId);
  const before = { totals: { ...doc.totals }, lines: doc.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, net: l.net, vatRate: l.vatRate })) };
  const next = {
    ...doc,
    totals: { ...doc.totals, net: p.subtotal, vatAmount: p.vatAmount, fees: p.otherCharges, total: p.totalAmount, payable: null, derived: undefined },
    lines: doc.lines.map((l, i) => {
      const x = p.lines.find((y) => y.rowIndex === i);
      return x ? { ...l, quantity: x.quantity, unitPrice: x.price, discount: x.discount, net: x.total, vatRate: x.vatRate } : l;
    }),
  };
  await saveDocumentJson(docId, next, { replaceItems: false });
  for (const x of p.lines) {
    await prisma.ocrInvoiceItem.updateMany({
      where: { documentId: docId, rowIndex: x.rowIndex },
      data: { quantity: x.quantity, price: x.price, discount: x.discount, vatRate: x.vatRate, total: x.total },
    });
  }
  if (actor) {
    await logAudit({
      userId: actor.id, userEmail: actor.email, action: 'ocr.amounts.fix', resource: 'ocr_document', resourceId: docId,
      metadata: { source, before, after: p },
    }).catch(() => null);
  }
}
