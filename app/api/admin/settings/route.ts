import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { SETTING_CATALOG, maskSecret, setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';

export async function GET() {
  const u = await requirePermission('system.settings');
  const rows = await prisma.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const settings = SETTING_CATALOG.map((def) => {
    const raw = map.get(def.key) ?? def.defaultValue ?? null;
    return {
      key: def.key,
      category: def.category,
      label: def.label,
      type: def.type,
      isSecret: !!def.isSecret,
      value: def.isSecret && typeof raw === 'string' ? maskSecret(raw) : raw,
      hasValue: map.has(def.key),
    };
  });
  return NextResponse.json({ settings, _meta: { actor: u.email } });
}

const PutSchema = z.object({
  updates: z.array(z.object({ key: z.string(), value: z.any() })).min(1),
});

export async function PUT(req: Request) {
  const u = await requirePermission('system.settings');
  const body = await req.json();
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  const knownKeys = new Set(SETTING_CATALOG.map((s) => s.key));
  const filtered = parsed.data.updates.filter((u) => knownKeys.has(u.key));

  for (const upd of filtered) {
    // Skip empty masked secrets ("••••…") — means user didn't change them
    if (typeof upd.value === 'string' && upd.value.startsWith('••••')) continue;
    await setSetting(upd.key, upd.value, u.id);
  }

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'settings.update', resource: 'setting',
    metadata: { keys: filtered.map((f) => f.key) },
  });

  return NextResponse.json({ ok: true, updated: filtered.length });
}
