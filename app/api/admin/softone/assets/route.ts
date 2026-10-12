import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { AssetCreateError, createAsset, planAsset } from '@/lib/softone-sync/asset-create';
import { assignLineAsset } from '@/lib/ocr/line-asset';

export const dynamic = 'force-dynamic';

// GET ?q= — αναζήτηση στον καθρέφτη παγίων (ενεργά).
export async function GET(req: Request) {
  await requirePermission('ocr.read');
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  const rows = await prisma.softoneAsset.findMany({
    where: {
      isActive: true,
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q } }] } : {}),
    },
    orderBy: [{ code: 'asc' }],
    take: 25,
    select: { mtrl: true, code: true, name: true, acnmsk: true },
  });
  return NextResponse.json({ results: rows });
}

const Body = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  mtrAcn: z.number().int().positive(),
  mtrCategory: z.number().int().positive().nullable(),
  vat: z.string().trim().min(1).max(20),
  /** Γραμμή παραστατικού που αντιστοιχίζεται αμέσως στο νέο πάγιο. */
  lineId: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
});

// POST — νέο πάγιο στο SoftOne (setData ASSET). `dryRun` = ακριβώς ό,τι θα σταλεί, χωρίς εγγραφή.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', message: 'Δώσε κωδικό, περιγραφή, κατηγορία και ΦΠΑ.' }, { status: 400 });
  const { lineId, dryRun, ...input } = parsed.data;
  try {
    if (dryRun) return NextResponse.json({ dryRun: true, ...(await planAsset(input)) });
    const asset = await createAsset(input);
    await logAudit({
      userId: u.id, userEmail: u.email, action: 'ocr.item.create_softone', resource: 'softone_asset', resourceId: String(asset.mtrl),
      metadata: { kind: 'asset', code: asset.code, name: asset.name, mtrAcn: input.mtrAcn, mtrCategory: input.mtrCategory, vat: input.vat, lineId: lineId ?? null },
    }).catch(() => null);
    const line = lineId ? await assignLineAsset(lineId, asset.mtrl) : null;
    return NextResponse.json({ ok: true, asset, line });
  } catch (e) {
    if (e instanceof AssetCreateError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    return NextResponse.json({ error: 'softone_error', message: (e as Error).message }, { status: 502 });
  }
}
