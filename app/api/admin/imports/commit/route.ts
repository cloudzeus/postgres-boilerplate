import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { getEntity, coerce } from '@/lib/import-registry';
import { prisma } from '@/lib/db';

const Schema = z.object({
  entityKey: z.string(),
  mode: z.enum(['insert', 'upsert']),
  /** mapped rows where keys are ImportField.key and values are raw cell values from the sheet */
  rows: z.array(z.record(z.string(), z.any())).max(10_000),
  meta: z.record(z.string(), z.any()).optional(),
  fileName: z.string().optional(),
});

export async function POST(request: Request) {
  await requirePermission('imports.create');
  const user = await (await import('@/lib/session')).getCurrentUser();

  const body = await request.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  const entity = getEntity(parsed.data.entityKey);
  if (!entity) return NextResponse.json({ error: 'unknown_entity' }, { status: 404 });

  // Caller must hold the entity-specific permission, not just imports.create.
  await requirePermission(entity.permission);

  // Coerce all values according to declared field types
  const coercedRows = parsed.data.rows.map((raw) => {
    const out: Record<string, any> = {};
    for (const f of entity.fields) {
      if (raw[f.key] === undefined) continue;
      out[f.key] = coerce(raw[f.key], f.type);
    }
    return out;
  });

  const result = await entity.commit({
    rows: coercedRows,
    mode: parsed.data.mode,
    meta: parsed.data.meta,
  });

  // Log the import
  try {
    if (user) {
      await prisma.excelImport.create({
        data: {
          userId: user.id,
          fileName: parsed.data.fileName ?? 'import.xlsx',
          status: result.failed.length === 0 ? 'COMPLETED' : 'PARTIAL',
          mappedFields: {
            entityKey: entity.key,
            mode: parsed.data.mode,
            total: result.total,
            inserted: result.inserted,
            updated: result.updated,
            failedCount: result.failed.length,
          } as any,
        },
      });
    }
  } catch (e) {
    console.error('[imports/commit] failed to log ExcelImport', e);
  }

  return NextResponse.json({ ok: true, ...result });
}
