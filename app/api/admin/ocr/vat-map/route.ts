import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission, requireAnyPermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { getSetting, setSetting } from '@/lib/settings';
import {
  VAT_RATE_MAP_SETTING, buildVatRateMap, parseVatRateOverrides, suggestVatCategories,
} from '@/lib/ocr/vat-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Η **αντιστοίχιση συντελεστή ΦΠΑ → κατηγορίας ΦΠΑ του SoftOne**, για τους συντελεστές που το
 * μητρώο δεν δηλώνει μόνο του.
 *
 * Δεν είναι κενό του SoftOne και δεν λύνεται με συγχρονισμό: οι μηδενικές κατηγορίες του πελάτη
 * («Μηδενικός Συντελεστής ΦΠΑ 0 %», «Άρθρο 39α 0 %») έρχονται με **κενό ποσοστό**, οπότε καμία
 * αυτόματη αντιστοίχιση δεν μπορεί να βγάλει κλειδί `0`. Εδώ το λέει ο άνθρωπος **μία φορά**,
 * διαλέγοντας από το ΙΔΙΟ συγχρονισμένο μητρώο. Κανένας κωδικός δεν εφευρίσκεται ποτέ.
 */
const ACTIVE = { isActive: true } as const;
const SELECT = { code: true, descr: true, rate: true } as const;
const ORDER = [{ order: 'asc' }, { code: 'asc' }] as const;

/** GET ?rate=0 — οι επιλογές του μητρώου, με τις πιθανές πρώτες, και ο τρέχων χάρτης. */
export async function GET(req: Request) {
  await requireAnyPermission('ocr.read', 'ocr.categorize', 'metadata.read');
  const raw = new URL(req.url).searchParams.get('rate');
  const rate = raw == null || raw === '' ? null : Number(String(raw).replace(',', '.'));

  const [rows, setting] = await Promise.all([
    prisma.vatCategory.findMany({ where: ACTIVE, orderBy: [...ORDER], select: SELECT }),
    getSetting<unknown>(VAT_RATE_MAP_SETTING, {}),
  ]);
  const overrides = parseVatRateOverrides(setting);
  const map = buildVatRateMap(rows.map((r) => ({ ...r, isActive: true })), overrides);

  return NextResponse.json({
    rate: rate != null && Number.isFinite(rate) ? rate : null,
    byRate: map.byRate,
    overridden: map.overridden,
    ignored: map.ignored,
    options: suggestVatCategories(
      rows.map((r) => ({ ...r, isActive: true })),
      rate != null && Number.isFinite(rate) ? rate : null,
    ).map((r) => ({ code: r.code, descr: r.descr ?? '', rate: r.rate })),
  });
}

const Body = z.object({
  /** Ο συντελεστής της γραμμής (π.χ. `0`). */
  rate: z.number().finite().min(0).max(100),
  /** `VatCategory.code`. `null` αφαιρεί την αντιστοίχιση. */
  code: z.string().trim().max(20).nullable(),
});

/** POST { rate, code } — γράφει (ή σβήνει) μία αντιστοίχιση. */
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { rate, code } = parsed.data;

  const setting = await getSetting<unknown>(VAT_RATE_MAP_SETTING, {});
  const overrides = parseVatRateOverrides(setting);
  const key = String(rate);

  if (!code) {
    delete overrides[key];
  } else {
    // Ο κωδικός ΠΡΕΠΕΙ να υπάρχει και να είναι ενεργός στο μητρώο. Το SoftOne θα απέρριπτε
    // οτιδήποτε άλλο· καλύτερα να το πούμε εδώ, με ελληνικά, παρά να σκάσει η καταχώριση.
    const row = await prisma.vatCategory.findUnique({ where: { code }, select: { code: true, descr: true, isActive: true } });
    if (!row || !row.isActive) {
      return NextResponse.json({
        error: 'unknown_vat_code', field: 'code',
        message: `Ο κωδικός ΦΠΑ «${code}» δεν υπάρχει (ή δεν είναι ενεργός) στο συγχρονισμένο μητρώο.`,
      }, { status: 422 });
    }
    overrides[key] = row.code;
  }

  await setSetting(VAT_RATE_MAP_SETTING, overrides, u.id);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.vat.map', resource: 'vat_category', resourceId: code ?? key,
    metadata: { rate, code },
  }).catch(() => null);

  return NextResponse.json({ ok: true, rate, code, overrides });
}
