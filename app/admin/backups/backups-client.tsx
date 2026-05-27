'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';

interface Backup {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  trigger: string;
  errorMessage: string | null;
  createdAt: string;
}

export function BackupsClient({ backups, retention }: { backups: Backup[]; retention: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function runBackup() {
    setMsg(null);
    setBusyId('__new__');
    try {
      const res = await fetch('/api/admin/backups', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backup failed');
      setMsg('Το backup δημιουργήθηκε.');
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`Σφάλμα: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function restore(id: string, filename: string) {
    if (!confirm(`Είσαι σίγουρος; Θα επαναφερθεί η βάση από το ${filename}.\n\nΌλα τα τρέχοντα δεδομένα θα αντικατασταθούν.`)) return;
    setMsg(null); setBusyId(id);
    try {
      const res = await fetch(`/api/admin/backups/${id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setMsg('Η βάση επαναφέρθηκε επιτυχώς.');
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`Σφάλμα restore: ${(e as Error).message}`);
    } finally { setBusyId(null); }
  }

  async function remove(id: string, filename: string) {
    if (!confirm(`Διαγραφή backup ${filename};`)) return;
    setBusyId(id);
    try {
      await fetch(`/api/admin/backups/${id}`, { method: 'DELETE' });
      startTransition(() => router.refresh());
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={runBackup} disabled={busyId !== null || pending}>
          {busyId === '__new__' ? 'Δημιουργία…' : 'Δημιουργία backup τώρα'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {backups.length} / {retention} αρχεία
        </span>
      </div>

      {msg && <div className="rounded-md border bg-muted p-3 text-sm">{msg}</div>}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Ημερομηνία</th>
              <th className="px-3 py-2">Αρχείο</th>
              <th className="px-3 py-2">Μέγεθος</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Ενέργειες</th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Δεν υπάρχουν backups.</td></tr>
            )}
            {backups.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(b.createdAt).toLocaleString('el-GR')}</td>
                <td className="px-3 py-2 font-mono text-xs">{b.filename}</td>
                <td className="px-3 py-2">{b.sizeBytes > 0 ? formatBytes(b.sizeBytes) : '—'}</td>
                <td className="px-3 py-2">{b.trigger}</td>
                <td className="px-3 py-2">
                  <span className={
                    b.status === 'READY' ? 'text-green-600' :
                    b.status === 'FAILED' ? 'text-red-600' :
                    'text-amber-600'
                  }>{b.status}</span>
                  {b.errorMessage && <div className="text-xs text-red-600">{b.errorMessage}</div>}
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={b.status !== 'READY' || busyId !== null}
                    onClick={() => restore(b.id, b.filename)}
                  >
                    {busyId === b.id ? 'Restore…' : 'Restore'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId !== null}
                    onClick={() => remove(b.id, b.filename)}
                  >
                    Διαγραφή
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Cron: POST <code>/api/cron/backup</code> με <code>Authorization: Bearer &lt;cronSecret&gt;</code>. Παράδειγμα crontab:
        <code className="ml-1">0 3 * * * curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/backup</code>
      </p>
    </div>
  );
}
