import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { isExtractDocType, type ExtractDocType } from '@/lib/ocr/templates';
import { reextractDocument, ReextractError } from '@/lib/ocr/reextract-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Re-extraction plus a template run (one vision call per region) easily outruns the 60s default.
export const maxDuration = 300;

/** ΕΠΑΝΑΣΑΡΩΣΗ ενός παραστατικού — βλ. `lib/ocr/reextract-server.ts` (ο ίδιος πυρήνας και στη μαζική). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('ocr.create');
  const { id } = await params;

  // Ο τύπος της ΔΕΥΤΕΡΗΣ ανάγνωσης. Προεπιλογή «auto»: αν η πρώτη ανάγνωση είχε ταξινομήσει
  // λάθος (π.χ. απόδειξη που ήταν τιμολόγιο), η επανεκτέλεση είναι ακριβώς η στιγμή να το
  // διορθώσει. Παλιοί clients στέλνουν άδειο σώμα — και παίρνουν το ίδιο «auto».
  const body = await req.json().catch(() => null) as { docType?: unknown; bulk?: unknown } | null;
  const requested = body?.docType;
  if (requested !== undefined && !isExtractDocType(requested)) {
    return NextResponse.json({ error: `Invalid docType: ${String(requested)}` }, { status: 400 });
  }
  const docType: ExtractDocType = (requested as ExtractDocType | undefined) ?? 'auto';

  try {
    const r = await reextractDocument(id, docType, { id: user.id, email: user.email }, { source: body?.bulk === true ? 'bulk' : 'single' });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ReextractError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'server_error', message: (e as Error).message }, { status: 500 });
  }
}
