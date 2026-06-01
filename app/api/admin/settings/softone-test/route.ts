import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { softoneTestConnection } from '@/lib/softone';
import { logAudit } from '@/lib/audit';

// Runs the SoftOne login → authenticate flow with the saved credentials and
// returns the resulting clientID (token) so the admin can verify connectivity.
export async function POST() {
  const u = await requirePermission('system.settings');

  const result = await softoneTestConnection();

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'settings.softone.test', resource: 'setting',
    metadata: { ok: result.ok, stage: result.stage, authenticated: result.authenticated },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
