// lib/ocr/afm-recovery.ts — SERVER. Ανάκτηση του ΣΩΣΤΟΥ ΑΦΜ εκδότη από το ίδιο το αρχείο.
//
// Η ΙΔΕΑ (του χρήστη): ένα παραστατικό που ανέβηκε έχει ΠΑΝΤΑ σωστό ΑΦΜ τυπωμένο — αν το δικό
// μας δεν περνά τον έλεγχο, το λάθος είναι της ανάγνωσης και η απάντηση βρίσκεται στο αρχείο.
//
// Η ΡΟΗ, τρία στάδια, και ΤΙΠΟΤΑ δεν γράφεται χωρίς το τρίτο:
//   1. ΕΠΑΝΑΓΝΩΣΗ — η πρώτη σελίδα ξαναδιαβάζεται, ρωτώντας ΜΟΝΟ για ΑΦΜ (όχι όλο το τιμολόγιο:
//      μια στοχευμένη ερώτηση δίνει στο μοντέλο λιγότερη ευκαιρία να «διορθώσει» ψηφία).
//   2. ΕΠΙΔΙΟΡΘΩΣΗ — αν η επανάγνωση επιμένει στο λάθος, υποψήφια από τις συγχύσεις του OCR
//      (`afm-repair.ts`). Ο έλεγχος mod-11 περνά ~1 στα 10 τυχαία 9ψήφια, άρα «περνά» ≠ «σωστό».
//   3. ΕΠΙΒΕΒΑΙΩΣΗ ΑΑΔΕ — ένα υποψήφιο γίνεται δεκτό ΜΟΝΟ αν η επωνυμία που επιστρέφει η ΑΑΔΕ
//      ταιριάζει με αυτή του παραστατικού. Υποψήφιο που περνά τον έλεγχο αλλά ανήκει σε άλλη
//      εταιρεία ΑΠΟΡΡΙΠΤΕΤΑΙ — αυτό είναι ακριβώς το λάθος που ένα «αυτόματο» θα έκανε.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { bunnyDownload } from '@/lib/bunny';
import { renderPage } from '@/lib/ocr/rasterize';
import { callVisionLLM, resolveCfg, parseJsonLoose } from '@/lib/ocr/extract';
import { parseAfm2Info } from '@/lib/aade-parse';
import { isValidAfm } from '@/lib/ocr/validate';
import { afmRepairCandidates, namesMatch, withoutRecipient } from '@/lib/ocr/afm-repair';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';
import { buildSoftoneMatch, alignTraderToTarget } from '@/lib/ocr/softone-match';

/** Πόσες κλήσεις ΑΑΔΕ το πολύ ανά παραστατικό — κάθε υποψήφιο είναι μία. */
const MAX_AADE_CHECKS = 15;

export interface RecoveryAttempt { afm: string; source: 'reread' | 'repair'; aadeName: string | null; match: boolean }

export interface RecoveryResult {
  docId: string;
  status: 'confirmed' | 'unconfirmed' | 'unchanged' | 'no_file' | 'no_name';
  /** Το ΑΦΜ που επιβεβαιώθηκε (μόνο σε `confirmed`). */
  afm: string | null;
  aadeName: string | null;
  previousAfm: string | null;
  /** Τι διάβασε η επανάγνωση — φαίνεται ακόμη κι όταν δεν επιβεβαιώθηκε. */
  rereadAfm: string | null;
  tried: RecoveryAttempt[];
  applied: boolean;
  /**
   * ΜΕ ΤΙ συγκρίθηκε η επωνυμία της ΑΑΔΕ:
   *   `stored`  — με την επωνυμία που είχε ΗΔΗ το παραστατικό: ανεξάρτητη απόδειξη.
   *   `reread`  — μόνο με την επωνυμία της ΙΔΙΑΣ επανάγνωσης: αποδεικνύει ότι όνομα και ΑΦΜ
   *               ανήκουν μαζί, ΟΧΙ ότι είναι ο εκδότης αυτού του παραστατικού.
   *   `filename` — το όνομα αρχείου ηλεκτρονικού παραστατικού (`EL{εκδότης}_EL{λήπτης}_…`, η
   *               ονοματολογία του myDATA) λέει ρητά το ίδιο ΑΦΜ: ανεξάρτητη απόδειξη.
   * Πραγματικό παράδειγμα του γιατί: ένα σκανάρισμα με ΔΥΟ αποδείξεις καυσίμων στην ίδια σελίδα
   * (ΜΥΡΤΕΑ + ΚΑΛΥΨΩ). Η επανάγνωση βρήκε σωστά τη ΜΥΡΤΕΑ — και η εφαρμογή θα έκρυβε τη ΚΑΛΥΨΩ.
   */
  evidence: 'stored' | 'filename' | 'reread' | null;
  /** Αν με το σωστό ΑΦΜ βρέθηκε ΗΔΗ καρτέλα στο SoftOne και συνδέθηκε. */
  linkedTrader: { trdr: number; code: string | null; name: string | null } | null;
  /** Η σύνδεση που ΚΑΘΑΡΙΣΤΗΚΕ επειδή η καρτέλα είχε άλλο ΑΦΜ (π.χ. «Thunder Tiger» σε τιμολόγιο της PwC). */
  clearedTrader: { trdr: number; name: string | null; afm: string | null } | null;
  message: string;
}

const REREAD_PROMPT = [
  'Η εικόνα είναι η πρώτη σελίδα ελληνικού εμπορικού παραστατικού (τιμολόγιο, απόδειξη, λογαριασμός).',
  'Βρες τον ΕΚΔΟΤΗ (αυτόν που ΕΚΟΨΕ το παραστατικό — συνήθως το λογότυπο και τα στοιχεία στην κορυφή)',
  'και ΟΛΑ τα ΑΦΜ που είναι τυπωμένα στη σελίδα.',
  'ΠΡΟΣΟΧΗ: ο ΠΑΡΑΛΗΠΤΗΣ/ΠΕΛΑΤΗΣ (ενότητα «Στοιχεία πελάτη», «Προς», «Αγοραστής») ΔΕΝ είναι ο εκδότης — δώσ\' τον χωριστά.',
  'ΑΝΤΕΓΡΑΨΕ ΤΑ ΨΗΦΙΑ ΑΚΡΙΒΩΣ ΟΠΩΣ ΕΙΝΑΙ ΤΥΠΩΜΕΝΑ. ΜΗΝ τα διορθώσεις, ΜΗΝ συμπληρώσεις ψηφία που δεν φαίνονται.',
  'Απάντησε ΜΟΝΟ με JSON: {"issuer_name": "...", "issuer_afm": "...", "recipient_name": "...", "recipient_afm": "...", "all_afms": ["...", "..."]}',
  'Αν κάτι δεν διαβάζεται, βάλε null. Χωρίς markdown, χωρίς εξηγήσεις.',
].join('\n');

async function aadeName(afm: string): Promise<string | null> {
  try {
    const r = await fetch('https://vat.wwa.gr/afm2info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afm }), cache: 'no-store',
    });
    if (!r.ok) return null;
    return parseAfm2Info(await r.json())?.name ?? null;
  } catch { return null; }
}

const digits = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

export async function recoverIssuerAfm(
  docId: string,
  opts: { apply: boolean; force?: boolean; actor?: { id: string; email: string } | null },
): Promise<RecoveryResult> {
  const doc = await prisma.ocrDocument.findUnique({
    where: { id: docId },
    select: { id: true, storageKey: true, mimeType: true, issuerAfm: true, extractedData: true, document: true, fileName: true, softoneTrdr: true },
  });
  const base: Omit<RecoveryResult, 'status' | 'message'> = {
    docId, afm: null, aadeName: null, previousAfm: doc?.issuerAfm ?? null, rereadAfm: null,
    tried: [], applied: false, linkedTrader: null, clearedTrader: null, evidence: null,
  };
  if (!doc) return { ...base, status: 'no_file', message: 'Το παραστατικό δεν βρέθηκε.' };

  const ed = (doc.extractedData ?? {}) as Record<string, unknown>;
  const canon = (doc.document ?? null) as {
    issuer?: { name?: string | null; vat?: string | null };
    recipient?: { name?: string | null; vat?: string | null };
  } | null;
  const storedName = (canon?.issuer?.name ?? (ed.companyName as string | undefined) ?? '').trim() || null;

  // ── 1. Επανάγνωση ────────────────────────────────────────────────────────────────────────
  let reread: { issuer_name?: unknown; issuer_afm?: unknown; recipient_name?: unknown; recipient_afm?: unknown; all_afms?: unknown } = {};
  try {
    const file = await bunnyDownload(doc.storageKey);
    const page = await renderPage(Buffer.isBuffer(file) ? file : Buffer.from(file), doc.mimeType, 0);
    const r = await callVisionLLM(await resolveCfg(), REREAD_PROMPT, page.toString('base64'), 'image/png');
    reread = parseJsonLoose(r.content) ?? {};
  } catch (e) {
    return { ...base, status: 'no_file', message: `Το αρχείο δεν ξαναδιαβάστηκε: ${(e as Error).message}` };
  }
  // Ο παραλήπτης (συνήθως εμείς): από το παραστατικό, από την επανάγνωση και το δικό μας ΑΦΜ.
  const ownAfm = await resolveOwnAfm().catch(() => null);
  const recipientAfms = [canon?.recipient?.vat, ed.customerVatNumber as string | undefined, digits(reread.recipient_afm), ownAfm];
  const recipientNames = [canon?.recipient?.name, ed.customerName as string | undefined, typeof reread.recipient_name === 'string' ? reread.recipient_name : null]
    .filter((n): n is string => !!n && !!n.trim());
  const isRecipientName = (n: string | null | undefined) => !!n && recipientNames.some((r) => namesMatch(r, n));

  const rereadAfmRaw = digits(reread.issuer_afm) || null;
  // Το μοντέλο μπέρδεψε τον παραλήπτη με τον εκδότη: ούτε το ΑΦΜ ούτε η επωνυμία του μετρούν.
  const rereadAfm = rereadAfmRaw && withoutRecipient([rereadAfmRaw], recipientAfms).length ? rereadAfmRaw : null;
  const rereadNameRaw = typeof reread.issuer_name === 'string' ? reread.issuer_name.trim() || null : null;
  const rereadName = isRecipientName(rereadNameRaw) ? null : rereadNameRaw;
  const names = [storedName, rereadName].filter((n): n is string => !!n && !isRecipientName(n));
  if (names.length === 0) {
    return {
      ...base, rereadAfm, status: 'no_name',
      message: rereadNameRaw && !rereadName
        ? `Η επανάγνωση βρήκε μόνο τον παραλήπτη («${rereadNameRaw}») — ο εκδότης δεν διαβάζεται στη σελίδα. Συμπλήρωσε επωνυμία και ΑΦΜ εκδότη από το χαρτί.`
        : 'Δεν υπάρχει επωνυμία εκδότη για να επιβεβαιωθεί το ΑΦΜ στην ΑΑΔΕ.',
    };
  }

  // ── 2. Υποψήφια, με σειρά πιθανότητας ────────────────────────────────────────────────────
  const fromPage = [rereadAfm, ...(Array.isArray(reread.all_afms) ? reread.all_afms.map(digits) : [])]
    .filter((x): x is string => !!x && isValidAfm(x));
  const repaired = [
    ...afmRepairCandidates(doc.issuerAfm ?? ''),
    ...(rereadAfm && !isValidAfm(rereadAfm) ? afmRepairCandidates(rereadAfm) : []),
  ];
  const queue: { afm: string; source: RecoveryAttempt['source'] }[] = [];
  const seen = new Set<string>();
  for (const a of withoutRecipient(fromPage, recipientAfms)) if (!seen.has(a)) { seen.add(a); queue.push({ afm: a, source: 'reread' }); }
  for (const a of withoutRecipient(repaired, recipientAfms)) if (!seen.has(a)) { seen.add(a); queue.push({ afm: a, source: 'repair' }); }

  // ── 3. Επιβεβαίωση ΑΑΔΕ ──────────────────────────────────────────────────────────────────
  const tried: RecoveryAttempt[] = [];
  let hit: RecoveryAttempt | null = null;
  for (const c of queue.slice(0, MAX_AADE_CHECKS)) {
    const n = await aadeName(c.afm);
    // Επωνυμία της ΑΑΔΕ ίδια με του παραλήπτη ⇒ ΔΕΝ είναι ο εκδότης, ό,τι κι αν «ταιριάζει».
    const match = !!n && !isRecipientName(n) && names.some((x) => namesMatch(x, n));
    const att = { ...c, aadeName: n, match };
    tried.push(att);
    if (match) { hit = att; break; }
  }

  if (!hit) {
    return {
      ...base, rereadAfm, tried, status: 'unconfirmed',
      message: tried.length === 0
        ? 'Η επανάγνωση δεν βρήκε κανένα έγκυρο ΑΦΜ και δεν υπάρχουν υποψήφια διόρθωσης.'
        : `Δοκιμάστηκαν ${tried.length} υποψήφια — κανένα δεν αντιστοιχεί στην επωνυμία «${names[0]}» στην ΑΑΔΕ. Χρειάζεται χειροκίνητη διόρθωση.`,
    };
  }
  if (hit.afm === doc.issuerAfm) {
    const r: RecoveryResult = { ...base, rereadAfm, tried, afm: hit.afm, aadeName: hit.aadeName, status: 'unchanged', message: 'Το ΑΦΜ ήταν ήδη σωστό.' };
    // Σωστό ΑΦΜ ΔΕΝ σημαίνει σωστή σύνδεση: ένα τιμολόγιο της PwC ήταν δεμένο στη «Thunder Tiger».
    if (opts.apply) Object.assign(r, await reconcileTraderLink(docId, hit.afm, doc.softoneTrdr));
    return r;
  }

  const fileAfm = /(?:^|\/)EL(\d{9})_EL\d{9}_/.exec(doc.fileName)?.[1] ?? null;
  const evidence: RecoveryResult['evidence'] = storedName && namesMatch(storedName, hit.aadeName) ? 'stored'
    : fileAfm === hit.afm ? 'filename'
      : 'reread';
  const result: RecoveryResult = {
    ...base, rereadAfm, tried, afm: hit.afm, aadeName: hit.aadeName, status: 'confirmed', evidence,
    message: evidence === 'stored'
      ? `Σωστό ΑΦΜ: ${hit.afm} — η ΑΑΔΕ επιβεβαιώνει «${hit.aadeName}».`
      : evidence === 'filename'
        ? `Σωστό ΑΦΜ: ${hit.afm} — το λέει το όνομα αρχείου του ηλεκτρονικού παραστατικού και η ΑΑΔΕ επιβεβαιώνει «${hit.aadeName}».`
      : `Στη σελίδα βρέθηκε «${hit.aadeName}» με ΑΦΜ ${hit.afm}, αλλά το παραστατικό δεν είχε δική του επωνυμία για σύγκριση — έλεγξε το αρχείο πριν το εφαρμόσεις.`,
  };
  // Η αδύναμη απόδειξη ΔΕΝ εφαρμόζεται χωρίς ρητό «ναι, το είδα» (`force`).
  if (!opts.apply || (evidence === 'reread' && !opts.force)) return result;

  // ── Εφαρμογή: και στις τρεις θέσεις όπου ζει το ΑΦΜ ──────────────────────────────────────
  // Αν διορθωνόταν μόνο το `issuerAfm`, το κανονικό JSON και τα extracted θα έλεγαν άλλο ΑΦΜ —
  // και η επόμενη αποθήκευση από τη φόρμα θα ξανάγραφε το λάθος.
  const nextDocument = canon ? { ...canon, issuer: { ...(canon.issuer ?? {}), vat: hit.afm } } : undefined;
  await prisma.ocrDocument.update({
    where: { id: docId },
    data: {
      issuerAfm: hit.afm,
      extractedData: { ...ed, vatNumber: hit.afm } as never,
      ...(nextDocument ? { document: nextDocument as never } : {}),
    },
  });

  Object.assign(result, await reconcileTraderLink(docId, hit.afm, doc.softoneTrdr));
  if (result.linkedTrader) result.message += ` Συνδέθηκε με την καρτέλα ${result.linkedTrader.code ?? result.linkedTrader.trdr}.`;
  if (result.clearedTrader) result.message += ` Καθαρίστηκε λάθος σύνδεση με «${result.clearedTrader.name}».`;
  result.applied = true;

  if (opts.actor) {
    await logAudit({
      userId: opts.actor.id, userEmail: opts.actor.email,
      action: 'ocr.afm.recover', resource: 'ocr_document', resourceId: docId,
      metadata: { from: doc.issuerAfm, to: hit.afm, aadeName: hit.aadeName, source: hit.source, tried: tried.length },
    }).catch(() => null);
  }
  return result;
}

const afmKey = (v: string | null | undefined) =>
  String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^(EL|GR)(?=\d{9}$)/, '');

/**
 * Η σύνδεση του παραστατικού με καρτέλα, ξανά, με το ΣΩΣΤΟ ΑΦΜ.
 *
 * Υπάρχει καρτέλα με αυτό το ΑΦΜ → συνδέεται (με τον τύπο που ζητά η σειρά). Δεν υπάρχει → η
 * τωρινή σύνδεση μένει ΜΟΝΟ αν η καρτέλα της έχει το ίδιο ΑΦΜ· αλλιώς καθαρίζει. Ένα ασύνδετο
 * παραστατικό φαίνεται στην ουρά και λύνεται· ένα λάθος δεμένο περνά απαρατήρητο ως την ανάρτηση.
 */
async function reconcileTraderLink(
  docId: string, afm: string, currentTrdr: number | null,
): Promise<Pick<RecoveryResult, 'linkedTrader' | 'clearedTrader'>> {
  const m = await buildSoftoneMatch(afm);
  if (m.softoneTrdr != null) {
    await prisma.ocrDocument.update({ where: { id: docId }, data: m });
    await alignTraderToTarget(docId);
    const now = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { softoneTrdr: true, softoneCode: true, softoneName: true } });
    return { linkedTrader: { trdr: now?.softoneTrdr ?? m.softoneTrdr, code: now?.softoneCode ?? m.softoneCode, name: now?.softoneName ?? m.softoneName }, clearedTrader: null };
  }
  if (currentTrdr == null) return { linkedTrader: null, clearedTrader: null };
  const cur = await prisma.softoneTrader.findUnique({ where: { trdr: currentTrdr }, select: { trdr: true, name: true, afm: true } });
  if (cur && afmKey(cur.afm) === afmKey(afm)) return { linkedTrader: null, clearedTrader: null };
  await prisma.ocrDocument.update({
    where: { id: docId },
    data: { softoneTrdr: null, softoneCode: null, softoneName: null, softoneKind: null, softoneChecked: new Date() },
  });
  return { linkedTrader: null, clearedTrader: { trdr: currentTrdr, name: cur?.name ?? null, afm: cur?.afm ?? null } };
}
