'use client';

import * as React from 'react';

export type DailyPoint = { label: string; costEur: number; docs: number; rate: number };

// Distinct inline hex (CLAUDE.md: avoid dynamic Tailwind classes in charts).
const COST = '#2563eb'; // blue   — κόστος/ημέρα
const DOCS = '#059669'; // green  — έγγραφα/ημέρα
const RATE = '#d97706'; // amber  — ισοτιμία USD→EUR

function fmtEur(n: number) {
  return new Intl.NumberFormat('el-GR', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

/**
 * 30-day AI usage chart: cost/day (EUR) as bars, documents/day and the daily
 * USD→EUR rate as overlaid lines. Each series is scaled to its own range (the
 * three magnitudes differ wildly); exact values are shown on hover.
 */
export function AiUsageDailyChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const n = data.length;
  const W = 900, H = 240;
  const padL = 8, padR = 8, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxCost = Math.max(...data.map((d) => d.costEur), 0.0001);
  const maxDocs = Math.max(...data.map((d) => d.docs), 1);
  const rateVals = data.map((d) => d.rate).filter((r) => r > 0);
  const minR = rateVals.length ? Math.min(...rateVals) : 0.8;
  const maxR = rateVals.length ? Math.max(...rateVals) : 1;
  const rSpan = maxR - minR || 1;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yCost = (v: number) => padT + innerH - (v / maxCost) * innerH;
  const yDocs = (v: number) => padT + innerH - (v / maxDocs) * innerH;
  // Rate uses 90% of the height with 5% top/bottom margins so its variation is visible.
  const yRate = (v: number) => padT + innerH - 0.05 * innerH - ((v - minR) / rSpan) * innerH * 0.9;

  const barW = Math.max(2, (innerW / Math.max(n, 1)) * 0.55);

  const linePath = (sel: (d: DailyPoint) => number, y: (v: number) => number) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(sel(d)).toFixed(1)}`).join(' ');

  function onMove(e: React.MouseEvent) {
    const el = wrapRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  }

  const totalCost = data.reduce((s, d) => s + d.costEur, 0);
  const totalDocs = data.reduce((s, d) => s + d.docs, 0);
  const lastRate = [...data].reverse().find((d) => d.rate > 0)?.rate ?? 0;
  const hp = hover != null ? data[hover] : null;
  const tooltipLeft = hover != null && n > 1 ? Math.min(92, Math.max(8, (hover / (n - 1)) * 100)) : 50;

  if (n === 0) {
    return <p className="text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα ακόμη.</p>;
  }

  return (
    <div>
      {/* Legend */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: COST }} /> Κόστος/ημέρα · σύνολο <strong className="text-foreground">{fmtEur(totalCost)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded" style={{ background: DOCS }} /> Έγγραφα/ημέρα · σύνολο <strong className="text-foreground">{totalDocs}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded" style={{ background: RATE }} /> Ισοτιμία USD→EUR · τρέχουσα <strong className="text-foreground">{lastRate.toFixed(4)}</strong>
        </span>
      </div>

      <div ref={wrapRef} className="relative text-muted-foreground" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ημερήσιο κόστος, έγγραφα και ισοτιμία">
          {/* baseline */}
          <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />
          {/* cost bars */}
          {data.map((d, i) => (
            <rect key={i} x={x(i) - barW / 2} y={yCost(d.costEur)} width={barW}
              height={Math.max(0, padT + innerH - yCost(d.costEur))} rx={1.5} fill={COST} opacity={0.85} />
          ))}
          {/* documents line */}
          <path d={linePath((d) => d.docs, yDocs)} fill="none" stroke={DOCS} strokeWidth={2} strokeLinejoin="round" />
          {/* rate line (dashed) */}
          <path d={linePath((d) => d.rate, yRate)} fill="none" stroke={RATE} strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />
          {/* hover guide + markers */}
          {hover != null && (
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + innerH} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
          )}
          {hover != null && hp && (
            <>
              <circle cx={x(hover)} cy={yDocs(hp.docs)} r={3.5} fill={DOCS} />
              <circle cx={x(hover)} cy={yRate(hp.rate)} r={3.5} fill={RATE} />
            </>
          )}
          {/* x-axis labels (every 5th + last), aligned to points */}
          {data.map((d, i) => (i % 5 === 0 || i === n - 1) ? (
            <text key={`x${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.6}>{d.label}</text>
          ) : null)}
        </svg>

        {/* Tooltip */}
        {hover != null && hp && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-[10px] shadow-pop"
            style={{ left: `${tooltipLeft}%` }}
          >
            <div className="mb-0.5 font-semibold text-foreground">{hp.label}</div>
            <div style={{ color: COST }}>Κόστος: {fmtEur(hp.costEur)}</div>
            <div style={{ color: DOCS }}>Έγγραφα: {hp.docs}</div>
            <div style={{ color: RATE }}>Ισοτιμία: {hp.rate.toFixed(4)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
