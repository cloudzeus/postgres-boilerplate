// POST → βάζει το πρότυπο να διαβάσει ΕΝΑ δείγμα και κρατά το αποτέλεσμα (spec §11).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { SampleError, SAMPLE_ERROR } from '@/lib/templates/sample';
import { readSample } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Μια δεκάδα περιοχές = μια δεκάδα κλήσεις όρασης· το προεπιλεγμένο όριο των 60 s δεν φτάνει.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; sampleId: string }> }) {
  await requirePermission('ocr.categorize');
  const { id, sampleId } = await params;
  const owned = await prisma.templateSample.findUnique({ where: { id: sampleId }, select: { templateId: true } });
  if (!owned || owned.templateId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    return NextResponse.json(await readSample(sampleId));
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    console.error('[templates] sample read failed', sampleId, (e as Error).message);
    return NextResponse.json({ error: 'read_failed', message: 'Η ανάγνωση του δείγματος απέτυχε' }, { status: 502 });
  }
}
