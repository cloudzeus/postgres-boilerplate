// SERVER: επανασάρωση ενός παραστατικού — ο πυρήνας της `/api/admin/ocr/[id]/reextract`.
//
// Βγήκε από το route ώστε η ΜΑΖΙΚΗ επανασάρωση («εφάρμοσε τους νέους κανόνες σε όσα έχουμε») να
// κάνει ΑΚΡΙΒΩΣ ό,τι και το κουμπί του παραστατικού — ίδιο μοντέλο, ίδια διατήρηση αντιστοιχίσεων,
// ίδιο ιστορικό — και να ξέρει ΠΟΙΑ ΔΕΝ πρέπει να ξαναδιαβαστούν (`rescanEligibility`).
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { bunnyDownload } from '@/lib/bunny';
import { extractDocument, UPGRADED_VISION_MODEL } from '@/lib/ocr/extract';
import { buildSoftoneMatch, matchDocItems, buildDuplicateCheck } from '@/lib/ocr/softone-match';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { runMatchingTemplate } from '@/lib/templates/run';
import { classifyDocument } from '@/lib/ocr/doc-type';
import { docTypeFromKind, type DocumentJson } from '@/lib/ocr/canonical';
import type { ExtractDocType } from '@/lib/ocr/templates';
import { loadIssuerExample } from '@/lib/ocr/example-lookup';
import { normalizeAfm } from '@/lib/ocr/validate';
import { totalsClose } from '@/lib/ocr/invoice-math';
import type { RunOutcome } from '@/lib/templates/schema';
import { HAND_EDIT_ACTIONS, acceptReading, carryDecisions, rescanSkipReason, type RescanFacts } from '@/lib/ocr/rescan-eligibility';

export class ReextractError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Σύνοψη μιας ανάγνωσης για τη σύγκριση «πριν → μετά» στο UI. */
export function readingSummary(d: DocumentJson | null) {
  if (!d) return null;
  const sumLines = Math.round(d.lines.reduce((t, l) => t + (l.net ?? 0), 0) * 100) / 100;
  return {
    lines: d.lines.length, sumLines, net: d.totals.net, vat: d.totals.vatAmount, total: d.totals.total,
    issuer: d.issuer.name, afm: d.issuer.vat, number: d.type.number, date: d.date,
    closes: totalsClose({
      items: d.lines.map((l) => ({ quantity: l.quantity, price: l.unitPrice, discount: l.discount, vatRate: l.vatRate, total: l.net })),
      subtotal: d.totals.net, vatAmount: d.totals.vatAmount, otherCharges: d.totals.fees, totalAmount: d.totals.total,
    }),
  };
}

export type ReextractResult = {
  model: string; data: unknown;
  before: ReturnType<typeof readingSummary>; after: ReturnType<typeof readingSummary>;
  templateRun: RunOutcome | null;
};

/**
 * ΕΠΑΝΑΣΑΡΩΣΗ: ξαναδιαβάζει το αρχείο από την αρχή με την τρέχουσα έκδοση της εφαρμογής (οδηγίες
 * ανάγνωσης, κανόνες) και το ισχυρότερο μοντέλο — για όταν η πρώτη ανάγνωση έχασε κάτι.
 *
 * ΤΙ ΚΡΑΤΙΕΤΑΙ (δουλειά χεριού): η σειρά που διάλεξε ο χρήστης, ο συναλλασσόμενος αν ο ΑΦΜ δεν
 * άλλαξε, η κατηγορία, και ανά γραμμή η αντιστοίχιση SoftOne και τα αναλυτικά (ίδιος κωδικός/
 * περιγραφή). ΤΙ ΧΑΝΕΤΑΙ: οι χειροκίνητες διορθώσεις πεδίων/γραμμών και οι επιμερισμοί — το λέει
 * το παράθυρο πριν από το κλικ. Καταχωρισμένο παραστατικό ΔΕΝ ξαναδιαβάζεται.
 */
export async function reextractDocument(
  id: string,
  docType: ExtractDocType,
  actor: { id: string; email: string },
  /** `minModel`: κατώτατο μοντέλο που γίνεται δεκτό (πάνω από αυτό της παλιάς ανάγνωσης). */
  opts: { source?: 'single' | 'bulk'; minModel?: string } = {},
): Promise<ReextractResult> {
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) throw new ReextractError(404, 'not_found', 'Το παραστατικό δεν βρέθηκε.');
  if (doc.postStatus === 'POSTED') {
    throw new ReextractError(409, 'posted', 'Το παραστατικό έχει καταχωριστεί στη SoftOne — δεν ξαναδιαβάζεται. Αν η καταχώριση ήταν λάθος, ακύρωσέ την πρώτα στη SoftOne.');
  }
  if (doc.postStatus === 'PENDING' || doc.status === 'PROCESSING') {
    throw new ReextractError(409, 'busy', 'Το παραστατικό επεξεργάζεται αυτή τη στιγμή — δοκίμασε σε λίγο.');
  }
  const before = await loadDocumentJson(id).catch(() => null);

  // Flag as PROCESSING immediately so the UI can render a progress bar while
  // we hit the LLM. Returns to COMPLETED / FAILED below in the same request.
  await prisma.ocrDocument.update({ where: { id }, data: { status: 'PROCESSING', errorMessage: null } });

  let vat: unknown = null;
  let ok: Omit<ReextractResult, 'templateRun'> | null = null;
  let failure: string | null = null;

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const result = await extractDocument({
      buffer,
      mimeType: doc.mimeType,
      docType,
      language: doc.language as never,
      pdfSource: doc.mimeType === 'application/pdf' ? 'scanned' : undefined,
      // ΕΔΩ, και μόνο εδώ, το παράδειγμα είναι δωρεάν: το έγγραφο κουβαλάει ήδη το ΑΦΜ του εκδότη
      // από την πρώτη ανάγνωση, οπότε βρίσκουμε το επιβεβαιωμένο «αδελφάκι» του χωρίς δεύτερη
      // κλήση στο μοντέλο. Σε νέο ανέβασμα ο εκδότης είναι άγνωστος μέχρι να διαβαστεί η σελίδα.
      example: await loadIssuerExample(doc.issuerAfm, { excludeId: id }),
      // Ισχυρότερο μοντέλο ΜΟΝΟ για αυτή την κλήση (όχι αλλαγή της γενικής ρύθμισης).
      visionModel: UPGRADED_VISION_MODEL,
    });

    // ΠΟΤΕ ΥΠΟΒΑΘΜΙΣΗ: αν το ισχυρό μοντέλο δεν ήταν διαθέσιμο και η εφεδρεία διάβασε με ασθενέστερο
    // από την παλιά ανάγνωση, η παλιά μένει (βλ. `acceptReading`).
    const floor = opts.minModel && !acceptReading(opts.minModel, doc.model) ? opts.minModel : doc.model;
    if ((before || opts.minModel) && !acceptReading(floor, result.model)) {
      throw new Error(`Το ισχυρό μοντέλο ανάγνωσης δεν ήταν διαθέσιμο (διάβασε το εφεδρικό ${result.model}, ασθενέστερο από το ${floor}) — π.χ. τελείωσαν οι μονάδες του παρόχου. Δοκίμασε ξανά αργότερα.`);
    }

    // ΣΥΝΑΛΛΑΣΣΟΜΕΝΟΣ: αν ο ΑΦΜ δεν άλλαξε και υπάρχει ήδη καρτέλα (ίσως διαλεγμένη με το χέρι),
    // μένει. Νέα αντιστοίχιση μόνο όταν η νέα ανάγνωση βρήκε ΑΛΛΟΝ εκδότη.
    const sameIssuer = doc.softoneTrdr != null && normalizeAfm(result.document.issuer.vat) === doc.issuerAfm;
    const softone = sameIssuer ? {} : await buildSoftoneMatch(result.document.issuer.vat);

    // ΑΠΟΦΑΣΕΙΣ, όχι ανάγνωση: η σύνδεση πιστωτικού με το αρχικό και η απόφαση για την παρακράτηση
    // τις πήρε άνθρωπος — μια νέα ανάγνωση του ΙΔΙΟΥ χαρτιού δεν τις ακυρώνει.
    const next = carryDecisions(before, result.document);

    // Ο ΕΝΑΣ γραφέας: κανονικό έγγραφο + παράγωγα + γραμμές. Οι γραμμές ξαναχτίζονται κρατώντας
    // αντιστοίχιση SoftOne και αναλυτικά της παλιάς γραμμής με ίδιο κωδικό/περιγραφή.
    await saveDocumentJson(id, next, { replaceItems: true });

    await prisma.ocrDocument.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        // Το είδος ξανακρίνεται από την ίδια την ανάγνωση (βλ. upload route).
        docType: docTypeFromKind(result.document.kind),
        rawText: result.rawText,
        model: result.model,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
        completedAt: new Date(),
        errorMessage: null,
        // Η ανάγνωση άλλαξε: η «επιβεβαίωση» αφορούσε την παλιά.
        verifiedAt: null,
        verifiedById: null,
        ...softone,
      },
    });

    await matchDocItems(id).catch(() => null);
    const trdr = (softone as { softoneTrdr?: number | null }).softoneTrdr ?? (sameIssuer ? doc.softoneTrdr : null);
    if (trdr) {
      const dup = await buildDuplicateCheck(trdr, result.document.type, result.document.date);
      await prisma.ocrDocument.update({ where: { id }, data: dup }).catch(() => null);
    }
    // Σειρά παραστατικού — ποτέ πάνω από χειροκίνητη επιλογή.
    await classifyDocument(id);

    vat = result.document.issuer.vat;
    ok = { model: result.model, data: result.data, before: readingSummary(before), after: readingSummary(result.document) };
  } catch (err) {
    // Η ΠΑΛΙΑ ανάγνωση είναι ακόμη στη θέση της (δεν γράφτηκε τίποτα): το έγγραφο επιστρέφει
    // ΟΛΟΚΛΗΡΩΜΕΝΟ, όχι «Απέτυχε» — μια αποτυχημένη δεύτερη γνώμη δεν ακυρώνει την πρώτη.
    failure = String((err as Error)?.message ?? err);
    await prisma.ocrDocument.update({
      where: { id },
      data: before ? { status: 'COMPLETED', errorMessage: null } : { status: 'FAILED', errorMessage: failure.slice(0, 2000) },
    });
  }

  await logAudit({
    userId: actor.id, userEmail: actor.email, action: 'ocr.reextract', resource: 'ocr_document', resourceId: id,
    metadata: { docType, source: opts.source ?? 'single', ok: !!ok, error: failure?.slice(0, 300) ?? null, before: ok?.before ?? readingSummary(before), after: ok?.after ?? null },
  }).catch(() => null);

  if (!ok) throw new ReextractError(422, 'reextract_failed', `Η επανασάρωση απέτυχε — η προηγούμενη ανάγνωση έμεινε ως είχε. (${failure?.slice(0, 200)})`);

  // Extraction template linked to this issuer (spec §15.1). Best-effort; failures become a FAILED run.
  const templateRun: RunOutcome | null = await runMatchingTemplate(id, vat, 'reextract');
  return { ...ok, templateRun };
}

/**
 * Ποια από τα `ids` ξαναδιαβάζονται με ασφάλεια, και γιατί ΟΧΙ τα υπόλοιπα. Μόνο ανάγνωση.
 * Η κρίση ζει στο καθαρό `rescanSkipReason` — εδώ μαζεύονται τα γεγονότα.
 */
export async function rescanEligibility(ids: readonly string[]) {
  const docs = await prisma.ocrDocument.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, status: true, postStatus: true, verifiedAt: true, softoneName: true, issuerAfm: true,
      document: true,
      items: { select: { _count: { select: { allocations: true } } } },
    },
  });
  const edits = await prisma.auditLog.findMany({
    where: { resourceId: { in: docs.map((d) => d.id) }, action: { in: [...HAND_EDIT_ACTIONS] } },
    select: { resourceId: true, createdAt: true },
  });
  const reextracts = await prisma.auditLog.findMany({
    where: { resourceId: { in: docs.map((d) => d.id) }, action: 'ocr.reextract' },
    select: { resourceId: true, createdAt: true },
  });
  const lastOf = (rows: { resourceId: string | null; createdAt: Date }[]) => {
    const m = new Map<string, Date>();
    for (const r of rows) if (r.resourceId && (!m.get(r.resourceId) || r.createdAt > m.get(r.resourceId)!)) m.set(r.resourceId, r.createdAt);
    return m;
  };
  const lastEdit = lastOf(edits), lastReextract = lastOf(reextracts);
  return docs.map((d) => {
    const dj = d.document as { type?: { number?: string | null }; issuer?: { name?: string | null } } | null;
    const facts: RescanFacts = {
      status: d.status, postStatus: d.postStatus, verified: d.verifiedAt != null,
      // Μια χειροκίνητη διόρθωση ΜΕΤΑ την τελευταία επανασάρωση θα χανόταν.
      handEdited: (() => { const e = lastEdit.get(d.id); const r = lastReextract.get(d.id); return !!e && (!r || e > r); })(),
      allocations: d.items.reduce((t, i) => t + i._count.allocations, 0),
    };
    return {
      id: d.id,
      label: `${d.softoneName ?? dj?.issuer?.name ?? d.issuerAfm ?? 'Παραστατικό'}${dj?.type?.number ? ` · ${dj.type.number}` : ''}`,
      skip: rescanSkipReason(facts),
    };
  });
}
