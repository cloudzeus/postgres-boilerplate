import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDownload } from '@/lib/bunny';
import { extractProgram } from '@/lib/programs/extract';
import { asDate, asNum, asStr, normalizeKad } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-run extraction on an existing Program using the strongest available model.
 * Overwrites all extracted fields + child rows. Keeps manual edits to status/notes.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.create');
  const { id } = await params;

  const program = await prisma.program.findUnique({ where: { id } });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!program.storageKey) return NextResponse.json({ error: 'no source PDF on file' }, { status: 422 });

  await prisma.program.update({
    where: { id },
    data: { extractStatus: 'PROCESSING', errorMessage: null },
  });

  try {
    // Read EVERY file attached to the program (MAIN + ANNEX + CLARIFICATION + …)
    // so the LLM sees the full picture.
    const files = await prisma.programFile.findMany({
      where: { programId: id },
      orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }],
    });
    // If no ProgramFile rows yet (legacy programs), fall back to the storageKey on Program.
    const fileInputs = files.length > 0
      ? await Promise.all(files.map(async (f) => ({
          buffer: await bunnyDownload(f.storageKey),
          mimeType: f.mimeType,
          fileName: f.fileName,
          kind: f.kind,
        })))
      : [{
          buffer: await bunnyDownload(program.storageKey),
          mimeType: program.mimeType ?? 'application/pdf',
          fileName: program.sourceFileName ?? 'main.pdf',
          kind: 'MAIN',
        }];

    const result = await extractProgram({ files: fileInputs });
    const data = result.data ?? {};

    const kads: Array<{ code: string; description?: string; excluded?: boolean }> = [
      ...(Array.isArray(data.potentialKads) ? data.potentialKads.map((k: any) => ({ ...k, excluded: false })) : []),
      ...(Array.isArray(data.excludedKads)  ? data.excludedKads.map((k: any) => ({ ...k, excluded: true }))  : []),
    ];
    const expenseCats: Array<{ name: string; minAmount?: any; minPercentage?: any; maxAmount?: any; maxPercentage?: any; mandatory?: boolean }> = Array.isArray(data.expenseCategories) ? data.expenseCategories : [];
    const regions: Array<{ name: string; fundingRate?: any }> = Array.isArray(data.regions) ? data.regions : [];
    const criteria: string[] = Array.isArray(data.criteria) ? data.criteria : [];
    const deadlines: Array<{ deadline: string; description?: string }> = Array.isArray(data.deadlines) ? data.deadlines : [];
    const legalForms: string[] = Array.isArray(data.eligibleLegalForms) ? data.eligibleLegalForms.filter((x: any) => typeof x === 'string' && x.trim()) : [];
    const VALID_BONUS_KINDS = ['TIME_BASED', 'EMPLOYMENT', 'SUSTAINABILITY', 'WOMEN_LED', 'YOUTH', 'R_AND_D', 'OTHER'] as const;
    const bonuses: Array<{ kind: string; name: string; condition: string; bonusRate?: any; bonusAmount?: any }> = Array.isArray(data.bonuses) ? data.bonuses : [];

    // Pre-build data arrays (validated + coerced) for bulk inserts.
    const kadData = kads.filter((k) => asStr(k.code)).map((k) => {
      const n = normalizeKad(String(k.code));
      return { programId: id, code: n.code, codeWithoutDots: n.codeWithoutDots, description: asStr(k.description), excluded: !!k.excluded };
    });
    const expenseData = expenseCats.filter((c) => asStr(c.name)).map((c, i) => ({
      programId: id, name: asStr(c.name)!,
      minAmount: asNum(c.minAmount), minPercentage: asNum(c.minPercentage),
      maxAmount: asNum(c.maxAmount), maxPercentage: asNum(c.maxPercentage),
      mandatory: !!c.mandatory, order: i,
    }));
    const bonusData = bonuses.filter((b) => asStr(b.name) || asStr(b.condition)).map((b, i) => ({
      programId: id,
      kind: ((VALID_BONUS_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'OTHER') as any,
      name: asStr(b.name) ?? `Bonus ${i + 1}`,
      condition: asStr(b.condition) ?? '',
      bonusRate: asNum(b.bonusRate), bonusAmount: asNum(b.bonusAmount),
      order: i,
    }));
    const legalFormData = Array.from(new Set(legalForms)).map((name) => ({ programId: id, name }));
    const regionData = regions.filter((r) => asStr(r.name)).map((r) => ({
      programId: id, name: asStr(r.name)!, fundingRate: asNum(r.fundingRate),
    }));
    const criteriaData = criteria.filter((c) => asStr(c)).map((text, i) => ({
      programId: id, text: asStr(text)!, order: i,
    }));
    const deadlineData = deadlines.filter((d) => asDate(d.deadline)).map((d, i) => ({
      programId: id, deadline: asDate(d.deadline)!, description: asStr(d.description), order: i,
    }));

    // Step 1: scalar update + wipe children (small, fast — keep in a transaction).
    await prisma.$transaction([
      prisma.programKad.deleteMany({ where: { programId: id } }),
      prisma.programExpenseCategory.deleteMany({ where: { programId: id } }),
      prisma.programRegion.deleteMany({ where: { programId: id } }),
      prisma.programCriterion.deleteMany({ where: { programId: id } }),
      prisma.programDeadline.deleteMany({ where: { programId: id } }),
      prisma.programEligibleLegalForm.deleteMany({ where: { programId: id } }),
      prisma.programBonus.deleteMany({ where: { programId: id } }),
      prisma.program.update({
        where: { id },
        data: {
          title: asStr(data.title) ?? program.title,
          summary: asStr(data.summary),
          publicationDate: asDate(data.publicationDate),
          submissionStart: asDate(data.submissionStart),
          submissionEnd:   asDate(data.submissionEnd),
          totalBudget:     asNum(data.totalBudget),
          fundingRate:     asNum(data.fundingRate),
          durationMonths:  data.durationMonths != null ? Math.round(Number(data.durationMonths)) : null,
          referenceCode:   asStr(data.referenceCode),
          kadRule: (() => {
            const v = asStr(data.kadRule);
            return v && ['ALL_EXCEPT_LISTED', 'ONLY_LISTED', 'MIXED', 'UNSPECIFIED'].includes(v) ? v as any : 'UNSPECIFIED';
          })(),
          kadRuleNote: asStr(data.kadRuleNote),
          minEmployeesFte:     asNum(data.minEmployeesFte),
          minOperationalYears: asNum(data.minOperationalYears),
          eligibilityNote:     asStr(data.eligibilityNote),
          extractStatus: 'COMPLETED',
          extractedData: data,
          model: result.model,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
          errorMessage: null,
        },
      }),
    ], { timeout: 30_000, maxWait: 5_000 });

    // Step 2: bulk seed children independently — log each table's outcome.
    const seedResults: Record<string, { tried: number; ok: number; err?: string }> = {};
    async function seedTable(table: string, data: any[], fn: () => Promise<any>) {
      seedResults[table] = { tried: data.length, ok: 0 };
      if (data.length === 0) return;
      try {
        const r = await fn();
        seedResults[table].ok = r?.count ?? data.length;
      } catch (e: any) {
        seedResults[table].err = String(e?.message ?? e).slice(0, 300);
        console.error(`[reextract] ${table} createMany failed:`, e?.message);
        console.error(`[reextract] ${table} sample row:`, JSON.stringify(data[0], null, 2));
      }
    }
    await seedTable('programKad', kadData, () => prisma.programKad.createMany({ data: kadData, skipDuplicates: true }));
    await seedTable('programExpenseCategory', expenseData, () => prisma.programExpenseCategory.createMany({ data: expenseData }));
    await seedTable('programBonus', bonusData, () => prisma.programBonus.createMany({ data: bonusData }));
    await seedTable('programEligibleLegalForm', legalFormData, () => prisma.programEligibleLegalForm.createMany({ data: legalFormData, skipDuplicates: true }));
    await seedTable('programRegion', regionData, () => prisma.programRegion.createMany({ data: regionData }));
    await seedTable('programCriterion', criteriaData, () => prisma.programCriterion.createMany({ data: criteriaData }));
    await seedTable('programDeadline', deadlineData, () => prisma.programDeadline.createMany({ data: deadlineData }));

    console.log('[reextract] seed results:', seedResults);

    return NextResponse.json({ ok: true, model: result.model });
  } catch (err: any) {
    await prisma.program.update({
      where: { id },
      data: { extractStatus: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 422 });
  }
}
