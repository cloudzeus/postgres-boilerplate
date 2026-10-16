// lib/foreign-vat-check.ts — SERVER. Έλεγχος ΞΕΝΟΥ ΑΦΜ (εκτός Ελλάδας) κατά παραγγελία.
//
// Πηγές: οι ΕΠΙΣΗΜΕΣ δωρεάν αρχές μέσω `lib/vat-check` — VIES (ΕΕ-27 + Β. Ιρλανδία), HMRC (ΗΒ, με
// στοιχεία εφαρμογής), Brønnøysund (Νορβηγία), UID-Register (Ελβετία). Χωρίς εμπορικό πάροχο: κανένα
// μηνιαίο όριο, κανένα κόστος. Το taxid.dev μένει ΜΟΝΟ ως εφεδρεία για το ΗΒ όσο δεν έχουν δοθεί
// στοιχεία HMRC (Ρυθμίσεις → Διασυνδέσεις).
//
// Με τον ΔΙΚΟ ΜΑΣ ΑΦΜ (`company.ownVat`) το VIES επιστρέφει ΑΡΙΘΜΟ ΕΛΕΓΧΟΥ — αποδεικτικό ότι
// ελέγξαμε τον αντισυμβαλλόμενο. Κάθε έλεγχος γράφεται στο `VatCheck` (ιστορικό + cache 30 ημερών).
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';
import { normalizeVatId } from '@/lib/ocr/validate';
import { checkVat, parseVatTarget, type VatCheckResult, type VatTraderInput } from '@/lib/vat-check';

const TAXID_URL = 'https://www.taxid.dev/api/v1/validate';
/** Πόσο ισχύει ένας επιτυχημένος έλεγχος πριν ξαναρωτήσουμε την αρχή. */
export const VAT_CACHE_DAYS = 30;

export type ForeignVatResult = VatCheckResult & {
  /** Από το ιστορικό (όχι νέα κλήση) — με την ημερομηνία του αρχικού ελέγχου στο `checkedAt`. */
  cached?: boolean;
};

export async function taxidApiKey(): Promise<string | null> {
  const fromSettings = await getSetting<string>('integrations.taxidApiKey').catch(() => null);
  const k = String(fromSettings ?? process.env.TAXID_API_KEY ?? '').trim();
  return k || null;
}

async function hmrcConfig() {
  const [id, secret, env, vrn] = await Promise.all([
    getSetting<string>('integrations.hmrcClientId').catch(() => null),
    getSetting<string>('integrations.hmrcClientSecret').catch(() => null),
    getSetting<string>('integrations.hmrcEnv').catch(() => null),
    getSetting<string>('integrations.hmrcRequesterVrn').catch(() => null),
  ]);
  const clientId = String(id ?? process.env.HMRC_CLIENT_ID ?? '').trim();
  const clientSecret = String(secret ?? process.env.HMRC_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, env: String(env ?? '').trim() === 'sandbox' ? 'sandbox' as const : 'production' as const, requesterVrn: vrn ? String(vrn) : null };
}

/** Εφεδρεία ΗΒ μέσω taxid.dev — μόνο με κλειδί και μόνο όταν δεν υπάρχουν στοιχεία HMRC. */
async function taxidFallback(t: { countryCode: string; number: string; vat: string }): Promise<VatCheckResult | null> {
  if (t.countryCode !== 'GB') return null;
  const key = await taxidApiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${TAXID_URL}/GB/${encodeURIComponent(t.number)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (d.status === 'service_unavailable') return null;
    const s = (v: unknown) => { const x = String(v ?? '').trim(); return x && !/^-+$/.test(x) ? x : null; };
    return {
      vat: t.vat, countryCode: 'GB', valid: d.valid === true, name: s(d.company_name), address: s(d.company_address),
      provider: 'fallback', source: `${s(d.source) ?? 'HMRC'} μέσω TaxID`, consultationNumber: null, checkedAt: new Date().toISOString(),
    };
  } catch { return null; }
}

/** Ο τελευταίος ΟΡΙΣΤΙΚΟΣ έλεγχος (valid true/false) του ίδιου ΑΦΜ μέσα στο παράθυρο cache. */
async function cachedCheck(vat: string): Promise<ForeignVatResult | null> {
  const since = new Date(Date.now() - VAT_CACHE_DAYS * 86_400_000);
  const row = await prisma.vatCheck.findFirst({
    where: { vat, createdAt: { gte: since }, valid: { not: null } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null);
  if (!row) return null;
  return {
    vat: row.vat, countryCode: row.countryCode, valid: row.valid, name: row.name, address: row.address,
    provider: (row.provider as VatCheckResult['provider']) ?? null, source: row.source,
    consultationNumber: row.consultationNumber, checkedAt: row.createdAt.toISOString(),
    match: (row.match as VatCheckResult['match']) ?? null, ...(row.message ? { message: row.message } : {}), cached: true,
  };
}

/**
 * Έλεγχος ενός ΞΕΝΟΥ ΑΦΜ. Δεν πετάει ποτέ: κάθε αποτυχία είναι `valid: null`.
 * `force`: αγνοεί το ιστορικό (π.χ. νέος έλεγχος την ημέρα της συναλλαγής).
 */
export async function checkForeignVat(
  raw: string, opts: { trader?: VatTraderInput | null; force?: boolean; userId?: string | null } = {},
): Promise<ForeignVatResult> {
  const n = normalizeVatId(raw);
  const t = parseVatTarget(n?.id ?? raw);
  if (!t || t.countryCode === 'EL' || n?.country === 'GR') {
    return {
      vat: n?.id ?? String(raw ?? ''), countryCode: t?.countryCode ?? '', valid: null, name: null, address: null,
      provider: null, source: null, consultationNumber: null, checkedAt: new Date().toISOString(),
      error: 'invalid_format', message: 'Ο έλεγχος αφορά ΑΦΜ εκτός Ελλάδας με πρόθεμα χώρας (π.χ. IT01808880270, CHE-116.281.710, NO923609016MVA).',
    };
  }
  if (!opts.force) {
    const hit = await cachedCheck(t.vat);
    if (hit) return hit;
  }
  // Ο ΔΙΚΟΣ ΜΑΣ ΑΦΜ (για τον αριθμό ελέγχου): `company.ownVat` / COMPANY_OWN_VAT, αλλιώς το «ΑΦΜ» των στοιχείων εταιρίας.
  const own = (await resolveOwnAfm().catch(() => null))
    ?? (String(await getSetting<string>('company.vat').catch(() => '') ?? '').replace(/\D+/g, '') || null);
  const requesterVat = own && /^\d{9}$/.test(own) ? `EL${own}` : null;
  const result = await checkVat(t.vat, {
    requesterVat,
    hmrc: await hmrcConfig(),
    fallback: taxidFallback,
  }, opts.trader ?? null);
  await prisma.vatCheck.create({
    data: {
      vat: result.vat, countryCode: result.countryCode, valid: result.valid, name: result.name, address: result.address,
      provider: result.provider, source: result.source, consultationNumber: result.consultationNumber,
      requester: result.provider === 'vies' && result.consultationNumber ? requesterVat : null,
      match: result.match ?? undefined, error: result.error ?? null, message: result.message ?? null,
      createdById: opts.userId ?? null,
    },
  }).catch((e) => console.error('[vat-check] history not saved', (e as Error).message));
  return result;
}

/** Το ιστορικό ελέγχων ενός ΑΦΜ (νεότεροι πρώτοι). */
export async function vatCheckHistory(raw: string, take = 10) {
  const n = normalizeVatId(raw);
  const t = parseVatTarget(n?.id ?? raw);
  if (!t) return [];
  return prisma.vatCheck.findMany({
    where: { vat: t.vat }, orderBy: { createdAt: 'desc' }, take,
    select: { id: true, valid: true, name: true, source: true, consultationNumber: true, error: true, createdAt: true },
  });
}
