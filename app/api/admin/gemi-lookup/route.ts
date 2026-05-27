import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { searchCompanies, getCompany, getCompanyDocuments, mapGemiCompany, GemiError } from '@/lib/gemi';

const Schema = z.object({
  afm: z.string().regex(/^\d{9}$/).optional(),
  arGemi: z.string().regex(/^\d+$/).optional(),
}).refine((v) => v.afm || v.arGemi, { message: 'Δώσε ΑΦΜ ή Αριθμό ΓΕΜΗ' });

export async function POST(request: Request) {
  await requirePermission('companies.read');
  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  try {
    let arGemi: string | undefined;
    if (parsed.data.arGemi !== undefined) {
      arGemi = parsed.data.arGemi;
    } else {
      const search = await searchCompanies({ afm: parsed.data.afm, resultsSize: 5 });
      const first = search.results?.[0];
      if (!first) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      arGemi = String(first.arGemi);
    }

    const [company, docs] = await Promise.all([
      getCompany(arGemi),
      getCompanyDocuments(arGemi).catch(() => ({ decision: [], publication: [] })),
    ]);

    const decisionCount = docs.decision?.length ?? 0;
    const publicationCount = docs.publication?.length ?? 0;

    return NextResponse.json({
      mapped: mapGemiCompany(company),
      raw: company,
      documentCounts: { decision: decisionCount, publication: publicationCount, total: decisionCount + publicationCount },
    });
  } catch (e) {
    if (e instanceof GemiError) {
      if (e.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      return NextResponse.json({ error: 'gemi_error', status: e.status, message: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: 'unexpected', message: (e as Error).message }, { status: 500 });
  }
}
