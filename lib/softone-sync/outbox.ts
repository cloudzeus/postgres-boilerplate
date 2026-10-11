// lib/softone-sync/outbox.ts — SERVER. Η ΟΥΡΑ εγγραφών προς το SoftOne.
//
// ΤΙ ΛΥΝΕΙ. Όταν πέφτει η σύνδεση με το ERP, η δουλειά του χρήστη χανόταν: πατούσε
// «Δημιουργία συναλλασσομένου», έπαιρνε ένα τεχνικό μήνυμα, και η μόνη επιλογή ήταν να
// ξαναπροσπαθήσει αργότερα — θυμούμενος μόνος του τι είχε μείνει στη μέση. Τώρα η εργασία
// μπαίνει σε σειρά και φεύγει μόλις ξανασυνδεθούμε.
//
// ────────────────────────────────────────────────────────────────────────────────────────
// Ο ΚΑΝΟΝΑΣ ΠΟΥ ΔΕΝ ΣΠΑΕΙ: ΠΟΤΕ ΑΥΤΟΜΑΤΗ ΕΠΑΝΑΛΗΨΗ ΧΩΡΙΣ ΒΕΒΑΙΟΤΗΤΑ.
//
// Μια ουρά που ξαναστέλνει ό,τι απέτυχε είναι ΕΠΙΚΙΝΔΥΝΗ σε ERP: αν το αίτημα είχε φτάσει και
// χάθηκε μόνο η απάντηση, η δεύτερη `setData` φτιάχνει ΔΕΥΤΕΡΟ συναλλασσόμενο ή ΔΕΥΤΕΡΟ
// παραστατικό — και κανείς δεν το καταλαβαίνει μέχρι το κλείσιμο.
//
// Γι' αυτό κάθε αποτυχία ταξινομείται σε δύο, όχι σε μία:
//   • `not_sent` → ΞΕΡΟΥΜΕ ότι δεν εκτελέστηκε (DNS, άρνηση σύνδεσης, HTTP 404/502/503/504).
//                  Μένει `PENDING` και ξαναφεύγει μόνη της.
//   • `unknown`  → ΜΠΟΡΕΙ να εκτελέστηκε (διακοπή εν πτήσει, HTTP 500, σώμα που δεν διαβάζεται).
//                  Γίνεται `NEEDS_REVIEW` και περιμένει ΑΝΘΡΩΠΟ. Ποτέ αυτόματη επανάληψη.
//
// Και ένας δεύτερος κανόνας: εργασία φτιαγμένη για ΑΛΛΗ εγκατάσταση δεν εκτελείται ποτέ. Τα ids
// μέσα της (TRDR, MTRL, σειρές) δεν σημαίνουν τίποτα αλλού — βλ. `connection.ts`.
// ────────────────────────────────────────────────────────────────────────────────────────
import 'server-only';
import { prisma } from '@/lib/db';
import { SoftoneOutboxStatus, type SoftoneOutbox } from '@prisma/client';
import { softoneCall, SoftoneError, SoftoneTransportError, SoftoneConfigError } from '@/lib/softone';
import { knownTenantKey, softoneReachable } from './connection';
import { OUTBOX_JOBS } from './outbox-jobs';

export interface EnqueueInput {
  /** Τεχνικό είδος εργασίας, π.χ. «trader.create». Ορίζει πώς διαβάζεται το αποτέλεσμα. */
  kind: string;
  /** Τι βλέπει ο χρήστης στη λίστα αναμονής, π.χ. «Πιστωτής Χ.ΒΑΡΕΛΑΣ ΕΕ (801300672)». */
  label: string;
  /** Η υπηρεσία SoftOne — σχεδόν πάντα «setData». */
  service: string;
  /** Το ΑΚΡΙΒΕΣ σώμα της κλήσης, χωρίς `clientID`/`appId` (τα βάζει το `softoneCall`). */
  payload: Record<string, unknown>;
  /** Σταθερό κλειδί για την ίδια λογική εργασία: δεύτερο πάτημα δεν γεννά δεύτερη εγγραφή. */
  idempotencyKey: string;
  userId?: string | null;
}

export type SendOutcome =
  | { status: 'sent'; result: Record<string, unknown> }
  /** Δεν έφυγε, αλλά ΔΕΝ εκτελέστηκε τίποτα — είναι σε σειρά και θα φύγει μόνη της. */
  | { status: 'queued'; reason: string }
  /** Το SoftOne την απέρριψε για επιχειρησιακό λόγο: η επανάληψη δεν θα βοηθήσει. */
  | { status: 'rejected'; message: string }
  /** Άγνωστη έκβαση: ΙΣΩΣ εκτελέστηκε. Θέλει ανθρώπινο έλεγχο στο ERP. */
  | { status: 'needs_review'; message: string };

/**
 * Βάζει την εργασία στην ουρά ΚΑΙ προσπαθεί αμέσως.
 *
 * Η σειρά έχει σημασία: γράφουμε ΠΡΩΤΑ στη βάση και στέλνουμε ΜΕΤΑ. Αν στέλναμε πρώτα και η
 * διεργασία πέθαινε στο ενδιάμεσο, η εργασία δεν θα υπήρχε πουθενά — ακριβώς το πρόβλημα που
 * ήρθαμε να λύσουμε.
 */
export async function enqueueAndSend(input: EnqueueInput): Promise<SendOutcome & { id: string }> {
  const tenantKey = (await knownTenantKey()) ?? 'unknown';

  // Ίδιο `idempotencyKey` = η ίδια εργασία. Αν έχει ήδη σταλεί, επιστρέφουμε το ΙΔΙΟ αποτέλεσμα
  // αντί να τη στείλουμε δεύτερη φορά.
  const existing = await prisma.softoneOutbox.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.status === SoftoneOutboxStatus.SENT) {
    return { id: existing.id, status: 'sent', result: (existing.result ?? {}) as Record<string, unknown> };
  }
  if (existing?.status === SoftoneOutboxStatus.NEEDS_REVIEW) {
    return { id: existing.id, status: 'needs_review', message: existing.lastError ?? 'Εκκρεμεί έλεγχος στο SoftOne.' };
  }

  const item = existing
    ? await prisma.softoneOutbox.update({
      where: { id: existing.id },
      data: { label: input.label, payload: input.payload as never, status: SoftoneOutboxStatus.PENDING },
    })
    : await prisma.softoneOutbox.create({
      data: {
        tenantKey, kind: input.kind, label: input.label, service: input.service,
        payload: input.payload as never, idempotencyKey: input.idempotencyKey,
        createdById: input.userId ?? null,
      },
    });

  const outcome = await sendItem(item);
  return { id: item.id, ...outcome };
}

/**
 * Στέλνει ΜΙΑ εργασία και γράφει την έκβαση. Δεν πετάει ποτέ: κάθε δρόμος καταλήγει σε
 * κατάσταση που ο χρήστης μπορεί να διαβάσει.
 */
export async function sendItem(item: SoftoneOutbox): Promise<SendOutcome> {
  const current = await knownTenantKey();
  if (current && item.tenantKey !== 'unknown' && item.tenantKey !== current) {
    const message = 'Η εργασία φτιάχτηκε για ΑΛΛΗ εγκατάσταση SoftOne και δεν εκτελείται εδώ.';
    await prisma.softoneOutbox.update({
      where: { id: item.id },
      data: { status: SoftoneOutboxStatus.NEEDS_REVIEW, lastError: message },
    });
    return { status: 'needs_review', message };
  }

  let res: { success?: boolean; error?: string; errorcode?: number };
  try {
    // Εργασία με ΟΝΟΜΑ εκτελεί την πλήρη λογική της (βλ. `outbox-jobs.ts`)· οτιδήποτε άλλο
    // είναι μια ωμή κλήση υπηρεσίας.
    const job = OUTBOX_JOBS[item.kind];
    res = job
      ? await job(item.payload as Record<string, unknown>)
      : await softoneCall(item.service, item.payload as Record<string, unknown>);
  } catch (e) {
    if (e instanceof SoftoneConfigError || (e instanceof SoftoneTransportError && e.phase === 'not_sent')) {
      // Σίγουρα δεν εκτελέστηκε: μένει στην ουρά και φεύγει στην επανασύνδεση.
      await prisma.softoneOutbox.update({
        where: { id: item.id },
        data: { status: SoftoneOutboxStatus.PENDING, attempts: { increment: 1 }, lastError: (e as Error).message },
      });
      return { status: 'queued', reason: (e as Error).message };
    }
    // Το ERP ΑΠΑΝΤΗΣΕ και απέρριψε (λείπει πεδίο, πιασμένος κωδικός, δικαιώματα): δεν γράφτηκε
    // τίποτα και η ίδια εργασία θα απορριφθεί ξανά. Δεν την κρατάμε σε βρόχο — τη δείχνουμε.
    if (e instanceof SoftoneError && !(e instanceof SoftoneTransportError)) {
      const message = (e as Error).message;
      await prisma.softoneOutbox.update({
        where: { id: item.id },
        data: { status: SoftoneOutboxStatus.REJECTED, attempts: { increment: 1 }, lastError: message },
      });
      return { status: 'rejected', message };
    }
    // Άγνωστη έκβαση: ΑΠΑΓΟΡΕΥΕΤΑΙ η αυτόματη επανάληψη.
    const message = `${(e as Error).message} — η εργασία ΙΣΩΣ εκτελέστηκε στο SoftOne. Έλεγξε εκεί πριν την ξαναστείλεις.`;
    await prisma.softoneOutbox.update({
      where: { id: item.id },
      data: { status: SoftoneOutboxStatus.NEEDS_REVIEW, attempts: { increment: 1 }, lastError: message },
    });
    return { status: 'needs_review', message };
  }

  if (res && res.success === false) {
    const message = res.error ?? `Το SoftOne απέρριψε την εργασία (code ${res.errorcode ?? '?'}).`;
    await prisma.softoneOutbox.update({
      where: { id: item.id },
      data: { status: SoftoneOutboxStatus.REJECTED, attempts: { increment: 1 }, lastError: message, result: res as never },
    });
    return { status: 'rejected', message };
  }

  await prisma.softoneOutbox.update({
    where: { id: item.id },
    data: {
      status: SoftoneOutboxStatus.SENT, attempts: { increment: 1 },
      lastError: null, result: res as never, sentAt: new Date(),
    },
  });
  return { status: 'sent', result: res as Record<string, unknown> };
}

export interface DrainReport {
  attempted: number;
  sent: number;
  stillQueued: number;
  rejected: number;
  needsReview: number;
  /** `false` όταν δεν δοκιμάσαμε καν, επειδή ο διακομιστής δεν απαντά. */
  ran: boolean;
  message: string;
}

/**
 * Αδειάζει την ουρά, με τη σειρά που μπήκε.
 *
 * ΣΕΙΡΙΑΚΑ και ΟΧΙ παράλληλα: οι εργασίες έχουν συχνά εξάρτηση μεταξύ τους (πρώτα η καρτέλα,
 * μετά το παραστατικό της) και το ERP δεν κερδίζει τίποτα από ταυτόχρονες εγγραφές.
 *
 * ΣΤΑΜΑΤΑΕΙ στην πρώτη αποτυχία μεταφοράς: αν η σύνδεση έπεσε ξανά, οι υπόλοιπες θα αποτύχουν
 * κι αυτές — και κάθε περιττή απόπειρα είναι μια ακόμη ευκαιρία να μείνει κάτι σε `NEEDS_REVIEW`.
 */
export async function drainOutbox({ limit = 50 }: { limit?: number } = {}): Promise<DrainReport> {
  const base: DrainReport = {
    attempted: 0, sent: 0, stillQueued: 0, rejected: 0, needsReview: 0, ran: false, message: '',
  };

  const pending = await prisma.softoneOutbox.count({ where: { status: SoftoneOutboxStatus.PENDING } });
  if (pending === 0) return { ...base, ran: true, message: 'Η ουρά είναι άδεια.' };

  const health = await softoneReachable();
  if (!health.reachable) {
    return { ...base, stillQueued: pending, message: `Δεν έγινε απόπειρα — ${health.message}` };
  }

  const items = await prisma.softoneOutbox.findMany({
    where: { status: SoftoneOutboxStatus.PENDING },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const r = { ...base, ran: true };
  for (const item of items) {
    r.attempted++;
    const outcome = await sendItem(item);
    if (outcome.status === 'sent') r.sent++;
    else if (outcome.status === 'rejected') r.rejected++;
    else if (outcome.status === 'needs_review') r.needsReview++;
    else {
      r.stillQueued++;
      break; // Η σύνδεση ξαναέπεσε — δεν επιμένουμε.
    }
  }
  // Το «όσες μένουν» το λέει η ΒΑΣΗ, όχι ο μετρητής του βρόχου: ο βρόχος κόβεται νωρίς και
  // μπορεί να υπάρχουν και εργασίες πέρα από το `limit`.
  r.stillQueued = await prisma.softoneOutbox.count({ where: { status: SoftoneOutboxStatus.PENDING } });
  r.message = r.sent > 0
    ? `Ολοκληρώθηκαν ${r.sent} από ${r.attempted}.`
    : `Καμία δεν ολοκληρώθηκε από ${r.attempted}.`;
  return r;
}

/** Σύνοψη για τη λωρίδα κατάστασης: πόσες περιμένουν και πόσες θέλουν άνθρωπο. */
export async function outboxSummary(): Promise<{ pending: number; needsReview: number; rejected: number }> {
  const [pending, needsReview, rejected] = await Promise.all([
    prisma.softoneOutbox.count({ where: { status: SoftoneOutboxStatus.PENDING } }),
    prisma.softoneOutbox.count({ where: { status: SoftoneOutboxStatus.NEEDS_REVIEW } }),
    prisma.softoneOutbox.count({ where: { status: SoftoneOutboxStatus.REJECTED } }),
  ]);
  return { pending, needsReview, rejected };
}
