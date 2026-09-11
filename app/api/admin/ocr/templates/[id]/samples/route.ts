// GET → τα δείγματα εκπαίδευσης του προτύπου· POST multipart → ανεβάζει ως 20 αρχεία (spec §11).
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { SampleError, SAMPLE_ERROR, SAMPLE_MAX_BYTES } from '@/lib/templates/sample';
import { addSample, listSamples, refreshTrainingScore, SAMPLES_PER_REQUEST } from '@/lib/templates/samples';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Κάθε αρχείο περνά από pdfium (σελίδες + αποτύπωμα) πριν φτάσει στο Bunny — 20 από αυτά δεν χωρούν σε 60 s.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await requirePermission('ocr.read');
  const { id } = await params;
  return NextResponse.json({ samples: await listSamples(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll('files') ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: 'file_required' }, { status: 400 });
  if (files.length > SAMPLES_PER_REQUEST) {
    return NextResponse.json({ error: 'too_many', message: `Έως ${SAMPLES_PER_REQUEST} αρχεία ανά αίτημα` }, { status: 400 });
  }

  // Σειριακά και ανεκτικά: ένα σκουπίδι ανάμεσα σε 20 σωστά αρχεία δεν ακυρώνει το ανέβασμα —
  // ο χρήστης παίρνει πίσω ό,τι μπήκε και τον λόγο για ό,τι δεν μπήκε.
  const added = [];
  const failed: { fileName: string; error: string }[] = [];
  for (const file of files) {
    if (file.size > SAMPLE_MAX_BYTES) { failed.push({ fileName: file.name, error: 'too_large' }); continue; }
    try {
      added.push(await addSample(id, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, userId: u.id }));
    } catch (e) {
      if (e instanceof SampleError) {
        // Ένα πρότυπο που δεν υπάρχει δεν θα αποκτήσει νόημα στο επόμενο αρχείο: σταματάμε.
        if (e.code === 'not_found') return NextResponse.json(SAMPLE_ERROR.not_found.body, { status: 404 });
        failed.push({ fileName: file.name, error: e.code });
        continue;
      }
      console.error('[templates] sample upload failed', id, file.name, (e as Error).message);
      failed.push({ fileName: file.name, error: 'upload_failed' });
    }
  }

  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.samples.add', resource: 'extractionTemplate', resourceId: id, metadata: { added: added.length, failed: failed.length } });
  return NextResponse.json({ samples: added, failed, training: await refreshTrainingScore(id) });
}
