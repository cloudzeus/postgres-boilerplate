import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { softoneFetchCountries, softoneFetchKadIndex, softoneFetchTaxOffices, SoftoneError } from '@/lib/softone';
import { readTraderLive, updateTrader } from '@/lib/softone-sync/trader-update';
import { TRADER_OBJECT_BY_SODTYPE, TRADER_EDIT_FIELDS } from '@/lib/trader-update';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idOf = async (params: Promise<{ trdr: string }>) => {
  const n = Number((await params).trdr);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// GET — η καρτέλα όπως είναι ΤΩΡΑ στη SoftOne + τα μητρώα της φόρμας (Δ.Ο.Υ., χώρες, ετικέτες ΚΑΔ).
export async function GET(_req: Request, { params }: { params: Promise<{ trdr: string }> }) {
  await requirePermission('metadata.read');
  const trdr = await idOf(params);
  if (!trdr) return NextResponse.json({ error: 'invalid_trdr' }, { status: 400 });
  try {
    const live = await readTraderLive(trdr);
    const [offices, countries, kadIdx] = await Promise.all([
      softoneFetchTaxOffices().catch(() => []),
      softoneFetchCountries().catch(() => []),
      live.values.kad || live.values.kad1 ? softoneFetchKadIndex().catch(() => null) : Promise.resolve(null),
    ]);
    const kadLabel = (id: number | null | undefined) => {
      if (!id || !kadIdx) return null;
      const r = kadIdx.rows.find((x) => x.id === id);
      return r ? `${r.code} — ${r.name}` : `#${id}`;
    };
    return NextResponse.json({
      trdr, sodtype: live.sodtype, code: live.code, values: live.values,
      editable: Boolean(TRADER_OBJECT_BY_SODTYPE[live.sodtype]),
      kadLabels: { kad: kadLabel(live.values.kad), kad1: kadLabel(live.values.kad1) },
      offices: offices.filter((o) => o.isActive).map((o) => ({ key: o.key, code: o.code, name: o.name })),
      countries: countries.map((c) => ({ id: c.id, name: c.name, shortcut: c.shortcut })),
    });
  } catch (e) {
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}

const str = z.string().max(200).nullable().optional();
const Body = z.object({
  values: z.object({
    ...Object.fromEntries(TRADER_EDIT_FIELDS.map((f) => [f.key, str])),
    kad: z.number().int().positive().nullable().optional(),
    kad1: z.number().int().positive().nullable().optional(),
  }),
  dryRun: z.boolean().optional(),
});

// PATCH { values, dryRun } — τροποποίηση στη SoftOne (μόνο ό,τι άλλαξε, με επιβεβαίωση μετά).
export async function PATCH(req: Request, { params }: { params: Promise<{ trdr: string }> }) {
  const u = await requirePermission('metadata.manage');
  const trdr = await idOf(params);
  if (!trdr) return NextResponse.json({ error: 'invalid_trdr' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  try {
    const out = await updateTrader(trdr, parsed.data.values, { dryRun: parsed.data.dryRun });
    if (!parsed.data.dryRun && out.changes.length) {
      await logAudit({
        userId: u.id, action: 'softone.trader_update', resource: 'SoftoneTrader', resourceId: String(trdr),
        metadata: { changes: out.changes, unapplied: out.unapplied.map((c) => c.key), sideEffects: out.sideEffects },
      }).catch(() => null);
    }
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof SoftoneError ? 422 : 502;
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status });
  }
}
