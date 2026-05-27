'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiRefreshCw, FiCloudLightning } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Stat = { key: string; label: string; count: number; lastUpdated: string | null; source: string };

export function ReferenceDataClient({ stats, canManage }: { stats: Stat[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const refresh = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/metadata/refresh-gemi', { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      const total = Object.values(d.summary as Record<string, number>).reduce((a, b) => a + b, 0);
      toast.success(`Ανανεώθηκαν ${total} εγγραφές μητρώων`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'gemi_error' ? `Σφάλμα ΓΕΜΗ: ${e.message ?? e.status}` : 'Αποτυχία ανανέωσης');
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-muted/30 px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-foreground">Ανανέωση από ΓΕΜΗ Open Data</p>
            <p className="text-[11px] text-muted-foreground">Κατεβάζει όλα τα μητρώα (νομικές μορφές, νομούς, δήμους, υπηρεσίες) και κάνει upsert.</p>
          </div>
          <Button onClick={refresh} disabled={busy}>
            <FiCloudLightning className="mr-1.5" /> {busy ? 'Ανανέωση…' : 'Ανανέωση τώρα'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.key} className="rounded-md border border-border p-3 bg-background">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{s.label}</span>
              <Badge variant="outline" className="text-[9px]">{s.source}</Badge>
            </div>
            <div className="text-[20px] font-semibold text-foreground tabular-nums">{s.count.toLocaleString('el-GR')}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {s.lastUpdated ? `Last update: ${new Date(s.lastUpdated).toLocaleDateString('el-GR')}` : 'No timestamp'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
