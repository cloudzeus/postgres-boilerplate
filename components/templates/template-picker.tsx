'use client';

// Which template to run on this document. Templates whose ΑΦΜ matches the issuer come first in
// their own group — that is the one the runner would have picked by itself at upload.

import * as React from 'react';
import { STATUS_LABEL } from '@/lib/templates/labels';
import { matchesVat } from '@/lib/templates/run-view';

export type TemplateSummary = {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE';
  mode: 'AUTO' | 'SEMI_AUTO' | 'MANUAL';
  vatNumber: string | null;
  department: string | null;
};

type Props = {
  templates: TemplateSummary[];
  issuerVat: string | null;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
};

const label = (t: TemplateSummary) => `${t.name} · ${STATUS_LABEL[t.status]}`;

export function TemplatePicker({ templates, issuerVat, value, onChange, disabled, className }: Props) {
  const [forVat, rest] = React.useMemo(() => {
    const a: TemplateSummary[] = [];
    const b: TemplateSummary[] = [];
    for (const t of templates) (matchesVat(t, issuerVat) ? a : b).push(t);
    return [a, b];
  }, [templates, issuerVat]);

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Πρότυπο εξαγωγής"
      className={`h-8 min-w-[14rem] max-w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-[length:var(--fs-12)] disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
    >
      <option value="">— Επίλεξε πρότυπο —</option>
      {forVat.length > 0 && (
        <optgroup label="Για το ΑΦΜ εκδότη">
          {forVat.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label="Όλα">
          {rest.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}
        </optgroup>
      )}
    </select>
  );
}
