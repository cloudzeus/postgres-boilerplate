import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyUploadPrivate } from '@/lib/bunny';
import { extractProgram } from '@/lib/programs/extract';
import { asDate, asNum, asStr, normalizeKad } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — program PDFs can be large

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
]);

function ymPath() {
  const d = new Date();
  return `programs/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sanitize(name: string) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase() || 'program';
}

export async function GET() {
  await requirePermission('programs.read');
  const programs = await prisma.program.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, title: true, summary: true, sourceFileName: true,
      publicationDate: true, submissionStart: true, submissionEnd: true,
      totalBudget: true, fundingRate: true, durationMonths: true,
      status: true, extractStatus: true, errorMessage: true,
      createdAt: true,
      _count: { select: { kads: true, expenseCats: true, regions: true, criteria: true, deadlines: true } },
    },
  });
  return NextResponse.json({ data: programs });
}

export async function POST(req: Request) {
  const user = await requirePermission('programs.create');

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required (multipart/form-data)' }, { status: 400 });
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safe = sanitize(file.name || 'program.pdf');
  const ext = safe.includes('.') ? safe.slice(safe.lastIndexOf('.')) : '';
  const stem = safe.replace(ext, '').slice(0, 60) || 'program';
  const storageKey = `${ymPath()}/${slug()}-${stem}${ext}`;

  await bunnyUploadPrivate({ key: storageKey, body: buffer, contentType: file.type });

  const program = await prisma.program.create({
    data: {
      title: file.name,            // placeholder; replaced after extraction
      sourceFileName: file.name,
      storageKey,
      publicUrl: `bunny:${storageKey}`,
      mimeType: file.type,
      size: file.size,
      extractStatus: 'PROCESSING',
      createdById: user.id,
    },
  });

  try {
    const result = await extractProgram({ buffer, mimeType: file.type });
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

    // Bulk-friendly data prep.
    const kadData = kads.filter((k) => asStr(k.code)).map((k) => {
      const n = normalizeKad(String(k.code));
      return { programId: program.id, code: n.code, codeWithoutDots: n.codeWithoutDots, description: asStr(k.description), excluded: !!k.excluded };
    });
    const expenseData = expenseCats.filter((c) => asStr(c.name)).map((c, i) => ({
      programId: program.id, name: asStr(c.name)!,
      minAmount: asNum(c.minAmount), minPercentage: asNum(c.minPercentage),
      maxAmount: asNum(c.maxAmount), maxPercentage: asNum(c.maxPercentage),
      mandatory: !!c.mandatory, order: i,
    }));
    const bonusData = bonuses.filter((b) => asStr(b.name) || asStr(b.condition)).map((b, i) => ({
      programId: program.id,
      kind: ((VALID_BONUS_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'OTHER') as any,
      name: asStr(b.name) ?? `Bonus ${i + 1}`,
      condition: asStr(b.condition) ?? '',
      bonusRate: asNum(b.bonusRate), bonusAmount: asNum(b.bonusAmount),
      order: i,
    }));
    const legalFormData = Array.from(new Set(legalForms)).map((name) => ({ programId: program.id, name }));
    const regionData = regions.filter((r) => asStr(r.name)).map((r) => ({
      programId: program.id, name: asStr(r.name)!, fundingRate: asNum(r.fundingRate),
    }));
    const criteriaData = criteria.filter((c) => asStr(c)).map((text, i) => ({
      programId: program.id, text: asStr(text)!, order: i,
    }));
    const deadlineData = deadlines.filter((d) => asDate(d.deadline)).map((d, i) => ({
      programId: program.id, deadline: asDate(d.deadline)!, description: asStr(d.description), order: i,
    }));

    // Step 1: scalar update + ProgramFile row (fast, in a small transaction).
    await prisma.$transaction([
      prisma.program.update({
        where: { id: program.id },
        data: {
          title: asStr(data.title) ?? file.name,
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
        },
      }),
      prisma.programFile.create({
        data: {
          programId: program.id,
          fileName: file.name,
          storageKey,
          publicUrl: `bunny:${storageKey}`,
          mimeType: file.type,
          size: file.size,
          kind: 'MAIN',
          uploadedById: user.id,
        },
      }),
    ], { timeout: 30_000, maxWait: 5_000 });

    // Step 2: bulk-insert children. Each table independently — if ONE fails we
    // still keep the others (and surface the failures in the log).
    const seedResults: Record<string, { tried: number; ok: number; err?: string }> = {};
    async function seedTable(table: string, data: any[], fn: () => Promise<any>) {
      seedResults[table] = { tried: data.length, ok: 0 };
      if (data.length === 0) return;
      try {
        const r = await fn();
        seedResults[table].ok = r?.count ?? data.length;
      } catch (e: any) {
        seedResults[table].err = String(e?.message ?? e).slice(0, 300);
        console.error(`[program upload] ${table} createMany failed:`, e?.message);
        console.error(`[program upload] ${table} sample row:`, JSON.stringify(data[0], null, 2));
      }
    }
    await seedTable('programKad', kadData, () => prisma.programKad.createMany({ data: kadData, skipDuplicates: true }));
    await seedTable('programExpenseCategory', expenseData, () => prisma.programExpenseCategory.createMany({ data: expenseData }));
    await seedTable('programBonus', bonusData, () => prisma.programBonus.createMany({ data: bonusData }));
    await seedTable('programEligibleLegalForm', legalFormData, () => prisma.programEligibleLegalForm.createMany({ data: legalFormData, skipDuplicates: true }));
    await seedTable('programRegion', regionData, () => prisma.programRegion.createMany({ data: regionData }));
    await seedTable('programCriterion', criteriaData, () => prisma.programCriterion.createMany({ data: criteriaData }));
    await seedTable('programDeadline', deadlineData, () => prisma.programDeadline.createMany({ data: deadlineData }));

    console.log('[program upload] seed results:', seedResults);

    // Best-effort: auto-generate the self-assessment questionnaire if the program needs one.
    if (data?.selfAssessment?.required === true) {
      try {
        const { generateQuestionnaire, persistQuestionnaire } = await import('@/lib/programs/questionnaire');
        const gen = await generateQuestionnaire(program.id);
        await persistQuestionnaire(program.id, gen.draft, gen.model);
      } catch (err) {
        console.error('[questionnaire auto-gen] failed (non-fatal):', err);
      }
    }

    return NextResponse.json({ id: program.id, durationMs: result.durationMs });
  } catch (err: any) {
    await prisma.program.update({
      where: { id: program.id },
      data: { extractStatus: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 2000) },
    });
    return NextResponse.json({ id: program.id, error: String(err?.message ?? err) }, { status: 422 });
  }
}
