// SERVER: «μετατροπή» πιστωτή σε προμηθευτή (και αντίστροφα) — νέα καρτέλα από τα στοιχεία της
// παλιάς. Γιατί όχι αλλαγή SODTYPE: βλ. `lib/trader-convert.ts`.
//
// Ροή: ζωντανή ανάγνωση της πηγής → (υπάρχει ΗΔΗ καρτέλα του άλλου τύπου στον ΑΦΜ; σύνδεση, όχι
// δεύτερη) → δημιουργία με τον ΕΝΑΝ δημιουργό της εφαρμογής (`createTraderInSoftone`: setData,
// επαλήθευση, καθρέφτης, σύνδεση των εκκρεμών παραστατικών που ζητούν αυτόν τον τύπο) →
// προαιρετικά απενεργοποίηση της πηγής, με επαλήθευση.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import {
  softoneCall, softoneFetchCountries, softoneFetchTaxOffices, softoneGetTable, softoneNextTraderCode,
  SoftoneError, TRADER_KIND_SODTYPE,
} from '@/lib/softone';
import { softoneCodeRules } from '@/lib/softone-code-rules';
import { traderCodeMaskKey } from '@/lib/trader-code';
import { readTraderLive } from '@/lib/softone-sync/trader-update';
import { createTraderInSoftone, findExistingTrader, type CreateTraderResult } from '@/lib/ocr/create-trader';
import { CONVERSION_BY_SODTYPE, conversionErrors, conversionInput, type ConversionExtra, type ConvertKind } from '@/lib/trader-convert';

/** Ο επόμενος ελεύθερος κωδικός του τύπου — ίδια λογική με την ουρά «Νέοι συναλλασσόμενοι». */
export async function proposeTraderCode(kind: ConvertKind | 'debtor') {
  const [mask, mirror, rules] = await Promise.all([
    getSetting<string>(traderCodeMaskKey(kind), '').catch(() => ''),
    prisma.softoneTrader
      .findMany({ where: { sodtype: TRADER_KIND_SODTYPE[kind] }, select: { code: true } })
      .catch(() => [] as { code: string }[]),
    softoneCodeRules(kind),
  ]);
  const next = await softoneNextTraderCode(kind, { mask: mask ?? '', erpMask: rules.code, fallbackCodes: mirror.map((r) => r.code) });
  return { ...next, rule: { mask: rules.code, known: rules.known } };
}

async function readExtra(trdr: number): Promise<ConversionExtra> {
  const rows = await softoneGetTable('TRDR', ['TRDR', 'VATSTS', 'PAYMENT', 'SOCURRENCY'], `TRDR=${trdr}`).catch(() => []);
  const r = rows.find((x) => Number(x.TRDR) === trdr);
  return { vatStatus: r?.VATSTS ?? null, payment: r?.PAYMENT ?? null, currency: r?.SOCURRENCY ?? null };
}

/** Εκκρεμή (μη καταχωρισμένα) παραστατικά της εφαρμογής που δείχνουν στην καρτέλα-πηγή. */
const pendingDocsOf = (trdr: number) =>
  prisma.ocrDocument.count({ where: { softoneTrdr: trdr, postStatus: { not: 'POSTED' } } }).catch(() => 0);

export async function previewTraderConversion(trdr: number) {
  const live = await readTraderLive(trdr);
  const route = CONVERSION_BY_SODTYPE[live.sodtype];
  if (!route) throw new SoftoneError('Μόνο πιστωτές και προμηθευτές μετατρέπονται.');
  const [existing, proposal, docs, offices, countries] = await Promise.all([
    live.values.afm ? findExistingTrader(live.values.afm, route.toSodtype) : Promise.resolve(null),
    proposeTraderCode(route.to).catch(() => null),
    pendingDocsOf(trdr),
    live.values.irsData ? softoneFetchTaxOffices().catch(() => []) : Promise.resolve([]),
    live.values.country ? softoneFetchCountries().catch(() => []) : Promise.resolve([]),
  ]);
  const office = offices.find((o) => o.key === live.values.irsData);
  return {
    trdr, sodtype: live.sodtype, code: live.code, values: live.values,
    labels: {
      irsData: office ? `${office.name} (${office.code})` : live.values.irsData ?? null,
      country: countries.find((c) => c.id === live.values.country)?.name ?? live.values.country ?? null,
    },
    route,
    existing,
    proposedCode: proposal?.code ?? null,
    codeRule: proposal?.rule ?? null,
    pendingDocs: docs,
  };
}

export interface TraderConversionResult extends CreateTraderResult {
  source: { trdr: number; code: string; sodtype: number };
  /** `true` = η πηγή απενεργοποιήθηκε ΚΑΙ η νέα ανάγνωση το επιβεβαίωσε. */
  sourceDeactivated: boolean;
}

export async function convertTrader(
  trdr: number,
  opts: { code: string | null; deactivateSource: boolean; actor: { id: string; email: string } | null },
): Promise<TraderConversionResult> {
  const live = await readTraderLive(trdr);
  const errors = conversionErrors(live.sodtype, live.values, opts.code);
  if (errors.length) throw new SoftoneError(errors.join(' '));
  const route = CONVERSION_BY_SODTYPE[live.sodtype];

  const input = conversionInput(live.values, await readExtra(trdr), opts.code);
  const created = await createTraderInSoftone({ afm: input.afm, kind: route.to, input, actor: opts.actor });
  const warnings = [...created.warnings];

  let sourceDeactivated = false;
  if (opts.deactivateSource) {
    const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number }>('setData', {
      OBJECT: route.fromObject, KEY: String(trdr), DATA: { [route.fromObject]: [{ ISACTIVE: 0 }] },
    }).catch((e) => ({ success: false, error: (e as Error).message }));
    // `success:true` ΔΕΝ αποδεικνύει τίποτα — η νέα ανάγνωση αποφασίζει.
    const back = res.success === false ? [] : await softoneGetTable('TRDR', ['TRDR', 'ISACTIVE'], `TRDR=${trdr}`).catch(() => []);
    sourceDeactivated = back.some((r) => Number(r.TRDR) === trdr && String(r.ISACTIVE) === '0');
    if (sourceDeactivated) {
      await prisma.softoneTrader.update({ where: { trdr }, data: { isActive: false } }).catch(() => null);
    } else {
      warnings.push('source_not_deactivated');
    }
  }

  if (opts.actor) {
    await logAudit({
      userId: opts.actor.id, userEmail: opts.actor.email,
      action: 'softone.trader_convert', resource: 'SoftoneTrader', resourceId: String(trdr),
      metadata: {
        from: { trdr, code: live.code, sodtype: live.sodtype }, to: { trdr: created.trdr, code: created.code, kind: route.to },
        existing: created.existing ?? false, docsUpdated: created.docsUpdated, sourceDeactivated, warnings,
      },
    }).catch(() => null);
  }
  return { ...created, warnings, source: { trdr, code: live.code, sodtype: live.sodtype }, sourceDeactivated };
}
