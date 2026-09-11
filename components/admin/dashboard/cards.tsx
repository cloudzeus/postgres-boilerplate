import * as React from 'react';
import Link from 'next/link';
import { FiArrowUpRight, FiArrowDownRight, FiMinus, FiCheckCircle, FiChevronRight, FiFile } from 'react-icons/fi';
import { donutSlices, share, RANGES, type Range } from '@/lib/dashboard/series';
import type {
  KpiDatum, BreakdownItem, AttentionRow, RecentDoc, SupplierRow, TemplateHealth,
} from '@/lib/dashboard/stats';
import { fmtInt, fmtEur, fmtPct, fmtDuration, RANGE_LABEL, rangePhrase } from './format';

/** Κοινό focus ring — κάθε σύνδεσμος του dashboard το φοράει. */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]';

// ── Επιλογέας περιόδου ───────────────────────────────────────────────────────

export function RangeTabs({ active }: { active: Range }) {
  return (
    <nav aria-label="Περίοδος" className="inline-flex rounded-lg border border-border bg-card p-1 shadow-card">
      {RANGES.map((r) => {
        const current = r === active;
        return (
          <Link
            key={r}
            href={`/admin?range=${r}`}
            aria-current={current ? 'page' : undefined}
            aria-label={`Περίοδος: ${rangePhrase(r)}`}
            className={[
              'cx-transition inline-flex min-h-[44px] min-w-[56px] items-center justify-center rounded-md px-3 text-body-sm font-semibold',
              FOCUS,
              current
                ? 'bg-[var(--cx-accent-soft)] text-primary'
                : 'text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-foreground',
            ].join(' ')}
          >
            {RANGE_LABEL[r]}
          </Link>
        );
      })}
    </nav>
  );
}

// ── KPI ──────────────────────────────────────────────────────────────────────

export interface KpiProps {
  label: string;
  datum: KpiDatum;
  icon: React.ReactNode;
  href: string;
  /** Μορφοποίηση της μεγάλης τιμής (π.χ. EUR αντί για ακέραιο). */
  format?: (n: number) => string;
  /** `true` όταν η άνοδος είναι κακό νέο (αποτυχίες, κόστος) — αλλάζει μόνο το χρώμα. */
  invert?: boolean;
  rangeLabel: string;
}

export function KpiCard({ label, datum, icon, href, format = fmtInt, invert, rangeLabel }: KpiProps) {
  const { dir, pct } = datum.delta;
  const good = dir === 'flat' ? null : (dir === 'up') !== Boolean(invert);
  const tone = good === null
    ? 'text-muted-foreground bg-[var(--muted)]'
    : good
      ? 'text-[#1B7A4E] bg-[#E8F5EE]'
      : 'text-[#A3253C] bg-[#FDECEF]';

  const DirIcon = dir === 'up' ? FiArrowUpRight : dir === 'down' ? FiArrowDownRight : FiMinus;
  const dirWord = dir === 'up' ? 'αύξηση' : dir === 'down' ? 'μείωση' : 'χωρίς μεταβολή';
  // Χωρίς προηγούμενη περίοδο το ποσοστό δεν ορίζεται — δείχνουμε την απόλυτη
  // διαφορά, που είναι πιο χρήσιμη από ένα κενό «—».
  const chipText = pct != null
    ? fmtPct(pct, pct < 10 ? 1 : 0)
    : datum.delta.diff !== 0 ? `+${format(Math.abs(datum.delta.diff))}` : '—';
  const deltaAria = pct == null
    ? `${dirWord} κατά ${format(Math.abs(datum.delta.diff))} — η προηγούμενη περίοδος ήταν μηδενική`
    : `${dirWord} ${fmtPct(pct, pct < 10 ? 1 : 0)} έναντι της προηγούμενης περιόδου (${format(datum.previous)})`;

  return (
    <Link
      href={href}
      className={`cx-card cx-transition block p-4 hover:-translate-y-0.5 hover:shadow-fluent-4 ${FOCUS}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-[var(--cx-accent-soft)] text-primary [&_svg]:size-4">
          {icon}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${tone}`}
          aria-label={deltaAria}
        >
          <DirIcon aria-hidden className="size-3" />
          <span aria-hidden className="tabular-nums">{chipText}</span>
        </span>
      </div>
      <div className="mt-3 text-title-2 font-semibold leading-none tabular-nums text-foreground">
        {format(datum.value)}
      </div>
      <div className="mt-1 text-body-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-caption text-muted-foreground/80">{rangeLabel}</div>
    </Link>
  );
}

// ── Κάρτα ──────────────────────────────────────────────────────────────────

export function Card({
  title, description, action, children, className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`cx-card p-4 ${className ?? ''}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

const R = 52;
const CIRC = 2 * Math.PI * R;

export function DonutCard({
  title, description, items, totalLabel,
}: {
  title: string;
  description?: string;
  items: BreakdownItem[];
  totalLabel: string;
}) {
  const { slices, total } = donutSlices(items, CIRC);
  const summary = total === 0
    ? 'Δεν υπάρχουν δεδομένα σε αυτή την περίοδο.'
    : slices.map((s) => `${s.label}: ${fmtInt(s.value)} (${fmtPct(s.pct)})`).join(', ');

  return (
    <Card title={title} description={description}>
      {total === 0 ? (
        <p className="py-8 text-center text-body-sm text-muted-foreground">
          Δεν υπάρχουν δεδομένα σε αυτή την περίοδο.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <svg
            viewBox="0 0 140 140"
            className="size-[132px] shrink-0 -rotate-90"
            role="img"
            aria-label={`${title}. ${summary}`}
          >
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--muted)" strokeWidth="16" />
            {slices.map((s) => s.value > 0 && (
              <circle
                key={s.key}
                cx="70" cy="70" r={R} fill="none"
                stroke={s.color} strokeWidth="16"
                strokeDasharray={s.dash} strokeDashoffset={s.offset}
                strokeLinecap="butt"
              >
                <title>{`${s.label}: ${fmtInt(s.value)} (${fmtPct(s.pct)})`}</title>
              </circle>
            ))}
            <g className="rotate-90" style={{ transformOrigin: '70px 70px' }}>
              <text x="70" y="66" textAnchor="middle" className="fill-foreground" fontSize="24" fontWeight="600">
                {fmtInt(total)}
              </text>
              <text x="70" y="84" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {totalLabel}
              </text>
            </g>
          </svg>

          <ul className="w-full min-w-0 space-y-1.5">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-body-sm">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">{fmtInt(s.value)}</span>
                <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{fmtPct(s.pct)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ── Οριζόντιες μπάρες ────────────────────────────────────────────────────────

export function BarList({
  title, description, rows, color, emptyText, format = fmtInt,
}: {
  title: string;
  description?: string;
  rows: Array<{ label: string; value: number; sub?: string }>;
  color: string;
  emptyText: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <Card title={title} description={description}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body-sm text-foreground" title={r.label}>{r.label}</span>
                <span className="shrink-0 text-body-sm font-semibold tabular-nums text-foreground">
                  {format(r.value)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
                  role="img"
                  aria-label={`${r.label}: ${format(r.value)}${r.sub ? `, ${r.sub}` : ''}`}
                >
                  <div
                    className="dash-bar-wipe h-full rounded-full"
                    style={{ width: `${share(r.value, max)}%`, background: color }}
                  />
                </div>
                {r.sub && <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{r.sub}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Χρειάζονται προσοχή ──────────────────────────────────────────────────────

export function AttentionCard({ rows }: { rows: AttentionRow[] }) {
  const pending = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card
      title="Χρειάζονται προσοχή"
      description={pending === 0 ? 'Όλα καθαρά.' : `${fmtInt(pending)} εκκρεμότητες συνολικά.`}
    >
      <ul className="divide-y divide-[var(--cx-divider)]">
        {rows.map((r) => {
          const zero = r.count === 0;
          return (
            <li key={r.key}>
              <Link
                href={r.href}
                className={`cx-transition flex min-h-[44px] items-center gap-3 py-1.5 pr-1 ${FOCUS} ${zero ? 'text-muted-foreground' : 'text-foreground hover:bg-[var(--cx-hover)]'} rounded-md px-1`}
                aria-label={zero ? `${r.label}: τίποτα εκκρεμές` : `${r.label}: ${fmtInt(r.count)} εκκρεμή`}
              >
                <span
                  aria-hidden
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm [&_svg]:size-3.5"
                  style={zero
                    ? { background: 'var(--muted)', color: 'var(--muted-foreground)' }
                    : { background: '#FDECEF', color: '#A3253C' }}
                >
                  {zero ? <FiCheckCircle /> : <FiChevronRight />}
                </span>
                <span className="min-w-0 flex-1 truncate text-body-sm">{r.label}</span>
                {zero ? (
                  <span className="shrink-0 text-caption text-muted-foreground">Τίποτα εκκρεμές</span>
                ) : (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums"
                    style={{ background: '#FDECEF', color: '#A3253C' }}
                  >
                    {fmtInt(r.count)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Πρόσφατα έγγραφα ─────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, { label: string; bg: string; fg: string }> = {
  COMPLETED:  { label: 'Ολοκληρώθηκε', bg: '#E8F5EE', fg: '#1B7A4E' },
  PROCESSING: { label: 'Σε εξέλιξη',   bg: '#EAF4FC', fg: '#00568F' },
  PENDING:    { label: 'Σε αναμονή',   bg: '#FDF3E3', fg: '#8A5A05' },
  FAILED:     { label: 'Απέτυχε',      bg: '#FDECEF', fg: '#A3253C' },
};

export function RecentDocsCard({ docs }: { docs: RecentDoc[] }) {
  return (
    <Card
      title="Πρόσφατα έγγραφα"
      description="Τα 8 τελευταία που ανέβηκαν."
      action={
        <Link href="/admin/ocr" className={`shrink-0 text-body-sm font-semibold text-primary hover:underline ${FOCUS} rounded-sm`}>
          Όλα
        </Link>
      }
    >
      {docs.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-muted-foreground">Δεν υπάρχουν έγγραφα ακόμη.</p>
      ) : (
        <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
          {docs.map((d) => {
            const pill = STATUS_PILL[d.status] ?? STATUS_PILL.PENDING;
            return (
              <li key={d.id} className="w-[160px] shrink-0 snap-start">
                <Link
                  href={`/admin/ocr/${d.id}`}
                  className={`cx-transition block rounded-lg border border-border bg-card p-2 hover:-translate-y-0.5 hover:shadow-fluent-4 ${FOCUS}`}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-border bg-[var(--muted)]">
                    {d.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span aria-hidden className="flex size-full items-center justify-center text-muted-foreground [&_svg]:size-6">
                        <FiFile />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-body-sm font-medium text-foreground" title={d.issuer ?? d.name}>
                    {d.issuer ?? d.name}
                  </p>
                  <p className="truncate text-caption tabular-nums text-muted-foreground">
                    {d.total != null ? fmtEur(d.total) : '—'}
                  </p>
                  <span
                    className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-caption font-semibold"
                    style={{ background: pill.bg, color: pill.fg }}
                  >
                    {pill.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Κορυφαίοι προμηθευτές ────────────────────────────────────────────────────

export function SuppliersCard({ rows, color }: { rows: SupplierRow[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.total), 0);
  return (
    <Card title="Κορυφαίοι προμηθευτές" description="Με βάση τη συνολική αξία της περιόδου.">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-muted-foreground">
          Δεν υπάρχουν εκδότες σε αυτή την περίοδο.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.name}>
              {/* Η λίστα OCR φιλτράρει client-side (DataTable searchKey), δεν διαβάζει `?q=`
                  — ο σύνδεσμος μένει σκέτος αντί να υπόσχεται φίλτρο που δεν υπάρχει. */}
              <Link
                href="/admin/ocr"
                className={`cx-transition block rounded-md px-1 py-1 hover:bg-[var(--cx-hover)] ${FOCUS}`}
                aria-label={`${r.name}: ${fmtInt(r.docs)} έγγραφα, ${fmtEur(r.total)}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-body-sm text-foreground" title={r.name}>{r.name}</span>
                  <span className="shrink-0 text-body-sm font-semibold tabular-nums text-foreground">
                    {fmtEur(r.total)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div
                      className="dash-bar-wipe h-full rounded-full"
                      style={{ width: `${share(r.total, max)}%`, background: color }}
                    />
                  </div>
                  <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                    {fmtInt(r.docs)} έγγρ.
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Υγεία προτύπων ───────────────────────────────────────────────────────────

export function TemplateStrip({ health }: { health: TemplateHealth }) {
  const cells = [
    { label: 'Ενεργά πρότυπα', value: fmtInt(health.active) },
    { label: 'Εκτελέσεις περιόδου', value: fmtInt(health.runs) },
    { label: 'Ποσοστό επιτυχίας', value: health.successRate == null ? '—' : fmtPct(health.successRate) },
    { label: 'Μέση διάρκεια', value: fmtDuration(health.avgDurationMs) },
  ];
  return (
    <section className="cx-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-body font-semibold tracking-tight text-foreground">Πρότυπα εξαγωγής</h2>
        <Link href="/admin/ocr/templates" className={`text-body-sm font-semibold text-primary hover:underline ${FOCUS} rounded-sm`}>
          Διαχείριση
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="text-caption text-muted-foreground">{c.label}</dt>
            <dd className="mt-0.5 text-subtitle font-semibold tabular-nums text-foreground">{c.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
