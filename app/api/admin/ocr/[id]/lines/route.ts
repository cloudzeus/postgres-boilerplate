import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { editDocumentLines, LineEditError } from '@/lib/ocr/line-edit-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = z.number().finite().nullable();
const str = z.string().max(500).nullable();
const Values = z.object({
  name: z.string().max(500), code: str, unit: z.string().max(40).nullable(),
  quantity: num, unitPrice: num, discount: num, net: num, vatRate: num,
  serials: z.array(z.string().max(60)).max(500).optional(),
});
const Body = z.object({
  update: z.array(Values.partial().extend({ rowIndex: z.number().int().min(0) })).max(500).optional(),
  add: z.array(Values).max(200).optional(),
  remove: z.array(z.number().int().min(0)).max(500).optional(),
});

// POST { update, add, remove } — χειροκίνητη διόρθωση γραμμών. Οι γραμμές που μένουν κρατούν
// αντιστοίχιση SoftOne, αναλυτικά και επιμερισμούς τους (βλ. lib/ocr/line-edit-server.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await editDocumentLines(id, parsed.data, { id: u.id, email: u.email }));
  } catch (e) {
    if (e instanceof LineEditError) return NextResponse.json({ error: 'line_edit', message: e.message }, { status: 422 });
    return NextResponse.json({ error: 'server_error', message: (e as Error).message }, { status: 500 });
  }
}
