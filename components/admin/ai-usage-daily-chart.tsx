'use client';

import * as React from 'react';

export type DailyPoint = { label: string; costEur: number; docs: number; rate: number };

// On-brand, muted palette (DG / Fluent 2). Inline hex — charts must not rely on
// dynamic Tailwind classes (JIT purge).
const COST = '#0078D4'; // Sisyphus Blue — κόστος/ημέρα (primary, area + thin line)
const DOCS = '#2E9E6B'; // muted green   — έγγραφα/ημέρα (thin line)
const RATE = '#C77F0A'; // warm amber    — ισοτιμία (subtle dotted line)

function fmtEur(n: number) {
  return new Intl.NumberFormat('el-GR', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

/** Catmull-Rom → cubic Bézier smoothing for elegant, non-jagged curves. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  const t = 0.18;
  const out = [`M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    out.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
  }
  return out.join(' ');
}

/**
 * 30-day AI usage chart (DG / Fluent 2 aesthetic): cost/day in EUR as a soft
 * gradient area, documents/day and the daily USD→EUR rate as thin smooth lines.
 * Each series is scaled to its own range; exact values appear on hover.
 */
export function AiUsageDailyChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const gid = React.useId().replace(/:/g, '');

  const n = data.length;
  const W = 920, H = 200;
  const padL = 6, padR = 6, padT = 12, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const baseY = padT + innerH;

  const maxCost = Math.max(...data.map((d) => d.costEur), 0.0001);
  const maxDocs = Math.max(...data.map((d) => d.docs), 1);
  const rateVals = data.map((d) => d.rate).filter((r) => r > 0);
  const minR = rateVals.length ? Math.min(...rateVals) : 0.8;
  const maxR = rateVals.length ? Math.max(...rateVals) : 1;
  const rSpan = maxR - minR || 1;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yCost = (v: number) => baseY - (v / maxCost) * innerH;
  const yDocs = (v: number) => baseY - (v / maxDocs) * innerH * 0.92 - innerH * 0.04;
  const yRate = (v: number) => baseY - innerH * 0.06 - ((v - minR) / rSpan) * innerH * 0.88;

  const costPts = data.map((d, i) => [x(i), yCost(d.costEur)] as [number, number]);
  const docsPts = data.map((d, i) => [x(i), yDocs(d.docs)] as [number, number]);
  const ratePts = data.map((d, i) => [x(i), yRate(d.rate)] as [number, number]);

  const costLine = smoothPath(costPts);
  const costArea = n > 1
    ? `${costLine} L ${x(n - 1).toFixed(1)} ${baseY} L ${x(0).toFixed(1)} ${baseY} Z`
    : '';

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
  const tooltipLeft = hover != null && n > 1 ? Math.min(90, Math.max(10, (hover / (n - 1)) * 100)) : 50;

  if (n === 0) {
    return <p className="text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα ακόμη.</p>;
  }

  const gridY = [0.25, 0.5, 0.75].map((f) => padT + innerH * f);

  return (
    <div>
      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: `${COST}33`, boxShadow: `inset 0 -1.5px 0 ${COST}` }} />
          Κόστος/ημέρα · <strong className="font-semibold text-foreground">{fmtEur(totalCost)}</strong>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-4 rounded-full" style={{ background: DOCS }} />
          Έγγραφα/ημέρα · <strong className="font-semibold text-foreground">{totalDocs}</strong>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-4 rounded-full" style={{ background: `repeating-linear-gradient(90deg, ${RATE} 0 2px, transparent 2px 5px)` }} />
          Ισοτιμία USD→EUR · <strong className="font-semibold text-foreground">{lastRate.toFixed(4)}</strong>
        </span>
      </div>

      <div ref={wrapRef} className="relative text-muted-foreground" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ημερήσιο κόστος, έγγραφα και ισοτιμία">
          <defs>
            <linearGradient id={`cost-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COST} stopOpacity={0.22} />
              <stop offset="100%" stopColor={COST} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* soft gridlines */}
          {gridY.map((gy, i) => (
            <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
          ))}
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />

          {/* cost: gradient area + thin line */}
          {costArea && <path d={costArea} fill={`url(#cost-${gid})`} stroke="none" />}
          <path d={costLine} fill="none" stroke={COST} strokeWidth={1.75} strokeOpacity={0.95} strokeLinejoin="round" strokeLinecap="round" />

          {/* documents: thin smooth line */}
          <path d={smoothPath(docsPts)} fill="none" stroke={DOCS} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

          {/* rate: subtle dotted line */}
          <path d={smoothPath(ratePts)} fill="none" stroke={RATE} strokeWidth={1.5} strokeOpacity={0.8} strokeDasharray="1 5" strokeLinecap="round" />

          {/* hover guide + markers with halo */}
          {hover != null && hp && (
            <>
              <line x1={x(hover)} y1={padT} x2={x(hover)} y2={baseY} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
              {[[yCost(hp.costEur), COST], [yDocs(hp.docs), DOCS], [yRate(hp.rate), RATE]].map(([cy, c], i) => (
                <g key={i}>
                  <circle cx={x(hover)} cy={cy as number} r={4.5} fill="var(--card, #fff)" />
                  <circle cx={x(hover)} cy={cy as number} r={2.75} fill={c as string} />
                </g>
              ))}
            </>
          )}

          {/* x labels (every 5th + last) */}
          {data.map((d, i) => (i % 5 === 0 || i === n - 1) ? (
            <text key={`x${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.55}>{d.label}</text>
          ) : null)}
        </svg>

        {/* Tooltip — Fluent elevation */}
        {hover != null && hp && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-[10px] shadow-pop backdrop-blur-sm"
            style={{ left: `${tooltipLeft}%` }}
          >
            <div className="mb-1 text-[11px] font-semibold text-foreground">{hp.label}</div>
            <div className="space-y-0.5">
              <Row color={COST} label="Κόστος" value={fmtEur(hp.costEur)} />
              <Row color={DOCS} label="Έγγραφα" value={String(hp.docs)} />
              <Row color={RATE} label="Ισοτιμία" value={hp.rate.toFixed(4)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 rounded-full" style={{ background: color }} /> {label}
      </span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
