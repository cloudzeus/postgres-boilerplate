import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { invoiceKeyInfo } from '@/lib/templates/schema';
import { MappingsBody } from '@/lib/templates/validate';
import { TEMPLATE_INCLUDE, toTemplateDto } from '@/lib/templates/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT { mappings } — αντικαθιστά όλα τα mappings. Ακριβώς ένα isDefault=true (το πρώτο αν κανένα).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission('ocr.categorize');
  const { id } = await params;
  const parsed = MappingsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const t = await prisma.extractionTemplate.findUnique({ where: { id }, include: { fields: { select: { key: true, kind: true, columns: true } } } });
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Every row must reference an existing field key (or `<tableKey>.<columnKey>` for TABLE fields).
  const valid = new Set<string>();
  for (const f of t.fields) {
    valid.add(f.key);
    for (const c of (Array.isArray(f.columns) ? (f.columns as { key: string }[]) : [])) valid.add(`${f.key}.${c.key}`);
  }
  const bad = parsed.data.mappings.flatMap((m) => m.rows.map((r) => r.fieldKey)).filter((k) => !valid.has(k));
  if (bad.length) return NextResponse.json({ error: 'unknown_field', message: `Άγνωστα πεδία: ${bad.join(', ')}` }, { status: 422 });

  // A source key produces line data when it is a whole TABLE field or one of its
  // columns; a SINGLE field produces a header value. The invoice side is split the
  // same way by invoiceKeyInfo().isLine (`items.*` vs everything else), and the two
  // halves have to agree — projectToInvoice cannot fold a table into one header
  // cell, nor fan a single value across the line array.
  const tableKeys = new Set(t.fields.filter((f) => f.kind === 'TABLE').map((f) => f.key));
  const isLineSource = (fieldKey: string) => tableKeys.has(fieldKey) || tableKeys.has(fieldKey.split('.')[0]);
  for (const m of parsed.data.mappings) {
    if (m.target !== 'INVOICE') continue;
    for (const r of m.rows) {
      const target = invoiceKeyInfo(r.invoiceKey);
      if (!target) continue; // already rejected by MappingsBody
      if (isLineSource(r.fieldKey) && !target.isLine) {
        return NextResponse.json({ error: 'table_to_header', message: `Το «${r.fieldKey}» είναι πεδίο πίνακα και δεν μπορεί να χαρτογραφηθεί στην κεφαλίδα «${target.label}». Επίλεξε πεδίο γραμμής (items.*).` }, { status: 422 });
      }
      if (!isLineSource(r.fieldKey) && target.isLine) {
        return NextResponse.json({ error: 'single_to_line', message: `Το «${r.fieldKey}» είναι απλό πεδίο και δεν μπορεί να χαρτογραφηθεί στη γραμμή «${target.label}». Επίλεξε στήλη πίνακα.` }, { status: 422 });
      }
    }
  }
  // projectToInvoice rebuilds items[] from ONE table: reject INVOICE mappings whose line rows span two tables.
  for (const m of parsed.data.mappings) {
    if (m.target !== 'INVOICE') continue;
    const tables = new Set(m.rows.filter((r) => r.invoiceKey.startsWith('items.')).map((r) => r.fieldKey.split('.')[0]));
    if (tables.size > 1) return NextResponse.json({ error: 'multiple_tables', message: `Το mapping «${m.name}» χαρτογραφεί γραμμές από δύο πίνακες (${[...tables].join(', ')}). Επίλεξε έναν.` }, { status: 422 });
  }

  // Exactly one default: the first flagged one, else the first mapping.
  const firstDefault = parsed.data.mappings.findIndex((m) => m.isDefault);
  const defaultIdx = firstDefault >= 0 ? firstDefault : 0;
  const mappings = parsed.data.mappings.map((m, i) => ({ ...m, isDefault: i === defaultIdx }));

  await prisma.$transaction(async (tx) => {
    await tx.templateMapping.deleteMany({ where: { templateId: id } });
    for (const m of mappings) await tx.templateMapping.create({ data: { templateId: id, name: m.name, target: m.target, isDefault: m.isDefault, rows: m.rows as unknown as Prisma.InputJsonValue } });
    await tx.extractionTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
  });
  const full = await prisma.extractionTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
  await logAudit({ userId: u.id, userEmail: u.email, action: 'template.mappings.update', resource: 'extractionTemplate', resourceId: id, metadata: { mappings: mappings.length } });
  return NextResponse.json(toTemplateDto(full));
}
