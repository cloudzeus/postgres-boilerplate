// scripts/tenant-switch-relink.ts — ONE-OFF. Ξανασύνδεση παραστατικών μετά από αλλαγή εγκατάστασης SoftOne.
//
// ΤΙ ΚΑΝΕΙ. Μετά τον πλήρη συγχρονισμό στη νέα εγκατάσταση, κάθε αριθμητικό κλειδί ERP που είναι
// γραμμένο σε παραστατικά, γραμμές, επιμερισμούς, κανόνες μνήμης και πρότυπα ανήκει στην ΠΑΛΙΑ.
// Τα ids δεν μεταφέρονται — τα ΕΠΙΧΕΙΡΗΜΑΤΙΚΑ ΚΛΕΙΔΙΑ όμως ναι: ΑΦΜ, κωδικός είδους, κωδικός
// λογαριασμού, κωδικός σειράς. Άρα κάθε σύνδεση περνά από τρία στάδια:
//
//     παλιό id  ──(χάρτης του αντιγράφου ασφαλείας)──▶  κωδικός  ──(νέος καθρέφτης)──▶  νέο id
//
// και καταλήγει σε ΕΝΑ από τρία, που μετρώνται χωριστά:
//   • kept     — ίδιο id, ίδιος κωδικός: η σύνδεση ισχύει ως έχει
//   • remapped — ο κωδικός υπάρχει, με άλλο id: η σύνδεση μεταφέρεται
//   • cleared  — ο κωδικός δεν υπάρχει στη νέα εγκατάσταση: η σύνδεση καθαρίζει (ασύνδετο, ΟΧΙ λάθος)
//
// Ο ΚΑΝΟΝΑΣ: ποτέ «ίδιο id άρα εντάξει». Ένα id που υπάρχει και στις δύο εγκαταστάσεις μπορεί να
// είναι ΑΛΛΗ εγγραφή — γι' αυτό συγκρίνεται και ο κωδικός πίσω από αυτό.
//
// ΕΙΔΗ ΚΑΙ ΣΕΙΡΕΣ ΕΛΕΓΧΟΝΤΑΙ ΖΩΝΤΑΝΑ, ΟΧΙ ΣΤΟΝ ΚΑΘΡΕΦΤΗ. Ο καθρέφτης ειδών είναι ΥΠΟΣΥΝΟΛΟ (φίλτρο
// ημερομηνίας καταλόγου) και αυτός των σειρών καλύπτει μόνο κάποιες ενότητες: μετρημένα, 48/48
// δεμένα είδη και 39/56 σειρές έλειπαν από τον καθρέφτη — ενώ οι 51 σειρές ΥΠΗΡΧΑΝ στο ERP. Με
// τον καθρέφτη ως κριτή, το script θα καθάριζε συνδέσεις που ισχύουν. Η απουσία από υποσύνολο
// δεν είναι απουσία. Οι κλήσεις είναι ΜΟΝΟ αναγνώσεις (`GetTable`).
//
// Χρήση (το `register.mjs` χρειάζεται για το `server-only` του lib/softone):
//   npx tsx --env-file=.env --import ./scripts/templates/register.mjs scripts/tenant-switch-relink.ts <backup.json>
//   … <backup.json> --apply
import { readFileSync } from 'node:fs';
import { prisma } from '../lib/db';
import type { Prisma } from '@prisma/client';
import { softoneGetTable } from '../lib/softone';

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error('Δώσε το αρχείο αντιγράφου ασφαλείας.');
const APPLY = flag === '--apply';
const B = JSON.parse(readFileSync(file, 'utf8'));

type Tally = { kept: number; remapped: number; cleared: number };
const tally = (): Tally => ({ kept: 0, remapped: 0, cleared: 0 });
const T: Record<string, Tally> = {};
const t = (k: string) => (T[k] ??= tally());

const norm = (s: unknown) => String(s ?? '').trim();
const afmKey = (s: unknown) => norm(s).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/**
 * Ένας παλιός → νέος χάρτης για ΕΝΑ μητρώο. `oldKey` και `newKey` πρέπει να βγάζουν το ΙΔΙΟ
 * επιχειρηματικό κλειδί από τις δύο πλευρές.
 */
function bridge<O, N>(old: O[], fresh: N[], oldId: (o: O) => number, oldKey: (o: O) => string,
  newId: (n: N) => number, newKey: (n: N) => string) {
  const keyOfOld = new Map(old.map((o) => [oldId(o), oldKey(o)]));
  const idOfNew = new Map<string, number>();
  for (const n of fresh) { const k = newKey(n); if (k && !idOfNew.has(k)) idOfNew.set(k, newId(n)); }
  /** `undefined` = καθάρισε· αριθμός = το νέο id. */
  return (id: number | null | undefined, cat: string): number | null | undefined => {
    if (id == null) return id;           // δεν υπήρχε σύνδεση — δεν μετράει
    const k = keyOfOld.get(id);
    const nid = k ? idOfNew.get(k) : undefined;
    if (nid == null) { t(cat).cleared++; return undefined; }
    if (nid === id) t(cat).kept++; else t(cat).remapped++;
    return nid;
  };
}

// ── Νέοι καθρέφτες ────────────────────────────────────────────────────────────────────────
const [nTraders, nItems, nLines, nSx, nExp, nCc, nPrj, nStg, nSeries] = await Promise.all([
  prisma.softoneTrader.findMany({ select: { trdr: true, afm: true, code: true, name: true, sodtype: true, kind: true } }),
  prisma.softoneItem.findMany({ select: { mtrl: true, code: true, name: true, isService: true } }),
  prisma.softoneLineItem.findMany({ select: { mtrl: true, code: true, name: true } }),
  prisma.softoneSxAccount.findMany({ select: { mtrl: true, code: true, name: true } }),
  prisma.softoneExpense.findMany({ select: { expn: true, code: true, name: true } }),
  prisma.softoneCostCenter.findMany({ select: { costcntr: true, code: true } }),
  prisma.softoneProject.findMany({ select: { prjc: true, code: true } }),
  prisma.softoneProjectStage.findMany({ select: { prjcStage: true, code: true } }),
  prisma.softoneDocSeries.findMany({ select: { sosource: true, code: true, isActive: true } }),
]);
const M = B.mirrors;

const q = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');

// ── ΖΩΝΤΑΝΑ: είδη ──────────────────────────────────────────────────────────────────────────
// Κωδικός κάθε ΠΑΛΙΟΥ mtrl: από τον παλιό καθρέφτη, αλλιώς από τη γραμμή που το κρατούσε
// (η γραμμή αποθηκεύει τον κωδικό τη στιγμή της αντιστοίχισης).
const oldItemCode = new Map<number, string>(M.items.map((i: any) => [i.mtrl, norm(i.code)]));
for (const it of B.links.docItems) if (it.softoneMtrl != null && it.softoneCode && !oldItemCode.has(it.softoneMtrl)) oldItemCode.set(it.softoneMtrl, norm(it.softoneCode));
const wantedItemIds = [...new Set<number>([
  ...B.links.docItems.map((i: any) => i.softoneMtrl), ...B.links.lineRules.map((r: any) => r.mtrl),
].filter((x: unknown): x is number => typeof x === 'number'))];
const wantedCodes = [...new Set(wantedItemIds.map((id) => oldItemCode.get(id)).filter((c): c is string => !!c))];
const liveRows = [
  ...(wantedItemIds.length ? await softoneGetTable('MTRL', ['MTRL', 'CODE', 'NAME', 'SODTYPE'], `MTRL IN (${wantedItemIds.join(',')})`) : []),
  ...(wantedCodes.length ? await softoneGetTable('MTRL', ['MTRL', 'CODE', 'NAME', 'SODTYPE'], `CODE IN (${q(wantedCodes)}) AND SODTYPE IN (51,52)`) : []),
] as Record<string, unknown>[];
const liveItemById = new Map(liveRows.map((r) => [Number(r.MTRL), { mtrl: Number(r.MTRL), code: norm(r.CODE), name: norm(r.NAME), isService: Number(r.SODTYPE) === 52 }]));
const liveItemByCode = new Map([...liveItemById.values()].map((r) => [r.code, r]));
/** Είδος: ίδιο id ΚΑΙ ίδιος κωδικός → κρατιέται· ο κωδικός με άλλο id → μεταφέρεται· αλλιώς καθαρίζει. */
function item(id: number | null | undefined, cat: string) {
  if (id == null) return id;
  const code = oldItemCode.get(id);
  const same = liveItemById.get(id);
  if (same && code && same.code === code) { t(cat).kept++; return id; }
  const moved = code ? liveItemByCode.get(code) : undefined;
  if (moved) { t(cat).remapped++; return moved.mtrl; }
  t(cat).cleared++; return undefined;
}

// ── ΖΩΝΤΑΝΑ: σειρές ────────────────────────────────────────────────────────────────────────
const seriesCodes = [...new Set<string>(B.links.docs.map((d: any) => norm(d.softoneSeries)).filter(Boolean))];
const liveSeries = seriesCodes.length
  ? await softoneGetTable('SERIES', ['SOSOURCE', 'SERIES'], `SERIES IN (${seriesCodes.join(',')})`) as Record<string, unknown>[]
  : [];
const seriesSet = new Set(liveSeries.map((r) => `${Number(r.SOSOURCE)}:${norm(r.SERIES)}`));

// Συναλλασσόμενος: ΑΦΜ + SODTYPE. Ο ίδιος ΑΦΜ μπορεί να είναι και προμηθευτής και πιστωτής,
// με ΔΙΑΦΟΡΕΤΙΚΟ TRDR — το ΑΦΜ μόνο του θα τους μπέρδευε.
const trader = bridge(M.traders, nTraders,
  (o: any) => o.trdr, (o: any) => `${afmKey(o.afm)}#${o.sodtype}`,
  (n) => n.trdr, (n) => `${afmKey(n.afm)}#${n.sodtype}`);
const lin = bridge(M.lineitems, nLines, (o: any) => o.mtrl, (o: any) => norm(o.code), (n) => n.mtrl, (n) => norm(n.code));
const sx = bridge(M.sxaccounts, nSx, (o: any) => o.mtrl, (o: any) => norm(o.code), (n) => n.mtrl, (n) => norm(n.code));
const expn = bridge(M.expenses, nExp, (o: any) => o.expn, (o: any) => norm(o.code), (n) => n.expn, (n) => norm(n.code));
const cc = bridge(M.costcenters, nCc, (o: any) => o.costcntr, (o: any) => norm(o.code), (n) => n.costcntr, (n) => norm(n.code));
const prj = bridge(M.projects, nPrj, (o: any) => o.prjc, (o: any) => norm(o.code), (n) => n.prjc, (n) => norm(n.code));
const stg = bridge(M.stages, nStg, (o: any) => o.prjcStage, (o: any) => norm(o.code), (n) => n.prjcStage, (n) => norm(n.code));

const traderByTrdr = new Map(nTraders.map((x) => [x.trdr, x]));
const itemByMtrl = new Map(nItems.map((x) => [x.mtrl, x]));
const linByMtrl = new Map(nLines.map((x) => [x.mtrl, x]));
const expByExpn = new Map(nExp.map((x) => [x.expn, x]));

/** `undefined` από τη γέφυρα = καθάρισε (null)· αλλιώς ό,τι έδωσε. */
const v = <X>(x: X | undefined): X | null => (x === undefined ? null : x);

// Κάθε αλλαγή παίρνει τον client ΤΗΣ ΣΥΝΑΛΛΑΓΗΣ — με τον καθολικό `prisma` θα έτρεχε ΕΚΤΟΣ αυτής.
const ops: ((db: Prisma.TransactionClient) => Promise<unknown>)[] = [];
const notes: string[] = [];

// ── 1. Παραστατικά: συναλλασσόμενος, σειρά, ανάρτηση, έλεγχος διπλού ───────────────────────
for (const d of B.links.docs) {
  const data: Record<string, unknown> = {};
  const nt = trader(d.softoneTrdr, 'doc.trader');
  if (d.softoneTrdr != null) {
    const row = nt != null ? traderByTrdr.get(nt) : undefined;
    Object.assign(data, row
      ? { softoneTrdr: row.trdr, softoneCode: row.code, softoneName: row.name, softoneKind: row.kind }
      : { softoneTrdr: null, softoneCode: null, softoneName: null, softoneKind: null, softoneChecked: null });
  }
  if (d.softoneSeries) {
    const ok = seriesSet.has(`${d.seriesSource ?? 1251}:${norm(d.softoneSeries)}`);
    t('doc.series')[ok ? 'kept' : 'cleared']++;
    if (!ok) Object.assign(data, { softoneSeries: null, seriesSource: null, seriesConfidence: null, seriesReason: null, seriesBy: null });
  }
  // Η ΑΝΑΡΤΗΣΗ αφορά την ΠΑΛΙΑ εγκατάσταση: το FINDOC δεν υπάρχει στη νέα. Ένα «Αναρτήθηκε» που
  // δεν ισχύει κλειδώνει το κουμπί και βάζει το παραστατικό στη λάθος καρτέλα. Το παλιό ref μένει
  // στο αντίγραφο ασφαλείας.
  if (d.postStatus && d.postStatus !== 'NONE') {
    t('doc.post').cleared++;
    notes.push(`ανάρτηση kolleris: ${d.fileName} → ${d.postedRef ?? '—'}`);
    Object.assign(data, { postStatus: 'NONE', postedAt: null, postedRef: null, postError: null });
  }
  // Ο έλεγχος διπλού απάντησε για ΑΛΛΗ εγκατάσταση.
  if (d.softoneDocChecked != null) Object.assign(data, { softoneDocExists: null, softoneDocRef: null, softoneDocChecked: null });
  if (Object.keys(data).length) ops.push((db) => db.ocrDocument.update({ where: { id: d.id }, data }));
}

// ── 2. Γραμμές ──────────────────────────────────────────────────────────────────────────────
for (const it of B.links.docItems) {
  const data: Record<string, unknown> = {};
  if (it.softoneMtrl != null) {
    const n = item(it.softoneMtrl, 'line.item');
    const row = n != null ? (liveItemById.get(n) ?? itemByMtrl.get(n)) : undefined;
    Object.assign(data, row
      ? { softoneMtrl: row.mtrl, softoneCode: row.code, softoneName: row.name, softoneIsService: row.isService }
      : { softoneMtrl: null });
  }
  if (it.softoneLinMtrl != null) {
    const n = lin(it.softoneLinMtrl, 'line.lineitem');
    const row = n != null ? linByMtrl.get(n) : undefined;
    Object.assign(data, row ? { softoneLinMtrl: row.mtrl, softoneCode: row.code, softoneName: row.name } : { softoneLinMtrl: null });
  }
  if (it.softoneExpn != null) {
    const n = expn(it.softoneExpn, 'line.expense');
    const row = n != null ? expByExpn.get(n) : undefined;
    Object.assign(data, row ? { softoneExpn: row.expn, softoneCode: row.code, softoneName: row.name } : { softoneExpn: null });
  }
  if (it.softoneCostCntr != null) data.softoneCostCntr = v(cc(it.softoneCostCntr, 'line.costcenter'));
  if (it.softonePrjc != null) data.softonePrjc = v(prj(it.softonePrjc, 'line.project'));
  if (it.softonePrjcStage != null) data.softonePrjcStage = v(stg(it.softonePrjcStage, 'line.stage'));
  // Αν ΧΑΘΗΚΕ κάθε κύρια αντιστοίχιση, η γραμμή γίνεται καθαρά ασύνδετη — όχι με ετικέτα
  // («code», «manual») που υπόσχεται αντιστοίχιση που δεν υπάρχει.
  const had = it.softoneMtrl != null || it.softoneLinMtrl != null || it.softoneExpn != null;
  const has = ['softoneMtrl', 'softoneLinMtrl', 'softoneExpn'].some((k) => (k in data ? data[k] != null : it[k] != null));
  if (had && !has) Object.assign(data, { softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null });
  if (Object.keys(data).length) ops.push((db) => db.ocrInvoiceItem.update({ where: { id: it.id }, data }));
}

// ── 3. Επιμερισμοί: όλα ή τίποτα ΑΝΑ ΓΡΑΜΜΗ ─────────────────────────────────────────────────
// Ένας μισός επιμερισμός δεν αθροίζει 100 % και η καταχώριση θα έχανε ποσά.
const allocByItem = new Map<string, any[]>();
for (const a of B.links.allocations) allocByItem.set(a.itemId, [...(allocByItem.get(a.itemId) ?? []), a]);
for (const [itemId, parts] of allocByItem) {
  const mapped = parts.map((p) => ({ p, n: p.kind === 'SXACCOUNT' ? sx(p.registryMtrl, 'alloc.part') : lin(p.registryMtrl, 'alloc.part') }));
  if (mapped.every((m) => m.n != null)) {
    for (const m of mapped) if (m.n !== m.p.registryMtrl) ops.push((db) => db.ocrInvoiceItemAllocation.update({ where: { id: m.p.id }, data: { registryMtrl: m.n as number } }));
  } else {
    notes.push(`επιμερισμός γραμμής ${itemId}: ${parts.map((p) => p.accountCode ?? p.registryMtrl).join(' + ')} — δεν υπάρχει στη νέα εγκατάσταση, αφαιρείται`);
    ops.push((db) => db.ocrInvoiceItemAllocation.deleteMany({ where: { itemId } }));
  }
}

// ── 4. Κανόνες μνήμης γραμμών ───────────────────────────────────────────────────────────────
for (const r of B.links.lineRules) {
  const data: Record<string, unknown> = {};
  if (r.mtrl != null) data.mtrl = v(item(r.mtrl, 'rule.item'));
  if (r.lin != null) data.lin = v(lin(r.lin, 'rule.lineitem'));
  if (r.expn != null) data.expn = v(expn(r.expn, 'rule.expense'));
  if (r.costCntr != null) data.costCntr = v(cc(r.costCntr, 'rule.costcenter'));
  if (r.prjc != null) data.prjc = v(prj(r.prjc, 'rule.project'));
  if (r.prjcStage != null) data.prjcStage = v(stg(r.prjcStage, 'rule.stage'));
  const target = (k: string) => (k in data ? data[k] : r[k]);
  // Κανόνας χωρίς στόχο είναι μνήμη που δεν θυμάται τίποτα — σβήνεται αντί να μείνει νεκρός.
  if (target('mtrl') == null && target('lin') == null && target('expn') == null) {
    notes.push(`κανόνας μνήμης «${r.pattern}» (ΑΦΜ ${r.afm || '—'}) — ο στόχος δεν υπάρχει, αφαιρείται`);
    ops.push((db) => db.lineMatchRule.delete({ where: { id: r.id } }));
  } else if (Object.keys(data).length) {
    ops.push((db) => db.lineMatchRule.update({ where: { id: r.id }, data }));
  }
}

// ── 5. Σχήματα επιμερισμού ──────────────────────────────────────────────────────────────────
for (const s of B.links.shapeRules) {
  const parts = Array.isArray(s.parts) ? s.parts : [];
  const mapped = parts.map((p: any) => ({ ...p, registryMtrl: s.kind === 'SXACCOUNT' ? sx(p.registryMtrl, 'shape.part') : lin(p.registryMtrl, 'shape.part') }));
  if (mapped.every((p: any) => p.registryMtrl != null)) ops.push((db) => db.allocationShapeRule.update({ where: { id: s.id }, data: { parts: mapped } }));
  else ops.push((db) => db.allocationShapeRule.delete({ where: { id: s.id } }));
}

// ── 6. Πρότυπα εξαγωγής ─────────────────────────────────────────────────────────────────────
for (const tpl of B.links.templates) {
  if (tpl.traderTrdr == null) continue;
  const n = trader(tpl.traderTrdr, 'template.trader');
  if (n !== tpl.traderTrdr) ops.push((db) => db.extractionTemplate.update({ where: { id: tpl.id }, data: { traderTrdr: v(n) } }));
}

// ── Απολογισμός ─────────────────────────────────────────────────────────────────────────────
console.log(`${APPLY ? 'ΕΦΑΡΜΟΓΗ' : 'DRY-RUN'} — ${ops.length} αλλαγές`);
console.table(T);
for (const n of notes) console.log('  •', n);

if (APPLY) {
  // Σε ΜΙΑ συναλλαγή: είτε ξανασυνδέονται όλα, είτε τίποτα. Μια μισή ξανασύνδεση θα άφηνε
  // παραστατικά με νέο συναλλασσόμενο και παλιές γραμμές — χειρότερο από το να μην είχε γίνει.
  await prisma.$transaction(async (tx) => { for (const op of ops) await op(tx); }, { timeout: 120_000 });
  console.log('Ολοκληρώθηκε.');
}
await prisma.$disconnect();
