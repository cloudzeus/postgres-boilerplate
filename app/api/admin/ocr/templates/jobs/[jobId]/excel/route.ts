// GET → τα διαβασμένα αρχεία της εργασίας ως .xlsx (ίδιος εξαγωγέας με τους φακέλους, spec §12).
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { buildSheets } from '@/lib/templates/excel';
import { sheetsToXlsx, xlsxResponse } from '@/lib/templates/excel-server';
import { jobSheetInputs } from '@/lib/templates/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  await requirePermission('ocr.read');
  const { jobId } = await params;
  const out = await jobSheetInputs(jobId);
  if (!out) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Καμία επιτυχημένη ανάγνωση = κανένα φύλλο. Ένα άδειο βιβλίο θα διαβαζόταν ως «δεν βρέθηκε τίποτα
  // στα τιμολόγια» αντί για «τίποτα δεν διαβάστηκε ακόμη».
  if (out.inputs.length === 0) return NextResponse.json({ error: 'empty', message: 'Καμία ολοκληρωμένη ανάγνωση ακόμη' }, { status: 404 });
  return xlsxResponse(await sheetsToXlsx(buildSheets(out.inputs)), out.fileName);
}
