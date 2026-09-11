// GET / PATCH {expected} / DELETE ένα δείγμα εκπαίδευσης (spec §11).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR } from '@/lib/templates/sample';
import { deleteSample, toSampleDto, verifySample } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; sampleId: string }> };

/**
 * Το δείγμα ΠΡΕΠΕΙ να ανήκει στο πρότυπο της διαδρομής: αλλιώς το `/templates/A/samples/<δείγμα του B>`
 * θα επέτρεπε να πειράξει κανείς ξένο πρότυπο μέσω ενός id που δεν ελέγχθηκε ποτέ.
 */
async function ownedSample(templateId: string, sampleId: string) {
  const s = await prisma.templateSample.findUnique({
    where: { id: sampleId },
    select: { id: true, templateId: true, fileName: true, status: true, pageCount: true, score: true, expected: true, lastResult: true, isPrimary: true, createdAt: true },
  });
  return s && s.templateId === templateId ? s : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id, sampleId } = await params;
  const s = await ownedSample(id, sampleId);
  if (!s) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(toSampleDto(s));
}

// Οι τιμές που επιβεβαιώνει ο χρήστης: σκαλάρια ή πίνακες γραμμών (TABLE). Ό,τι δεν είναι τέτοιο
// δεν έχει νόημα να συγκριθεί με ανάγνωση πεδίου.
const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const PatchBody = z.object({
  expected: z.record(z.string().min(1).max(80), z.union([Scalar, z.array(z.union([Scalar, z.record(z.string(), Scalar)]))])),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id, sampleId } = await params;
  if (!(await ownedSample(id, sampleId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  try {
    const { sample, training } = await verifySample(sampleId, parsed.data.expected);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.verify', resource: 'extractionTemplate', resourceId: id, metadata: { sampleId, score: sample.score } });
    return NextResponse.json({ sample, training });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id, sampleId } = await params;
  if (!(await ownedSample(id, sampleId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const { training } = await deleteSample(sampleId);
    await logAudit({ userId: u.id, userEmail: u.email, action: 'template.sample.delete', resource: 'extractionTemplate', resourceId: id, metadata: { sampleId } });
    return NextResponse.json({ ok: true, training });
  } catch (e) {
    if (e instanceof SampleError) return NextResponse.json(SAMPLE_ERROR[e.code].body, { status: SAMPLE_ERROR[e.code].status });
    throw e;
  }
}
