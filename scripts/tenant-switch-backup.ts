// scripts/tenant-switch-backup.ts — ONE-OFF, ΜΟΝΟ ΑΝΑΓΝΩΣΗ.
//
// Πριν από αλλαγή εγκατάστασης SoftOne: γράφει σε αρχείο ΚΑΘΕ σύνδεση των παραστατικών με
// κωδικούς ERP, ΚΑΙ τον χάρτη id → επιχειρηματικό κλειδί (ΑΦΜ, κωδικός) των καθρεφτών.
//
// Ο χάρτης είναι το κρίσιμο κομμάτι: μετά τον συγχρονισμό οι καθρέφτες της παλιάς εγκατάστασης
// σβήνονται, και χωρίς αυτόν το «TRDR 3374» δεν μπορεί πια να μεταφραστεί σε «ΑΦΜ 801300672»
// — δηλαδή η ξανασύνδεση μέσω κωδικού γίνεται αδύνατη.
//
// Χρήση: npx tsx --env-file=.env scripts/tenant-switch-backup.ts <αρχείο-εξόδου>
import { writeFileSync } from 'node:fs';
import { prisma } from '../lib/db';

const out = process.argv[2];
if (!out) throw new Error('Δώσε αρχείο εξόδου.');

const [
  traders, items, lineitems, sxaccounts, expenses, costcenters, projects, stages, series, seededAccounts,
  docs, docItems, allocations, lineRules, shapeRules, templates, companies, tenantKey,
] = await Promise.all([
  prisma.softoneTrader.findMany({ select: { trdr: true, code: true, afm: true, name: true, sodtype: true } }),
  prisma.softoneItem.findMany({ select: { mtrl: true, code: true, code1: true, code2: true, name: true } }),
  prisma.softoneLineItem.findMany({ select: { mtrl: true, code: true, name: true } }),
  prisma.softoneSxAccount.findMany({ select: { mtrl: true, code: true, name: true } }),
  prisma.softoneExpense.findMany({ select: { expn: true, code: true, name: true } }),
  prisma.softoneCostCenter.findMany({ select: { costcntr: true, code: true } }),
  prisma.softoneProject.findMany({ select: { prjc: true, code: true } }),
  prisma.softoneProjectStage.findMany({ select: { prjcStage: true, code: true } }),
  prisma.softoneDocSeries.findMany({ select: { sosource: true, code: true, name: true } }),
  prisma.softoneAccount.findMany({ where: { acnt: { gte: 900000 } } }),
  prisma.ocrDocument.findMany({
    select: {
      id: true, fileName: true, issuerAfm: true, softoneTrdr: true, softoneCode: true, softoneName: true,
      softoneKind: true, softoneChecked: true, softoneDocExists: true, softoneDocRef: true, softoneDocChecked: true,
      softoneSeries: true, seriesSource: true, seriesConfidence: true, seriesReason: true, seriesBy: true,
      postStatus: true, postedAt: true, postedRef: true, postError: true, itemsMatched: true, itemsTotal: true,
    },
  }),
  prisma.ocrInvoiceItem.findMany({
    select: {
      id: true, documentId: true, rowIndex: true, code: true, name: true,
      softoneMtrl: true, softoneCode: true, softoneName: true, softoneIsService: true, softoneMatchedBy: true,
      softoneExpn: true, softoneLinMtrl: true, softoneCostCntr: true, softonePrjc: true, softonePrjcStage: true,
    },
  }),
  prisma.ocrInvoiceItemAllocation.findMany(),
  prisma.lineMatchRule.findMany(),
  prisma.allocationShapeRule.findMany(),
  prisma.extractionTemplate.findMany({ select: { id: true, name: true, traderTrdr: true } }),
  prisma.company.findMany({ where: { s1Trdr: { not: null } }, select: { id: true, s1Trdr: true } }),
  prisma.appSetting.findUnique({ where: { key: 'integrations.softoneSerial' } }),
]);

const backup = {
  takenAt: new Date().toISOString(),
  serialAtBackup: tenantKey?.value ?? null,
  note: 'Συνδέσεις παραστατικών με την ΠΑΛΙΑ εγκατάσταση SoftOne, πριν από πλήρη συγχρονισμό στη νέα.',
  mirrors: { traders, items, lineitems, sxaccounts, expenses, costcenters, projects, stages, series, seededAccounts },
  links: { docs, docItems, allocations, lineRules, shapeRules, templates, companies },
};
writeFileSync(out, JSON.stringify(backup, null, 1));
console.log(JSON.stringify({
  file: out,
  mirrors: Object.fromEntries(Object.entries(backup.mirrors).map(([k, v]) => [k, v.length])),
  links: Object.fromEntries(Object.entries(backup.links).map(([k, v]) => [k, v.length])),
}, null, 1));
await prisma.$disconnect();
