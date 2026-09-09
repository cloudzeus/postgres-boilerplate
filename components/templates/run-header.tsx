'use client';

// Identity line of a run: which template produced it, in what state, when and at what cost.

import * as React from 'react';
import Link from 'next/link';
import { RUN_STATUS_LABEL, TRIGGER_LABEL } from '@/lib/templates/labels';
import type { RunStatus, RunTrigger } from '@/lib/templates/schema';
import type { RunDto } from '@/lib/templates/run-dto';
import { RunStatusPill } from './run-status-pill';

const DT = new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short' });
/** Dates cross the server→client boundary as strings once the page is serialised. */
export const fmtWhen = (d: Date | string): string => {
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? '—' : DT.format(v);
};
/** «στο upload · 10/09/26, 21:35» — the history row already shows the status as a pill. */
export const runWhen = (r: { trigger: string; createdAt: Date | string }): string =>
  `${TRIGGER_LABEL[r.trigger as RunTrigger] ?? r.trigger} · ${fmtWhen(r.createdAt)}`;
export const runLabel = (r: { status: RunStatus; trigger: string; createdAt: Date | string }): string =>
  `${RUN_STATUS_LABEL[r.status]} · ${runWhen(r)}`;

export function RunHeader({ run }: { run: RunDto }) {
  const meta = [
    TRIGGER_LABEL[run.trigger as RunTrigger] ?? run.trigger,
    fmtWhen(run.createdAt),
    `έκδοση ${run.templateVersion}`,
    run.model,
    run.tokensUsed ? `${run.tokensUsed.toLocaleString('el-GR')} tokens` : null,
    run.durationMs ? `${run.durationMs} ms` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/admin/ocr/templates/${run.template.id}`} className="text-sm font-semibold hover:underline">
          {run.template.name}
        </Link>
        <span className="font-mono text-[11px] text-muted-foreground">{run.template.slug}</span>
        <RunStatusPill status={run.status} />
      </div>
      <p className="text-[11px] text-muted-foreground">{meta.join(' · ')}</p>
      {run.error && (
        <p className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: '#B91C1C40', backgroundColor: '#FDE8E8', color: '#B91C1C' }}>
          {run.error}
        </p>
      )}
    </div>
  );
}
