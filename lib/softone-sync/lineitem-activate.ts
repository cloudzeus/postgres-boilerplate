// lib/softone-sync/lineitem-activate.ts — SERVER. Οι ΑΝΕΝΕΡΓΕΣ χρεοπιστώσεις του SoftOne και η
// ενεργοποίησή τους.
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ. Το `GetTable MTRL` (που τροφοδοτεί τον καθρέφτη) ΚΡΥΒΕΙ τις ανενεργές εγγραφές. Στο
// Demo S1 υπήρχαν 15 ενεργές και 222 ανενεργές χρεοπιστώσεις — όλη η σειρά με κωδικό λογαριασμού
// (62.02.00.0024 «Ύδρευση … 24%», εκτελωνιστικά, μεταφορικά, ΦΠΑ εισαγωγών…). Η εφαρμογή δεν τις
// έβλεπε, πρότεινε νέες με τον ίδιο κωδικό και το SoftOne απαντούσε «ο κωδικός υπάρχει ήδη». Η
// ΛΙΣΤΑ (browser) του object LINEITEM τις επιστρέφει κανονικά.
//
// Η ενεργοποίηση στέλνει ΜΟΝΟ `ISACTIVE` και — αν ζητηθεί — το `LISOURCETYPE` με τους πιστωτές (16)
// προστεθειμένους: οι παλιές χρεοπιστώσεις δέχονται συνήθως 12,13,14,15, άρα δεν μπαίνουν σε
// παραστατικό πιστωτή. Πριν και μετά διαβάζεται η εγγραφή· κάθε απρόσμενη αλλαγή σταματά.
import 'server-only';
import { prisma } from '@/lib/db';
import { softoneBrowseAll, softoneCall } from '@/lib/softone';

export class LineItemActivateError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); this.name = 'LineItemActivateError'; }
}

export interface InactiveLineItem {
  mtrl: number;
  code: string;
  name: string;
  acnmsk: string | null;
  vat: string | null;
  /** «12,13,14,15» — σε ποιων τύπων συναλλασσομένων τα παραστατικά επιτρέπεται. */
  lisourceType: string | null;
  acceptsCreditors: boolean;
}

const CREDITOR = 16;
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const keyOf = (v: unknown) => str(v).split('|')[0];
const parseLis = (v: unknown) => str(v).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

/** Το MTRL από τη στήλη κλειδιού της λίστας («LINEITEM;4011»). */
function mtrlOf(row: Record<string, unknown>): number | null {
  for (const v of Object.values(row)) {
    const m = /^LINEITEM;(\d+)$/.exec(str(v));
    if (m) return Number(m[1]);
  }
  return null;
}

/** Όλες οι ανενεργές χρεοπιστώσεις, από τη λίστα του SoftOne. Μόνο ανάγνωση. */
export async function fetchInactiveLineItems(): Promise<InactiveLineItem[]> {
  const rows = await softoneBrowseAll('LINEITEM', 'LINEITEM.ISACTIVE=0');
  const out: InactiveLineItem[] = [];
  for (const r of rows) {
    const mtrl = mtrlOf(r);
    if (!mtrl) continue;
    const lis = str(r.LISOURCETYPE) || null;
    out.push({
      mtrl, code: str(r.CODE), name: str(r.NAME), acnmsk: str(r.ACNMSK) || null, vat: str(r.VAT) || null,
      lisourceType: lis, acceptsCreditors: parseLis(lis).includes(CREDITOR),
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Η λίστα από τη ΜΝΗΜΗ για 10 λεπτά: ρωτιέται σε κάθε αναζήτηση χρεοπίστωσης και σε κάθε άνοιγμα
 * του διαλόγου δημιουργίας, και μια κλήση στο SoftOne ανά πληκτρολόγηση θα ήταν απαράδεκτη.
 * Κάθε ενεργοποίηση την ακυρώνει.
 */
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; items: InactiveLineItem[] } | null = null;

export async function cachedInactiveLineItems(): Promise<InactiveLineItem[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const items = await fetchInactiveLineItems();
  cache = { at: Date.now(), items };
  return items;
}

/** Για τα tests και μετά από ενεργοποίηση. */
export function clearInactiveLineItemCache(): void { cache = null; }

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9α-ω]+/g, ' ').trim();

/**
 * Ανενεργές χρεοπιστώσεις που ΑΞΙΖΕΙ να προταθούν: ίδιος κωδικός, ίδιος λογαριασμός γενικής ή —
 * για την αναζήτηση — κείμενο σε κωδικό/περιγραφή. Ό,τι δεν ταιριάζει σε κανένα, δεν προτείνεται.
 * Ποτέ δεν πετάει: χωρίς σύνδεση με το SoftOne απλώς δεν υπάρχει πρόταση.
 */
export async function findInactiveLineItems(by: { code?: string | null; account?: string | null; q?: string | null }): Promise<InactiveLineItem[]> {
  const code = (by.code ?? '').trim();
  const account = (by.account ?? '').trim();
  const q = fold(by.q ?? '');
  if (!code && !account && q.length < 2) return [];
  const items = await cachedInactiveLineItems().catch(() => [] as InactiveLineItem[]);
  return items.filter((it) =>
    (code && it.code === code)
    || (account && (it.acnmsk === account || it.code === account))
    || (q.length >= 2 && q.split(' ').every((t) => fold(`${it.code} ${it.name}`).includes(t))));
}

async function readLineItem(mtrl: number): Promise<Record<string, unknown>> {
  const d = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, Record<string, unknown>[]> }>(
    'getData', { OBJECT: 'LINEITEM', KEY: String(mtrl) },
  );
  const row = d.data?.LINEITEM?.[0];
  if (!row) throw new LineItemActivateError('not_found', `Η χρεοπίστωση ${mtrl} δεν βρέθηκε στο SoftOne${d.error ? `: ${d.error}` : ''}.`, 404);
  return row;
}

export interface LineItemActivated {
  mtrl: number;
  code: string;
  name: string;
  acnmsk: string | null;
  lisourceType: string;
  /** `true` όταν προστέθηκαν οι πιστωτές στους τύπους που δέχεται. */
  creditorsAdded: boolean;
}

/** Ενεργοποιεί μια χρεοπίστωση (και, αν ζητηθεί, τη δέχεται σε παραστατικά πιστωτών). */
export async function activateLineItem(mtrl: number, opts: { allowCreditors: boolean }): Promise<LineItemActivated> {
  const before = await readLineItem(mtrl);
  const lis = parseLis(before.LISOURCETYPE);
  const addCreditors = opts.allowCreditors && !lis.includes(CREDITOR);
  if (keyOf(before.ISACTIVE) === '1' && !addCreditors) {
    throw new LineItemActivateError('nothing_to_do', `Η χρεοπίστωση ${str(before.CODE)} είναι ήδη ενεργή${opts.allowCreditors ? ' και δέχεται πιστωτές' : ''}.`);
  }
  const nextLis = addCreditors ? [...lis, CREDITOR].sort((a, b) => a - b).join(',') : lis.join(',');
  const row: Record<string, unknown> = { ISACTIVE: 1 };
  if (addCreditors) row.LISOURCETYPE = nextLis;

  const res = await softoneCall<{ success?: boolean; error?: string }>('setData', {
    OBJECT: 'LINEITEM', KEY: String(mtrl), DATA: { LINEITEM: [row] },
  });
  if (res.success === false) throw new LineItemActivateError('softone_error', res.error ?? `setData LINEITEM ${mtrl} απέτυχε`, 502);

  const after = await readLineItem(mtrl);
  const changed = (['CODE', 'NAME', 'ACNMSK', 'VAT', 'SODTYPE'] as const).filter((k) => str(after[k]) !== str(before[k]));
  if (changed.length) {
    throw new LineItemActivateError('unexpected_change', `ΠΡΟΣΟΧΗ: μετά την ενεργοποίηση άλλαξαν και τα πεδία ${changed.join(', ')} της ${mtrl}. Έλεγξέ την στο SoftOne.`, 500);
  }
  if (keyOf(after.ISACTIVE) !== '1') throw new LineItemActivateError('not_persisted', `Το SoftOne απάντησε επιτυχία αλλά η ${mtrl} έμεινε ανενεργή.`, 502);
  if (opts.allowCreditors && !parseLis(after.LISOURCETYPE).includes(CREDITOR)) {
    throw new LineItemActivateError('not_persisted', `Η ${mtrl} ενεργοποιήθηκε αλλά δεν δέχεται ακόμη πιστωτές.`, 502);
  }

  // Ο καθρέφτης γράφεται από ό,τι ΔΙΑΒΑΣΑΜΕ, όχι από ό,τι στείλαμε.
  const now = new Date();
  const num = (v: unknown) => { const n = Number(keyOf(v)); return keyOf(v) !== '' && Number.isFinite(n) ? n : null; };
  const data = {
    code: str(after.CODE), name: str(after.NAME) || str(after.CODE), vat: keyOf(after.VAT) || null,
    mtrType: num(after.MTRTYPE), mtrCategory: num(after.MTRCATEGORY), isActive: true, syncedAt: now,
    acnmsk: str(after.ACNMSK) || null, acnmskSyncedAt: now,
  };
  await prisma.softoneLineItem.upsert({ where: { mtrl }, update: data, create: { mtrl, ...data } });
  clearInactiveLineItemCache();
  return {
    mtrl, code: data.code, name: data.name, acnmsk: data.acnmsk,
    lisourceType: str(after.LISOURCETYPE), creditorsAdded: addCreditors,
  };
}
