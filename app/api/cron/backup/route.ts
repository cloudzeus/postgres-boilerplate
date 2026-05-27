import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';
import { runBackup } from '@/lib/backup';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const enabled = (await getSetting<boolean>('backups.enabled')) ?? true;
  if (!enabled) return NextResponse.json({ ok: false, skipped: 'disabled' });

  const expected = (await getSetting<string>('backups.cronSecret')) || process.env.CRON_SECRET || '';
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const rec = await runBackup({ trigger: 'cron' });
    await logAudit({ action: 'backup.cron', resource: 'backup', resourceId: rec.id });
    return NextResponse.json({ ok: true, id: rec.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
