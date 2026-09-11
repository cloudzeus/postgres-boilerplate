'use client';

import * as React from 'react';
import { integerTicks, niceMax } from '@/lib/dashboard/series';
import { useChartWidth } from '@/components/admin/use-chart-width';
import { fmtInt } from './format';

export interface DocsDailyPoint {
  day: string;
  label: string;
  created: number;
  posted: number;
  weekend: boolean;
}

// Inline hex — τα γραφήματα δεν πατάνε σε δυναμικές Tailwind κλάσεις (JIT purge).
const CREATED = '#0078D4'; // Sisyphus Blue — έγγραφα που δημιουργήθηκαν (στήλες)
const POSTED = '#2E9E6B';  // muted green   — καταχωρήθηκαν στο SoftOne (γραμμή)

/** Catmull-Rom → cubic Bézier, ίδια εξομάλυνση με το `ai-usage-daily-chart`. */
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
 * Έγγραφα ανά ημέρα: στήλες για όσα δημιουργήθηκαν, εξομαλυμένη γραμμή για όσα
 * καταχωρήθηκαν στο SoftOne. Οι τιμές είναι διαθέσιμες με τρεις τρόπους —
 * `<title>` πάνω σε κάθε στήλη (και για πληκτρολόγιο, μέσω `tabIndex`), HTML
 * tooltip στο hover, και ο κρυφός πίνακας κάτω από το γράφημα για αναγνώστες οθόνης.
 */
export function DocsDailyChart({ data }: { data: DocsDailyPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Το viewBox ακολουθεί το πραγματικό πλάτος, ώστε οι ετικέτες των αξόνων να
  // μένουν στο μέγεθός τους και στα 375 px (βλ. `useChartWidth`).
  const W = useChartWidth(wrapRef);
  const n = data.length;
  const H = 210;
  const padL = 34, padR = 8, padT = 12, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const baseY = padT + innerH;

  const totalCreated = data.reduce((s, d) => s + d.created, 0);
  const totalPosted = data.reduce((s, d) => s + d.posted, 0);

  if (n === 0 || (totalCreated === 0 && totalPosted === 0)) {
    return (
      <p className="py-8 text-center text-body-sm text-muted-foreground">
        Δεν υπάρχουν έγγραφα σε αυτή την περίοδο.
      </p>
    );
  }

  const peak = Math.max(...data.map((d) => Math.max(d.created, d.posted)), 0);
  const top = niceMax(peak);
  const ticks = integerTicks(peak);

  const slot = innerW / n;
  const barW = Math.max(2, Math.min(22, slot * 0.62));
  const cx = (i: number) => padL + slot * i + slot / 2;
  const y = (v: number) => baseY - (v / top) * innerH;

  const postedPts = data.map((d, i) => [cx(i), y(d.posted)] as [number, number]);

  // Πόσο πυκνά μπαίνουν οι ετικέτες του άξονα x ώστε να μη στριμώχνονται στα 375px.
  // ~56 px ανά ετικέτα «ηη/μμ» — σε στενή οθόνη μπαίνουν λιγότερες, όχι στριμωγμένες.
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 56))));
  // Η τελευταία ημέρα μπαίνει πάντα — εκτός αν πέφτει κολλητά στην προηγούμενη ετικέτα.
  const showLabel = (i: number) =>
    i % labelStep === 0 || (i === n - 1 && (n - 1) % labelStep >= labelStep / 2);

  function onMove(e: React.MouseEvent) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((rel - padL) / slot);
    setHover(i >= 0 && i < n ? i : null);
  }

  const hp = hover != null ? data[hover] : null;
  const tooltipLeft = hover != null ? Math.min(88, Math.max(12, (cx(hover) / W) * 100)) : 50;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-3.5 rounded-[2px]" style={{ background: CREATED }} />
          Νέα έγγραφα · <strong className="font-semibold tabular-nums text-foreground">{fmtInt(totalCreated)}</strong>
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-[2px] w-4 rounded-full" style={{ background: POSTED }} />
          Καταχωρήθηκαν · <strong className="font-semibold tabular-nums text-foreground">{fmtInt(totalPosted)}</strong>
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative text-muted-foreground"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          className="block"
          role="img"
          aria-label={`Έγγραφα ανά ημέρα: ${fmtInt(totalCreated)} νέα έγγραφα και ${fmtInt(totalPosted)} καταχωρίσεις στο SoftOne σε ${fmtInt(n)} ημέρες. Οι ακριβείς τιμές ανά ημέρα δίνονται στον πίνακα που ακολουθεί.`}
        >
          {/* Πλέγμα + άξονας y */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL} y1={y(t)} x2={W - padR} y2={y(t)}
                stroke="currentColor" strokeOpacity={0.09} strokeWidth={1}
              />
              <text
                x={padL - 6} y={y(t) + 3} textAnchor="end"
                fontSize={9} fill="currentColor" opacity={0.6}
              >
                {fmtInt(t)}
              </text>
            </g>
          ))}
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />

          {/* Στήλες — νέα έγγραφα */}
          {data.map((d, i) => {
            const h = d.created > 0 ? Math.max(1.5, baseY - y(d.created)) : 0;
            return (
              <g key={d.day}>
                {/* Διάδρομος hover/εστίασης σε όλο το ύψος: εύκολος στόχος και στο κινητό. */}
                <rect
                  x={cx(i) - slot / 2} y={padT} width={slot} height={innerH}
                  fill={hover === i ? 'currentColor' : 'transparent'}
                  fillOpacity={hover === i ? 0.05 : 0}
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.label}: ${fmtInt(d.created)} νέα, ${fmtInt(d.posted)} καταχωρήθηκαν`}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="cursor-default outline-none focus-visible:stroke-[var(--ring)] focus-visible:[stroke-width:2]"
                >
                  <title>{`${d.label} — ${fmtInt(d.created)} νέα έγγραφα, ${fmtInt(d.posted)} καταχωρήθηκαν`}</title>
                </rect>
                {h > 0 && (
                  <rect
                    x={cx(i) - barW / 2} y={baseY - h} width={barW} height={h}
                    rx={Math.min(2, barW / 3)}
                    fill={CREATED}
                    fillOpacity={hover === null || hover === i ? 0.9 : 0.45}
                    className="dash-bar-grow pointer-events-none"
                  />
                )}
              </g>
            );
          })}

          {/* Γραμμή — καταχωρήθηκαν */}
          {totalPosted > 0 && (
            <path
              d={smoothPath(postedPts)}
              fill="none" stroke={POSTED} strokeWidth={1.75}
              strokeLinejoin="round" strokeLinecap="round"
              className="pointer-events-none"
            />
          )}
          {hover != null && hp && totalPosted > 0 && (
            <g className="pointer-events-none">
              <circle cx={cx(hover)} cy={y(hp.posted)} r={4.5} fill="var(--card)" />
              <circle cx={cx(hover)} cy={y(hp.posted)} r={2.75} fill={POSTED} />
            </g>
          )}

          {/* Ετικέτες x — τα σαββατοκύριακα πιο αχνά */}
          {data.map((d, i) => showLabel(i) ? (
            <text
              key={`x-${d.day}`} x={cx(i)} y={H - 7} textAnchor="middle"
              fontSize={9} fill="currentColor" opacity={d.weekend ? 0.3 : 0.6}
              className="pointer-events-none"
            >
              {d.label}
            </text>
          ) : null)}
        </svg>

        {hover != null && hp && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card/95 px-2.5 py-1.5 shadow-pop backdrop-blur-sm"
            style={{ left: `${tooltipLeft}%` }}
          >
            <div className="mb-1 text-caption font-semibold text-foreground">{hp.label}</div>
            <TooltipRow color={CREATED} label="Νέα έγγραφα" value={fmtInt(hp.created)} />
            <TooltipRow color={POSTED} label="Καταχωρήθηκαν" value={fmtInt(hp.posted)} />
          </div>
        )}
      </div>

      {/* Ισοδύναμο κειμένου — το γράφημα δεν είναι ο μόνος τρόπος να διαβαστούν τα νούμερα. */}
      <table className="sr-only">
        <caption>Έγγραφα ανά ημέρα</caption>
        <thead>
          <tr><th scope="col">Ημέρα</th><th scope="col">Νέα έγγραφα</th><th scope="col">Καταχωρήθηκαν</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={`sr-${d.day}`}>
              <th scope="row">{d.label}</th>
              <td>{fmtInt(d.created)}</td>
              <td>{fmtInt(d.posted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-caption">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} /> {label}
      </span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}
