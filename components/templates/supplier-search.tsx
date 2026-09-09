'use client';

import * as React from 'react';
import { FiSearch, FiX } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { templatesApi } from './api';

export type SupplierPick = { id: number; name: string; vat: string };
type Result = { id: number; code: string; name: string; sub: string };

/** SoftOne supplier lookup (≥2 chars, debounced). `value` null = no supplier linked. */
export function SupplierSearch({ value, onChange, disabled, id = 'sup' }: { value: SupplierPick | null; onChange: (v: SupplierPick | null) => void; disabled?: boolean; id?: string }) {
  const [q, setQ] = React.useState(value?.name ?? '');
  const [results, setResults] = React.useState<Result[]>([]);
  React.useEffect(() => { setQ(value?.name ?? ''); }, [value?.name]);
  React.useEffect(() => {
    if (value || q.trim().length < 2) { setResults([]); return; }
    // `ignore` so a slow in-flight search cannot land after a newer query's results.
    let ignore = false;
    const h = setTimeout(() => {
      templatesApi.searchSuppliers(q.trim()).then((r) => { if (!ignore) setResults(r.results); }).catch(() => { if (!ignore) setResults([]); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q, value]);
  const pick = (s: Result) => { onChange({ id: s.id, name: s.name, vat: /\b(\d{9})\b/.exec(s.sub)?.[1] ?? '' }); setResults([]); };
  return (
    <div className="relative">
      <Label htmlFor={id}>Προμηθευτής SoftOne (προαιρετικό)</Label>
      <div className="relative mt-1">
        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={q} disabled={disabled} onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }} placeholder="Αναζήτηση επωνυμίας / ΑΦΜ…" className="pl-8 pr-8" autoComplete="off" />
        {value && !disabled && <button type="button" aria-label="Καθαρισμός προμηθευτή" onClick={() => { onChange(null); setQ(''); }} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)]"><FiX className="size-3.5" /></button>}
      </div>
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-white shadow-fluent-8">
          {results.map((s) => (
            <li key={s.id}><button type="button" onClick={() => pick(s)} className="flex w-full cursor-pointer flex-col px-3 py-2 text-left hover:bg-[var(--cx-hover)]">
              <span className="text-[13px] font-medium">{s.name}</span><span className="text-[11px] text-muted-foreground">{s.sub}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
