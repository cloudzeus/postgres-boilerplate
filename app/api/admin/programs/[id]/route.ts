import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { bunnyDelete } from '@/lib/bunny';
import { asDate, asNum, asStr, normalizeKad } from '@/lib/programs/coerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.read');
  const { id } = await params;
  const program = await prisma.program.findUnique({
    where: { id },
    include: {
      kads:        { orderBy: { code: 'asc' } },
      expenseCats: { orderBy: { order: 'asc' } },
      regions:     { orderBy: { name: 'asc' } },
      criteria:    { orderBy: { order: 'asc' } },
      deadlines:   { orderBy: { order: 'asc' } },
      legalForms:  { orderBy: { name: 'asc' } },
      bonuses:     { orderBy: { order: 'asc' } },
      files:       { orderBy: [{ kind: 'asc' }, { uploadedAt: 'asc' }] },
      questionnaire: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
    },
  });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(program);
}

const PatchSchema = z.object({
  title:          z.string().min(1).optional(),
  summary:        z.string().nullable().optional(),
  publicationDate: z.string().nullable().optional(),
  submissionStart: z.string().nullable().optional(),
  submissionEnd:   z.string().nullable().optional(),
  totalBudget:    z.union([z.number(), z.string(), z.null()]).optional(),
  fundingRate:    z.union([z.number(), z.string(), z.null()]).optional(),
  durationMonths: z.union([z.number(), z.string(), z.null()]).optional(),
  referenceCode:  z.string().nullable().optional(),
  status:         z.enum(['DRAFT', 'REVIEWING', 'PUBLISHED', 'ARCHIVED']).optional(),
  kadRule:        z.enum(['ALL_EXCEPT_LISTED', 'ONLY_LISTED', 'MIXED', 'UNSPECIFIED']).optional(),
  kadRuleNote:    z.string().nullable().optional(),
  minEmployeesFte:     z.union([z.number(), z.string(), z.null()]).optional(),
  minOperationalYears: z.union([z.number(), z.string(), z.null()]).optional(),
  eligibilityNote:     z.string().nullable().optional(),
  notes:          z.string().nullable().optional(),
  kads:        z.array(z.object({ id: z.string().optional(), code: z.string().min(1), description: z.string().nullable().optional(), excluded: z.boolean().optional() })).optional(),
  expenseCats: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    minAmount:     z.union([z.number(), z.string(), z.null()]).optional(),
    minPercentage: z.union([z.number(), z.string(), z.null()]).optional(),
    maxAmount:     z.union([z.number(), z.string(), z.null()]).optional(),
    maxPercentage: z.union([z.number(), z.string(), z.null()]).optional(),
    mandatory:     z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })).optional(),
  legalForms: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), notes: z.string().nullable().optional() })).optional(),
  bonuses: z.array(z.object({
    id: z.string().optional(),
    kind: z.enum(['TIME_BASED', 'EMPLOYMENT', 'SUSTAINABILITY', 'WOMEN_LED', 'YOUTH', 'R_AND_D', 'OTHER']).optional(),
    name: z.string().min(1),
    condition: z.string().min(1),
    bonusRate:   z.union([z.number(), z.string(), z.null()]).optional(),
    bonusAmount: z.union([z.number(), z.string(), z.null()]).optional(),
  })).optional(),
  regions:     z.array(z.object({ id: z.string().optional(), name: z.string().min(1), fundingRate: z.union([z.number(), z.string(), z.null()]).optional(), notes: z.string().nullable().optional() })).optional(),
  criteria:    z.array(z.object({ id: z.string().optional(), text: z.string().min(1) })).optional(),
  deadlines:   z.array(z.object({ id: z.string().optional(), deadline: z.string().min(1), description: z.string().nullable().optional() })).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.update');
  const { id } = await params;
  const body = PatchSchema.parse(await req.json());

  const exists = await prisma.program.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const scalarUpdate: any = {};
  if (body.title !== undefined)           scalarUpdate.title = body.title;
  if (body.summary !== undefined)         scalarUpdate.summary = asStr(body.summary);
  if (body.publicationDate !== undefined) scalarUpdate.publicationDate = asDate(body.publicationDate);
  if (body.submissionStart !== undefined) scalarUpdate.submissionStart = asDate(body.submissionStart);
  if (body.submissionEnd !== undefined)   scalarUpdate.submissionEnd = asDate(body.submissionEnd);
  if (body.totalBudget !== undefined)     scalarUpdate.totalBudget = asNum(body.totalBudget);
  if (body.fundingRate !== undefined)     scalarUpdate.fundingRate = asNum(body.fundingRate);
  if (body.durationMonths !== undefined)  scalarUpdate.durationMonths = body.durationMonths == null ? null : Math.round(Number(body.durationMonths));
  if (body.referenceCode !== undefined)   scalarUpdate.referenceCode = asStr(body.referenceCode);
  if (body.status !== undefined)          scalarUpdate.status = body.status;
  if (body.kadRule !== undefined)         scalarUpdate.kadRule = body.kadRule;
  if (body.kadRuleNote !== undefined)     scalarUpdate.kadRuleNote = asStr(body.kadRuleNote);
  if (body.minEmployeesFte !== undefined)     scalarUpdate.minEmployeesFte = asNum(body.minEmployeesFte);
  if (body.minOperationalYears !== undefined) scalarUpdate.minOperationalYears = asNum(body.minOperationalYears);
  if (body.eligibilityNote !== undefined)     scalarUpdate.eligibilityNote = asStr(body.eligibilityNote);
  if (body.notes !== undefined)           scalarUpdate.notes = asStr(body.notes);

  await prisma.$transaction(async (tx) => {
    if (Object.keys(scalarUpdate).length) {
      await tx.program.update({ where: { id }, data: scalarUpdate });
    }
    // Full-replace strategy for nested arrays. Bulk createMany (one round-trip per table)
    // instead of per-row create — a program can carry hundreds of ΚΑΔ and the per-row
    // loop blew past the transaction timeout.
    if (body.kads) {
      await tx.programKad.deleteMany({ where: { programId: id } });
      // Dedupe by canonical code (unique [programId, code]); keep last occurrence.
      const byCode = new Map<string, { programId: string; code: string; codeWithoutDots: string | null; description: string | null; excluded: boolean }>();
      for (const k of body.kads) {
        const n = normalizeKad(k.code);
        byCode.set(n.code, { programId: id, code: n.code, codeWithoutDots: n.codeWithoutDots, description: asStr(k.description), excluded: !!k.excluded });
      }
      if (byCode.size) await tx.programKad.createMany({ data: Array.from(byCode.values()) });
    }
    if (body.expenseCats) {
      await tx.programExpenseCategory.deleteMany({ where: { programId: id } });
      if (body.expenseCats.length) await tx.programExpenseCategory.createMany({
        data: body.expenseCats.map((c, i) => ({
          programId: id, name: c.name,
          minAmount: asNum(c.minAmount), minPercentage: asNum(c.minPercentage),
          maxAmount: asNum(c.maxAmount), maxPercentage: asNum(c.maxPercentage),
          mandatory: !!c.mandatory, notes: asStr(c.notes), order: i,
        })),
      });
    }
    if (body.bonuses) {
      await tx.programBonus.deleteMany({ where: { programId: id } });
      if (body.bonuses.length) await tx.programBonus.createMany({
        data: body.bonuses.map((b, i) => ({
          programId: id, kind: (b.kind ?? 'OTHER') as any,
          name: b.name, condition: b.condition,
          bonusRate: asNum(b.bonusRate), bonusAmount: asNum(b.bonusAmount), order: i,
        })),
      });
    }
    if (body.legalForms) {
      await tx.programEligibleLegalForm.deleteMany({ where: { programId: id } });
      // Dedupe by name (unique [programId, name]); keep last notes.
      const byName = new Map<string, { programId: string; name: string; notes: string | null }>();
      for (const lf of body.legalForms) byName.set(lf.name, { programId: id, name: lf.name, notes: asStr(lf.notes) });
      if (byName.size) await tx.programEligibleLegalForm.createMany({ data: Array.from(byName.values()) });
    }
    if (body.regions) {
      await tx.programRegion.deleteMany({ where: { programId: id } });
      if (body.regions.length) await tx.programRegion.createMany({
        data: body.regions.map((r) => ({ programId: id, name: r.name, fundingRate: asNum(r.fundingRate), notes: asStr(r.notes) })),
      });
    }
    if (body.criteria) {
      await tx.programCriterion.deleteMany({ where: { programId: id } });
      if (body.criteria.length) await tx.programCriterion.createMany({
        data: body.criteria.map((c, i) => ({ programId: id, text: c.text, order: i })),
      });
    }
    if (body.deadlines) {
      await tx.programDeadline.deleteMany({ where: { programId: id } });
      const rows = body.deadlines
        .map((d, i) => ({ d, date: asDate(d.deadline), i }))
        .filter((x) => x.date)
        .map((x) => ({ programId: id, deadline: x.date as Date, description: asStr(x.d.description), order: x.i }));
      if (rows.length) await tx.programDeadline.createMany({ data: rows });
    }
  }, { timeout: 120_000, maxWait: 10_000 });

  const fresh = await prisma.program.findUnique({
    where: { id },
    include: { kads: true, expenseCats: true, regions: true, criteria: true, deadlines: true, legalForms: true, bonuses: true, files: true },
  });
  return NextResponse.json(fresh);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission('programs.delete');
  const { id } = await params;
  const program = await prisma.program.findUnique({ where: { id } });
  if (!program) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (program.storageKey) { try { await bunnyDelete([program.storageKey]); } catch { /* best effort */ } }
  await prisma.program.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
