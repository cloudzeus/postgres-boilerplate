// lib/softone-sync/gl-account-create.ts — SERVER. Άνοιγμα λογαριασμού γενικής λογιστικής στο SoftOne.
//
// ΠΟΙΟ OBJECT. Το `ACNT` κρατά ΟΛΟ το σχέδιο σε μία εγγραφή (το `getData` αγνοεί το KEY και φέρνει
// χιλιάδες γραμμές) — ένα setData εκεί θα μπορούσε να το αντικαταστήσει ολόκληρο. Το `ACNTGL`
// («Λογαριασμοί Γεν. Λογιστικής») είναι EditMaster ΜΙΑΣ εγγραφής ανά λογαριασμό: εκεί γίνεται η
// δημιουργία. Επαληθευμένο ζωντανά στο Demo S1 (2026-10-12).
//
// ΤΙ ΣΤΕΛΝΟΥΜΕ. Ο λογαριασμός έχει 12 required πεδία χωρίς default (τύπος, συμπεριφορά, ΚΕΠΥΟ, …) και
// σύνδεση με αναλυτική και έντυπα (Ε3). Δεν τα μαντεύουμε: αντιγράφονται από τον ΑΔΕΛΦΟ λογαριασμό
// της ίδιας ομάδας (ίδιος γονικός), που έχει την ίδια φύση. Αλλάζουν μόνο:
//  • CODE / NAME,
//  • VAT — από τον χάρτη ΦΠΑ της εφαρμογής (`vat-map`), ποτέ από τον αδελφό (άλλος συντελεστής),
//  • ACNTVATID — ο λογαριασμός ΦΠΑ εισροών του ΙΔΙΟΥ συντελεστή (π.χ. 6% → 54.00.29.0006).
//    Αντιγραμμένος θα έστελνε τον ΦΠΑ 6% στον λογαριασμό του 19%.
//
// ΑΣΦΑΛΕΙΑ. Πριν και μετά μετριέται όλο το σχέδιο: μετά πρέπει να είναι ΑΚΡΙΒΩΣ +1, αλλιώς σταματά
// με δυνατό μήνυμα. Ο νέος λογαριασμός διαβάζεται πίσω και ελέγχεται πεδίο-πεδίο.
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { softoneCall, softoneGetTable } from '@/lib/softone';
import { VAT_RATE_MAP_SETTING, buildVatRateMap, parseVatRateOverrides } from '@/lib/ocr/vat-map';

export class GlAccountError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); this.name = 'GlAccountError'; }
}

export interface GlAccountInput {
  code: string;
  name: string;
  /** Συντελεστής ΦΠΑ σε % (π.χ. 6). `null`/0 = λογαριασμός χωρίς ΦΠΑ. */
  vatRate: number | null;
}

export interface GlAccountPlan {
  code: string;
  name: string;
  parent: { acnt: number; code: string; name: string };
  template: { acnt: number; code: string; name: string };
  vat: { rate: number; code: string } | null;
  vatAccount: { acnt: number; code: string; name: string } | null;
  payload: { OBJECT: 'ACNTGL'; KEY: ''; DATA: Record<string, Record<string, unknown>[]> };
}

/** Τα πεδία που ΔΕΝ αντιγράφονται από τον αδελφό. */
const SKIP = new Set(['ACNT', 'CODE', 'NAME', 'VAT', 'ACNTVATID', 'INSDATE', 'INSUSER', 'UPDDATE', 'UPDUSER']);
/** 4ης βαθμίδας (κινούμενος, ΝΝ.ΝΝ.ΝΝ.ΝΝΝΝ) ή 3ης (ομάδα, ΝΝ.ΝΝ.ΝΝ) — η ομάδα χρειάζεται όταν λείπει ο γονικός. */
const CODE_RE = /^\d{2}\.\d{2}\.\d{2}(\.\d{4})?$/;
/** «1|Πρότυπο» → «1»: το getData δίνει ετικέτες, το setData θέλει κλειδιά. */
const keyOf = (v: unknown) => String(v ?? '').split('|')[0];
const quote = (s: string) => s.replace(/'/g, '');

async function accountByCode(code: string) {
  const [r] = await softoneGetTable('ACNT', ['ACNT', 'CODE', 'NAME', 'ACNGRADE', 'ACNMOVING', 'VAT'], `CODE='${quote(code)}'`);
  return r ?? null;
}

async function chartCount(): Promise<number> {
  const res = await softoneCall<{ success?: boolean; count?: number; error?: string }>('GetTable', { TABLE: 'ACNT', FIELDS: 'ACNT', FILTER: '' });
  if (res.success === false || typeof res.count !== 'number') {
    throw new GlAccountError('count_failed', `Δεν μετρήθηκε το λογιστικό σχέδιο: ${res.error ?? 'άγνωστο'}`, 502);
  }
  return res.count;
}

/** Το σχέδιο της δημιουργίας — ΧΩΡΙΣ καμία εγγραφή. Ό,τι θα σταλεί, φαίνεται εδώ. */
export async function planGlAccount(input: GlAccountInput): Promise<GlAccountPlan> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!CODE_RE.test(code)) throw new GlAccountError('invalid_code', `Ο κωδικός «${code}» δεν είναι λογαριασμός 3ης ή 4ης βαθμίδας (ΝΝ.ΝΝ.ΝΝ ή ΝΝ.ΝΝ.ΝΝ.ΝΝΝΝ).`);
  const grade = code.split('.').length;
  if (!name) throw new GlAccountError('name_required', 'Δώσε περιγραφή λογαριασμού.');
  if (await accountByCode(code)) throw new GlAccountError('exists', `Ο λογαριασμός ${code} υπάρχει ήδη στο SoftOne.`, 409);

  const parentCode = code.split('.').slice(0, grade - 1).join('.');
  const parent = await accountByCode(parentCode);
  if (!parent) throw new GlAccountError('no_parent', `Ο γονικός λογαριασμός ${parentCode} δεν υπάρχει — δεν ανοίγουμε λογαριασμό εκτός δομής.`);

  // Ο αδελφός-πρότυπο: κινούμενος, ίδιος γονικός. Αν ο γονικός δεν έχει κανέναν (π.χ. 63.98.99
  // «Λοιποί φόροι-τέλη»), ο ξάδελφος από την ίδια ομάδα (63.98.xx) — ίδια φύση, ίδια συμπεριφορά.
  // Προτιμάται όποιος έχει ΦΠΑ όταν ο νέος θα έχει, όποιος ΔΕΝ έχει όταν ο νέος είναι χωρίς ΦΠΑ.
  // Πρότυπο ΙΔΙΑΣ βαθμίδας: κινούμενος για 4ης, ομάδα (μη κινούμενη) για 3ης.
  const sameGrade = (prefix: string) => softoneGetTable('ACNT', ['ACNT', 'CODE', 'NAME', 'ACNMOVING', 'VAT'], `CODE LIKE '${quote(prefix)}.%'`)
    .then((rows) => rows.filter((s) => s.CODE.split('.').length === grade && (grade === 4 ? s.ACNMOVING === '1' : true)));
  let siblings = await sameGrade(parentCode);
  if (!siblings.length) siblings = await sameGrade(code.split('.').slice(0, grade - 2).join('.'));
  if (!siblings.length) throw new GlAccountError('no_template', `Δεν υπάρχει κινούμενος λογαριασμός κάτω από ${parentCode} (ούτε στην ομάδα του) να χρησιμεύσει ως πρότυπο.`);
  const wantsVat = input.vatRate != null && input.vatRate > 0;
  siblings.sort((a, b) => Number(!!b.VAT === wantsVat) - Number(!!a.VAT === wantsVat) || b.CODE.localeCompare(a.CODE));
  const tpl = siblings[0];
  const tplData = await softoneCall<{ success?: boolean; error?: string; data?: Record<string, Record<string, unknown>[]> }>(
    'getData', { OBJECT: 'ACNTGL', KEY: tpl.ACNT },
  );
  const tplRow = tplData.data?.ACNTGL?.[0];
  if (!tplRow) throw new GlAccountError('template_unreadable', `Το πρότυπο ${tpl.CODE} δεν διαβάστηκε: ${tplData.error ?? ''}`, 502);

  // ΦΠΑ: ο κωδικός από τον χάρτη της εφαρμογής, ο λογαριασμός ΦΠΑ από το σχέδιο.
  let vat: GlAccountPlan['vat'] = null;
  let vatAccount: GlAccountPlan['vatAccount'] = null;
  // Ομάδα όπου ΚΑΝΕΝΑΣ λογαριασμός δεν δένει ΦΠΑ (π.χ. 32.01.01 «Ειδικά έξοδα Τρίτων Χωρών»): ο νέος
  // ακολουθεί την ομάδα — ο ΦΠΑ εκεί δεν ζει στον λογαριασμό, και ένας λογαριασμός ΦΠΑ θα ήταν εφεύρεση.
  const groupUsesVat = siblings.some((s) => !!s.VAT);
  if (input.vatRate != null && input.vatRate > 0 && groupUsesVat) {
    const cats = await prisma.vatCategory.findMany();
    const map = buildVatRateMap(cats, parseVatRateOverrides(await getSetting(VAT_RATE_MAP_SETTING)));
    const vatCode = map.byRate[input.vatRate];
    if (vatCode == null) throw new GlAccountError('vat_unknown', `Δεν υπάρχει κωδικός ΦΠΑ ${input.vatRate}% στο SoftOne.`);
    vat = { rate: input.vatRate, code: String(vatCode) };
    // Ο λογαριασμός ΦΠΑ: ό,τι χρησιμοποιούν ήδη οι λογαριασμοί της ίδιας τάξης με τον ίδιο κωδικό ΦΠΑ·
    // αλλιώς ο λογαριασμός ΦΠΑ άλλου συντελεστή με τα δύο τελευταία ψηφία στον ζητούμενο.
    const cls = code.slice(0, 1);
    const users = await softoneGetTable('ACNT', ['ACNTVATID', 'VAT'], `CODE LIKE '${cls}%' AND ACNTVATID>0`);
    const top = (rows: typeof users) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.ACNTVATID) m.set(r.ACNTVATID, (m.get(r.ACNTVATID) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    let vatAcnt = top(users.filter((u) => u.VAT === vat!.code));
    if (!vatAcnt) {
      const any = top(users);
      const [anyRow] = any ? await softoneGetTable('ACNT', ['ACNT', 'CODE'], `ACNT=${any}`) : [];
      const guess = anyRow ? `${anyRow.CODE.slice(0, -2)}${String(input.vatRate).padStart(2, '0')}` : null;
      const g = guess ? await accountByCode(guess) : null;
      if (g && g.ACNMOVING === '1') vatAcnt = g.ACNT;
    }
    if (!vatAcnt) throw new GlAccountError('vat_account_missing', `Δεν βρέθηκε λογαριασμός ΦΠΑ εισροών ${input.vatRate}% — άνοιξέ τον πρώτα.`);
    const [va] = await softoneGetTable('ACNT', ['ACNT', 'CODE', 'NAME'], `ACNT=${vatAcnt}`);
    if (!va) throw new GlAccountError('vat_account_missing', `Ο λογαριασμός ΦΠΑ ${vatAcnt} δεν διαβάστηκε.`, 502);
    vatAccount = { acnt: Number(va.ACNT), code: va.CODE, name: va.NAME };
  }

  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tplRow)) if (!SKIP.has(k) && v != null && v !== '') row[k] = keyOf(v);
  row.CODE = code;
  row.NAME = name;
  if (vat) row.VAT = vat.code;
  if (vatAccount) row.ACNTVATID = vatAccount.acnt;
  // Η αντιστοίχιση με τα έντυπα (Ε3 κ.λπ.) ανά χρήση — ίδια με του αδελφού, ίδια φύση δαπάνης.
  const sodoc = (tplData.data?.SODOCTYPE ?? []).map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (!['ID', 'SODTYPE'].includes(k) && v != null && v !== '') o[k] = keyOf(v);
    return o;
  });

  return {
    code, name,
    parent: { acnt: Number(parent.ACNT), code: parent.CODE, name: parent.NAME },
    template: { acnt: Number(tpl.ACNT), code: tpl.CODE, name: tpl.NAME },
    vat, vatAccount,
    payload: { OBJECT: 'ACNTGL', KEY: '', DATA: { ACNTGL: [row], ...(sodoc.length ? { SODOCTYPE: sodoc } : {}) } },
  };
}

export interface GlAccountCreated extends Omit<GlAccountPlan, 'payload'> { acnt: number }

/** Δημιουργεί τον λογαριασμό, τον επαληθεύει και τον γράφει στον καθρέφτη. */
export async function createGlAccount(input: GlAccountInput): Promise<GlAccountCreated> {
  const plan = await planGlAccount(input);
  const before = await chartCount();
  const res = await softoneCall<{ success?: boolean; error?: string; id?: string | number }>('setData', plan.payload);
  if (res.success === false) throw new GlAccountError('softone_error', res.error ?? 'setData ACNTGL απέτυχε', 502);
  const after = await chartCount();
  if (after !== before + 1) {
    throw new GlAccountError(
      'chart_changed',
      `ΠΡΟΣΟΧΗ: το λογιστικό σχέδιο είχε ${before} λογαριασμούς και τώρα έχει ${after} (αναμενόταν ${before + 1}). Έλεγξέ το αμέσως στο SoftOne.`,
      500,
    );
  }
  const created = await accountByCode(plan.code);
  if (!created) throw new GlAccountError('not_persisted', `Το SoftOne απάντησε επιτυχία αλλά ο ${plan.code} δεν βρέθηκε.`, 502);
  const check = await softoneCall<{ success?: boolean; data?: Record<string, Record<string, unknown>[]> }>('getData', { OBJECT: 'ACNTGL', KEY: created.ACNT });
  const r = check.data?.ACNTGL?.[0] ?? {};
  const grade = plan.code.split('.').length;
  const problems = [
    keyOf(r.NAME) !== plan.name && 'περιγραφή',
    grade === 4 && keyOf(r.ACNMOVING) !== '1' && 'κινείται',
    plan.vat && keyOf(r.VAT) !== plan.vat.code && 'ΦΠΑ',
    plan.vatAccount && keyOf(r.ACNTVATID) !== String(plan.vatAccount.acnt) && 'λογαριασμός ΦΠΑ',
  ].filter(Boolean);
  if (problems.length) {
    throw new GlAccountError('mismatch', `Ο ${plan.code} δημιουργήθηκε αλλά διαφέρει σε: ${problems.join(', ')}. Έλεγξέ τον στο SoftOne.`, 502);
  }

  await prisma.softoneAccount.upsert({
    where: { acnt: Number(created.ACNT) },
    update: { code: plan.code, name: plan.name, grade, parentCode: plan.parent.code, sodtype: 89, postable: grade === 4, isActive: true, syncedAt: new Date() },
    create: { acnt: Number(created.ACNT), code: plan.code, name: plan.name, grade, parentCode: plan.parent.code, sodtype: 89, postable: grade === 4, isActive: true },
  });
  const { payload: _p, ...rest } = plan;
  return { ...rest, acnt: Number(created.ACNT) };
}
