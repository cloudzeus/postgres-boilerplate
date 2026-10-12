// lib/softone-sync/asset-create.ts — SERVER. Νέο πάγιο από γραμμή παραστατικού.
//
// Τι στέλνεται (βλ. `buildAssetPayload`): κωδικός, περιγραφή, λογιστική κατηγορία (ASSETGL — ορίζει
// μέθοδο/συντελεστή απόσβεσης και λογαριασμούς), εμπορική κατηγορία, ΦΠΑ, λογαριασμός αγορών και
// μονάδες μέτρησης αντιγραμμένες από υπάρχον πάγιο. Ο κωδικός προτείνεται ως «λογαριασμός αγορών
// της κατηγορίας + αύξων» (`nextAssetCode`), όπως είναι στημένα τα υπάρχοντα πάγια.
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import {
  SoftoneError, softoneAssetUnitTemplate, softoneCreateAsset, softoneFetchAssetLookups, buildAssetPayload,
  type AssetLookups, type CreateAssetInput,
} from '@/lib/softone';
import { nextAssetCode } from '@/lib/ocr/asset-code';
import { VAT_RATE_MAP_SETTING, buildVatRateMap, parseVatRateOverrides } from '@/lib/ocr/vat-map';

export interface AssetFormData extends AssetLookups {
  /** Προτεινόμενος κωδικός ανά λογιστική κατηγορία. */
  proposedCode: Record<number, string>;
  vats: { code: string; label: string; rate: number | null }[];
  /** Συντελεστής → κωδικός ΦΠΑ (ίδιος χάρτης με την καταχώριση). */
  vatByRate: Record<number, number>;
  whouse: number | null;
}

export async function loadAssetFormData(): Promise<AssetFormData> {
  const [lookups, assets, vatRows, overrides, whouse] = await Promise.all([
    softoneFetchAssetLookups(),
    prisma.softoneAsset.findMany({ select: { code: true } }),
    prisma.vatCategory.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }], select: { code: true, rate: true, descr: true } }),
    getSetting<unknown>(VAT_RATE_MAP_SETTING, {}).catch(() => ({})),
    getSetting<unknown>('integrations.softoneAssetWhouse', null).catch(() => null),
  ]);
  const codes = assets.map((a) => a.code);
  const proposedCode: Record<number, string> = {};
  for (const g of lookups.glCategories) if (g.acnmsk) proposedCode[g.mtrAcn] = nextAssetCode(g.acnmsk, codes);
  const { byRate } = buildVatRateMap(
    vatRows.map((v) => ({ code: v.code, rate: v.rate == null ? null : Number(v.rate), descr: v.descr, isActive: true })),
    parseVatRateOverrides(overrides),
  );
  return {
    ...lookups,
    proposedCode,
    vats: vatRows.map((v) => ({ code: v.code, label: v.descr ?? v.code, rate: v.rate == null ? null : Number(v.rate) })),
    vatByRate: byRate,
    whouse: whouse != null && Number.isFinite(Number(whouse)) ? Number(whouse) : null,
  };
}

export class AssetCreateError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface AssetCreateRequest {
  code: string;
  name: string;
  mtrAcn: number;
  mtrCategory: number | null;
  vat: string;
}

/** Χτίζει το payload (για προεπισκόπηση και για εγγραφή) — χωρίς να γράψει τίποτα. */
export async function planAsset(req: AssetCreateRequest): Promise<CreateAssetInput & { payload: ReturnType<typeof buildAssetPayload> }> {
  const lookups = await softoneFetchAssetLookups();
  const gl = lookups.glCategories.find((g) => g.mtrAcn === req.mtrAcn);
  if (!gl) throw new AssetCreateError('unknown_gl', 'Άγνωστη λογιστική κατηγορία παγίου.');
  if (req.mtrCategory != null && !lookups.categories.some((c) => c.mtrCategory === req.mtrCategory)) {
    throw new AssetCreateError('unknown_category', 'Άγνωστη εμπορική κατηγορία παγίου.');
  }
  const taken = await prisma.softoneAsset.findFirst({ where: { code: req.code }, select: { mtrl: true } });
  if (taken) throw new AssetCreateError('code_taken', `Ο κωδικός ${req.code} υπάρχει ήδη σε πάγιο (MTRL ${taken.mtrl}).`, 409);
  const units = await softoneAssetUnitTemplate(req.mtrAcn);
  if (!units) throw new AssetCreateError('no_template', 'Δεν βρέθηκε υπάρχον πάγιο για να αντιγραφούν οι μονάδες μέτρησης.');
  const input: CreateAssetInput = {
    code: req.code, name: req.name, mtrAcn: req.mtrAcn, mtrCategory: req.mtrCategory, vat: req.vat, acnmsk: gl.acnmsk, units,
  };
  return { ...input, payload: buildAssetPayload(input) };
}

/** Δημιουργεί το πάγιο στο SoftOne και το γράφει αμέσως στον καθρέφτη. */
export async function createAsset(req: AssetCreateRequest): Promise<{ mtrl: number; code: string; name: string }> {
  const plan = await planAsset(req);
  let mtrl: number;
  try {
    mtrl = await softoneCreateAsset(plan);
  } catch (e) {
    if (e instanceof SoftoneError) throw new AssetCreateError('softone_error', e.message, 502);
    throw e;
  }
  const data = { code: plan.code, name: plan.name, vat: plan.vat, mtrAcn: plan.mtrAcn, mtrCategory: plan.mtrCategory, acnmsk: plan.acnmsk, isActive: true, syncedAt: new Date() };
  await prisma.softoneAsset.upsert({ where: { mtrl }, update: data, create: { mtrl, ...data } });
  return { mtrl, code: plan.code, name: plan.name };
}
