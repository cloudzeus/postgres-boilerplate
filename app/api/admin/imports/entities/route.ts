import { NextResponse } from 'next/server';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { listEntities } from '@/lib/import-registry';

export async function GET() {
  await requirePermission('imports.read');
  const entities = listEntities();
  // Annotate each entity with `canCommit` so the UI can grey out ones the user can't import to.
  const annotated = await Promise.all(entities.map(async (e) => ({
    ...e,
    canCommit: await hasPermission(e.permission),
  })));
  return NextResponse.json({ entities: annotated });
}
