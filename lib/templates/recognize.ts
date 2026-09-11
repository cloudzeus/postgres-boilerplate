// lib/templates/recognize.ts — SERVER. «Ποιο πρότυπο είναι αυτό το έγγραφο;» (spec §14.7).
//
// Η κανονική απάντηση είναι το ΑΦΜ του εκδότη. Όταν δεν υπάρχει — νέος προμηθευτής, ΑΦΜ που το OCR
// διάβασε λάθος, έντυπο χωρίς ΑΦΜ — το μόνο που μένει είναι το πώς ΜΟΙΑΖΕΙ η σελίδα: η τυπωμένη
// επωνυμία και το λεξιλόγιο του εντύπου, δηλαδή το αποτύπωμα που κρατούν ήδη τα δείγματα.
//
// Τίποτα από αυτά δεν κοστίζει κλήση μοντέλου. ΜΟΝΟ η ισοπαλία κοστίζει: όταν δύο πρότυπα μοιάζουν
// εξίσου, ρωτιέται μία φορά το μοντέλο κειμένου — ακριβώς όπως κάνει ο ταξινομητής σειράς
// (`lib/ocr/doc-type.ts`), και με την ίδια πτώση στο vision endpoint όταν λείπει το κλειδί κειμένου.
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { callTextLLM, callTextViaVision, resolveCfg } from '@/lib/ocr/extract';
import {
  AMBIGUITY_GAP, MATCH_THRESHOLD, buildFingerprint, isEmptyFingerprint, rankTemplates, toFingerprint,
  type Fingerprint,
} from './fingerprint';
import { findTemplateForVat } from './match-vat';

/** Πώς βρέθηκε το πρότυπο — μπαίνει στα flags της εκτέλεσης, ώστε να φαίνεται αν το «μάντεψε». */
export type RecognizedBy = 'vat' | 'similarity' | 'model';
export type Recognition = { templateId: string; by: RecognizedBy; score: number | null };

/** Πόσες λέξεις του αποτυπώματος δείχνουμε στο μοντέλο ανά υποψήφιο — αρκετές για να διαλέξει, όχι τόσες που να κοστίζουν. */
const TIE_WORDS = 30;
/**
 * Πόσοι χαρακτήρες ονόματος εκδότη μπαίνουν στο prompt. Το όνομα έρχεται από το OCR ενός αρχείου που
 * ανέβασε κάποιος — δηλαδή είναι κείμενο τρίτου μέσα σε οδηγία προς μοντέλο. Κόβεται, ώστε μια
 * «επωνυμία» δύο σελίδων να μην μπορεί να πνίξει τη λίστα των υποψηφίων που ακολουθεί.
 */
const ISSUER_CHARS = 120;

type DocRow = { issuerAfm: string | null; rawText: string | null; document: Prisma.JsonValue | null };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Το αποτύπωμα ενός σαρωμένου εγγράφου, από όσα ΕΧΕΙ ήδη το OCR.
 *
 * Δύο συνειδητές παραλείψεις: (α) ο λόγος πλευρών λείπει, γιατί θα απαιτούσε κατέβασμα του αρχείου
 * από το Bunny μόνο και μόνο για να μετρηθεί — το `similarity` μοιράζει το βάρος του στα υπόλοιπα
 * μέρη, οπότε η σύγκριση παραμένει σωστή· (β) το `rawText` υπάρχει μόνο για ψηφιακά PDF, άρα για
 * μια σάρωση η αναγνώριση στηρίζεται στην επωνυμία του εκδότη και μόνο. Και τα δύο είναι «λιγότερη
 * πληροφορία», όχι «λάθος πληροφορία»: το χειρότερο που παθαίνει ένα έγγραφο είναι να μείνει
 * «άγνωστο έντυπο» και να το διαλέξει άνθρωπος.
 */
function documentFingerprint(doc: DocRow, vatHint?: unknown): Fingerprint {
  const issuer = isRecord(doc.document) && isRecord(doc.document.issuer) ? doc.document.issuer : {};
  return buildFingerprint({
    issuerName: typeof issuer.name === 'string' ? issuer.name : null,
    afm: vatHint ?? doc.issuerAfm ?? issuer.vat ?? null,
    text: doc.rawText,
    aspect: null,
  });
}

/** Τα αποτυπώματα κάθε ενεργού προτύπου: το δικό του (κύριο δείγμα) μαζί με όσα έχουν τα δείγματά του. */
async function activeCandidates(): Promise<{ templateId: string; name: string; fingerprints: (Fingerprint | null)[] }[]> {
  const rows = await prisma.extractionTemplate.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, fingerprint: true, samples: { select: { fingerprint: true } } },
  });
  return rows.map((t) => ({
    templateId: t.id,
    name: t.name,
    fingerprints: [toFingerprint(t.fingerprint), ...t.samples.map((s) => toFingerprint(s.fingerprint))],
  }));
}

/**
 * Το πρότυπο αυτού του εγγράφου, ή `null` όταν κανένα δεν του μοιάζει αρκετά.
 * Καμία παρενέργεια: ο καλών αποφασίζει τι κάνει με ένα «δεν ξέρω» (βλ. `markUnknownForm`).
 */
export async function recognizeTemplate(documentId: string, vatHint?: unknown): Promise<Recognition | null> {
  // 1 — Το ΑΦΜ. Ρητή δήλωση του χρήστη ότι «αυτός ο εκδότης διαβάζεται με αυτό το πρότυπο»· καμία
  // ομοιότητα δεν το ανατρέπει.
  const byVat = await findTemplateForVat(vatHint);
  if (byVat) return { templateId: byVat, by: 'vat', score: null };

  const doc = await prisma.ocrDocument.findUnique({
    where: { id: documentId },
    select: { issuerAfm: true, rawText: true, document: true },
  });
  if (!doc) return null;

  // Ο καλών δίνει το ΑΦΜ που μόλις διάβασε· το αποθηκευμένο `issuerAfm` μπορεί να είναι άλλο (μια
  // προηγούμενη σάρωση, μια διόρθωση ανθρώπου). Και τα δύο μετράνε ως ρητή δήλωση.
  const byStoredVat = await findTemplateForVat(doc.issuerAfm);
  if (byStoredVat) return { templateId: byStoredVat, by: 'vat', score: null };

  // 2 — Η διάταξη.
  const fp = documentFingerprint(doc, vatHint);
  if (isEmptyFingerprint(fp)) return null;
  const candidates = await activeCandidates();
  const ranked = rankTemplates(fp, candidates);
  const best = ranked[0];
  if (!best || best.score < MATCH_THRESHOLD) return null;

  // Ένας καθαρός νικητής: κανείς δεν τον πλησιάζει μέσα στο περιθώριο ασάφειας.
  const tied = ranked.filter((r) => r.score >= MATCH_THRESHOLD && best.score - r.score < AMBIGUITY_GAP);
  if (tied.length === 1) return { templateId: best.templateId, by: 'similarity', score: best.score };

  // 3 — Ισοπαλία: ΜΙΑ ερώτηση στο μοντέλο κειμένου. Αν δεν απαντήσει κάτι που αναγνωρίζουμε, το
  // έγγραφο μένει άγνωστο — ένα «μισό» πρότυπο διαλεγμένο στην τύχη είναι χειρότερο από κανένα,
  // γιατί θα γράψει λάθος τιμές πάνω στο έγγραφο και κανείς δεν θα ξέρει γιατί.
  const byId = new Map(candidates.map((c) => [c.templateId, c]));
  const picked = await modelTieBreak(documentId, fp, tied.map((t) => byId.get(t.templateId)).filter((c): c is NonNullable<typeof c> => !!c))
    .catch((e) => { console.error('[templates] recognise tie-break failed', documentId, (e as Error).message); return null; });
  return picked ? { templateId: picked, by: 'model', score: best.score } : null;
}

async function modelTieBreak(
  documentId: string,
  fp: Fingerprint,
  options: { templateId: string; name: string; fingerprints: (Fingerprint | null)[] }[],
): Promise<string | null> {
  if (options.length < 2) return null;
  const cfg = await resolveCfg();
  const list = options.map((o) => {
    const words = [...new Set(o.fingerprints.flatMap((f) => f?.words ?? []))].slice(0, TIE_WORDS);
    const issuer = (o.fingerprints.find((f) => f?.issuer)?.issuer ?? '').slice(0, ISSUER_CHARS);
    return `${o.templateId} — «${o.name}» · εκδότης: ${issuer} · λέξεις: ${words.join(', ')}`;
  }).join('\n');
  const system = 'You match a Greek business document to ONE document template by its printed layout. '
    + 'Answer with JSON only: {"templateId":"<id exactly as listed>"}.';
  const user = `Document issuer: «${(fp.issuer ?? '').slice(0, ISSUER_CHARS)}»\nDocument words: ${fp.words.slice(0, TIE_WORDS).join(', ')}\n\n`
    + `Templates:\n${list}\n\nReply {"templateId":"<id>"}.`;
  const usage = { operation: 'template.recognize', refType: 'OcrDocument', refId: documentId };

  // Ίδιο μοτίβο με τον ταξινομητή σειράς: αν λείπει/πέφτει το κλειδί κειμένου, η ίδια κλήση πάει
  // text-only στο vision endpoint — χωρίς `response_format`, γι' αυτό και το regex από κάτω.
  let out: { content: string } | null = null;
  if (cfg.textKey) {
    try { out = await callTextLLM(cfg, system, user, usage); }
    catch (e) { console.warn('[templates] text model unavailable, using vision model', (e as Error).message); }
  }
  if (!out) out = await callTextViaVision(cfg, system, user, usage);

  const raw = String(out?.content ?? '');
  let answer: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { templateId?: unknown };
    if (parsed && parsed.templateId != null) answer = String(parsed.templateId).trim();
  } catch {
    answer = raw.trim();
  }
  // Δεκτό ΜΟΝΟ ένα id που όντως ήταν στη λίστα — ποτέ ό,τι φαντάστηκε το μοντέλο.
  return options.find((o) => o.templateId === answer)?.templateId
    ?? options.find((o) => answer?.includes(o.templateId))?.templateId
    ?? null;
}

/**
 * «Δεν ξέρω τι έντυπο είναι αυτό». Μπαίνει ΔΙΠΛΑ στα υπάρχοντα `reviewFlags`, ποτέ πάνω τους: ένα
 * έγγραφο που ξανασαρώθηκε κρατά τους λόγους που το μπλόκαραν την προηγούμενη φορά.
 * Καθαρίζεται μόνο του μόλις τρέξει πρότυπο (ο runner ξαναγράφει ολόκληρα τα `reviewFlags`).
 */
export async function markUnknownForm(documentId: string): Promise<void> {
  try {
    const doc = await prisma.ocrDocument.findUnique({ where: { id: documentId }, select: { reviewFlags: true } });
    if (!doc) return;
    const prev = isRecord(doc.reviewFlags) ? doc.reviewFlags : {};
    if (prev.unknownForm === true) return;
    await prisma.ocrDocument.update({
      where: { id: documentId },
      data: { reviewFlags: { ...prev, unknownForm: true } as unknown as Prisma.InputJsonValue },
    });
  } catch (e) {
    console.error('[templates] unknown-form flag not stored', documentId, (e as Error).message);
  }
}
