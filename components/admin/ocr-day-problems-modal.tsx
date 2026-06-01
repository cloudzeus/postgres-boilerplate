'use client';

import * as React from 'react';
import { FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { reconMeta, type ReconInput, type ReconStatus } from '@/lib/ocr/recon-status';

/** Minimal row shape the modal needs (a superset of ReconInput + display fields). */
export interface DayProblemRow extends ReconInput {
  id: string;
  fileName: string;
}

export function OcrDayProblemsModal({
  open, onOpenChange, dayLabel, rows,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dayLabel: string;
  rows: DayProblemRow[];
}) {
  // Group the day's pending documents by their derived status.
  const groups = React.useMemo(() => {
    const map = new Map<ReconStatus, { meta: ReturnType<typeof reconMeta>; rows: DayProblemRow[] }>();
    for (const r of rows) {
      const meta = reconMeta(r);
      if (!meta.pending) continue;
      const g = map.get(meta.status);
      if (g) g.rows.push(r); else map.set(meta.status, { meta, rows: [r] });
    }
    return Array.from(map.values());
  }, [rows]);

  const totalPending = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Προβλήματα & λύσεις — {dayLabel}</DialogTitle>
          <DialogDescription>
            {totalPending > 0
              ? `${totalPending} ${totalPending === 1 ? 'παραστατικό χρειάζεται' : 'παραστατικά χρειάζονται'} ενέργεια.`
              : 'Καμία εκκρεμότητα για αυτή την ημέρα.'}
          </DialogDescription>
        </DialogHeader>

        {totalPending === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <FiCheckCircle className="size-8 text-emerald-500" />
            <p className="text-sm text-muted-foreground">Όλα τα παραστατικά της ημέρας είναι εντάξει.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
            {groups.map((g) => (
              <div
                key={g.meta.status}
                className="rounded-lg border p-3"
                style={{ backgroundColor: g.meta.tone.bg, borderColor: g.meta.tone.bd }}
              >
                <div className="flex items-center gap-2">
                  <FiAlertTriangle className="size-4 shrink-0" style={{ color: g.meta.tone.fg }} />
                  <span className="text-[13px] font-semibold" style={{ color: g.meta.tone.fg }}>
                    {g.meta.label}
                  </span>
                  <span
                    className="ml-auto rounded-full border bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                    style={{ color: g.meta.tone.fg, borderColor: g.meta.tone.bd }}
                  >
                    {g.rows.length}
                  </span>
                </div>

                {g.meta.problem && (
                  <p className="mt-1.5 text-[12px] text-foreground/80">{g.meta.problem}</p>
                )}
                {g.meta.solution && (
                  <p className="mt-1 text-[12px]">
                    <span className="font-semibold">Λύση: </span>
                    <span className="text-foreground/80">{g.meta.solution}</span>
                  </p>
                )}

                <ul className="mt-2 space-y-0.5">
                  {g.rows.map((r) => (
                    <li key={r.id} className="truncate text-[11px] font-mono text-foreground/70" title={r.fileName}>
                      · {r.fileName}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
