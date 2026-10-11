import * as React from 'react';
import Link from 'next/link';
import { FiZap, FiDroplet, FiThermometer, FiPhone, FiTruck, FiAlertTriangle, FiInfo, FiCheck, FiHelpCircle } from 'react-icons/fi';
import type { IconType } from 'react-icons';
import {
  UTILITY_CHARGE_LABEL, UTILITY_KIND_TITLE, OUTSIDE_VAT_CHARGES,
  type UtilityAnalysis, type UtilityCharge, type UtilityKind,
} from '@/lib/ocr/utility-bills';

const KIND_ICON: Record<UtilityKind, IconType> = {
  electricity: FiZap, water: FiDroplet, gas: FiThermometer, telecom: FiPhone, vehicle_lease: FiTruck,
};

/** Μία γραμμή του παραστατικού όπως τη χρειάζεται η κάρτα. */
export interface UtilityCardLine {
  amount: number | null;
  /** «6103 — Αμοιβές…» όταν η γραμμή έχει αντιστοίχιση, αλλιώς `null`. */
  target: string | null;
  /** `memory` = τη συμπλήρωσε ο κανόνας· `manual` = ο χρήστης. */
  matchedBy: string | null;
}

const money = (n: number) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);

/** Ο ΤΙΤΛΟΣ μιας γραμμής στον πίνακα: ποιο είδος χρέωσης είναι. */
export function UtilityChargeChip({ charge }: { charge: UtilityCharge | null }) {
  if (!charge) return null;
  const outside = OUTSIDE_VAT_CHARGES.includes(charge);
  return (
    <span
      className="ml-1.5 inline-flex items-center rounded-full border border-sisyphus-500/30 bg-sisyphus-500/[0.07] px-2 py-px align-middle text-[length:var(--fs-10)] font-semibold text-sisyphus-700"
      title={outside ? 'Εκτός ΦΠΑ από τη φύση του' : undefined}
    >
      {UTILITY_CHARGE_LABEL[charge]}{outside ? ' · εκτός ΦΠΑ' : ''}
    </span>
  );
}

/**
 * «Αυτό είναι λογαριασμός ρεύματος της ΗΡΩΝ» — και ανά είδος χρέωσης, πού πηγαίνει.
 *
 * Η κάρτα δεν ζητά νέα δουλειά: λέει ΤΙ αναγνωρίστηκε, ΠΟΙΑ είδη χρέωσης έχουν ήδη λογαριασμό
 * (από τον κανόνα ή από τον χρήστη) και τι πρέπει να ελέγξει ο λογιστής. Η αντιστοίχιση γίνεται
 * όπως πάντα στον πίνακα γραμμών· μία απόφαση ανά είδος χρέωσης αρκεί για όλους τους λογαριασμούς.
 */
export function UtilityBillCard({
  analysis, lines, period, helpHref,
}: {
  analysis: UtilityAnalysis;
  lines: UtilityCardLine[];
  period: { from: string | null; to: string | null } | null;
  helpHref: string | null;
}) {
  const Icon = KIND_ICON[analysis.kind];
  // Ομάδες ανά είδος χρέωσης, με τη σειρά που εμφανίζονται στο παραστατικό.
  const groups = new Map<UtilityCharge | 'none', { idx: number[]; total: number; targets: Set<string>; matched: number; byRule: number }>();
  analysis.lines.forEach(({ index, charge }) => {
    const key = charge ?? 'none';
    const g = groups.get(key) ?? { idx: [], total: 0, targets: new Set<string>(), matched: 0, byRule: 0 };
    const l = lines[index];
    g.idx.push(index + 1);
    g.total += l?.amount ?? 0;
    if (l?.target) { g.targets.add(l.target); g.matched++; if (l.matchedBy === 'memory') g.byRule++; }
    groups.set(key, g);
  });
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('el-GR') : '…');

  return (
    <section
      aria-labelledby="utility-card-title"
      className="rounded-xl border border-border border-l-4 border-l-sisyphus-500 bg-card p-4 shadow-fluent-2"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sisyphus-500 text-white">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="utility-card-title" className="text-[length:var(--fs-14)] font-semibold text-foreground">
              {UTILITY_KIND_TITLE[analysis.kind]}
              {analysis.provider ? <span className="font-normal text-muted-foreground"> · {analysis.provider}</span> : null}
            </h2>
            <p className="mt-0.5 text-[length:var(--fs-12)] text-muted-foreground" title={analysis.evidence.join(' · ')}>
              {period && (period.from || period.to) ? `Περίοδος ${fmtDate(period.from)} – ${fmtDate(period.to)} · ` : ''}
              Αναγνωρίστηκε από: {analysis.evidence.join(', ')}
            </p>
          </div>
        </div>
        {helpHref && (
          <Link
            href={helpHref}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-[length:var(--fs-12)] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FiHelpCircle className="size-3.5" aria-hidden /> Πώς λειτουργεί
          </Link>
        )}
      </header>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from(groups.entries()).map(([charge, g]) => {
          const done = g.matched === g.idx.length;
          const target = g.targets.size === 1 ? Array.from(g.targets)[0] : g.targets.size > 1 ? `${g.targets.size} διαφορετικοί λογαριασμοί` : null;
          return (
            <li key={charge} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[length:var(--fs-12)] font-semibold text-foreground">
                  {charge === 'none' ? 'Χωρίς κατάταξη' : UTILITY_CHARGE_LABEL[charge]}
                </span>
                <span className="shrink-0 text-[length:var(--fs-12)] font-semibold tabular-nums text-foreground">{money(g.total)}</span>
              </div>
              <p className="mt-0.5 text-[length:var(--fs-11)] text-muted-foreground">
                Γραμμ{g.idx.length === 1 ? 'ή' : 'ές'} {g.idx.join(', ')}
                {charge !== 'none' && OUTSIDE_VAT_CHARGES.includes(charge) ? ' · εκτός ΦΠΑ' : ''}
              </p>
              <p className={`mt-1 flex items-start gap-1 text-[length:var(--fs-11)] ${done ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                {done ? <FiCheck className="mt-px size-3.5 shrink-0" aria-hidden /> : null}
                <span>
                  {target
                    ? <>{done ? '' : `${g.matched}/${g.idx.length} · `}{target}{g.byRule > 0 ? ' · από κανόνα' : ''}</>
                    : 'Χωρίς λογαριασμό'}
                </span>
              </p>
            </li>
          );
        })}
      </ul>

      {Array.from(groups.entries()).some(([c, g]) => c !== 'none' && g.matched < g.idx.length) && (
        <p className="mt-2 text-[length:var(--fs-12)] text-muted-foreground">
          Αντιστοίχισε στον πίνακα γραμμών <strong className="font-semibold text-foreground">μία γραμμή ανά είδος χρέωσης</strong>:
          οι υπόλοιπες του ίδιου είδους, εδώ και σε κάθε λογαριασμό {UTILITY_KIND_TITLE[analysis.kind].replace(/^Λογαριασμός |^Μισθώματα /, '')}, συμπληρώνονται μόνες τους.
        </p>
      )}

      {analysis.findings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {analysis.findings.map((f) => (
            <li
              key={f.code}
              role={f.tone === 'warning' ? 'alert' : undefined}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[length:var(--fs-12)] ${
                f.tone === 'warning'
                  ? 'border-amber-500/40 bg-amber-500/[0.06] text-foreground'
                  : 'border-sisyphus-500/25 bg-sisyphus-500/[0.06] text-foreground'
              }`}
            >
              {f.tone === 'warning'
                ? <FiAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                : <FiInfo className="mt-0.5 size-3.5 shrink-0 text-sisyphus-600" aria-hidden />}
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
