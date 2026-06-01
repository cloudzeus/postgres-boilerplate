'use client';

import * as React from 'react';
import { FiSearch, FiCheck } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export type SoftoneSearchResult = { id: number; code: string; name: string; sub: string; isService?: boolean };

/**
 * Reusable search body: debounced query against the local SoftOne mirror + a
 * results list. Shared by SoftoneMatchPicker (popover) and other surfaces that
 * need the same search inside a dialog (e.g. "copy from similar item").
 */
export function SoftoneSearchPanel({
  type,
  service,
  autoFocus = true,
  placeholder = 'Αναζήτηση (κωδικός / όνομα / ΑΦΜ)…',
  onPick,
}: {
  type: 'items' | 'suppliers';
  service?: '0' | '1';
  autoFocus?: boolean;
  placeholder?: string;
  onPick: (r: SoftoneSearchResult) => void | Promise<void>;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<SoftoneSearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ type, q });
        if (service) params.set('service', service);
        const res = await fetch(`/api/admin/softone/search?${params}`);
        const d = await res.json();
        setResults(d.results ?? []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, type, service]);

  return (
    <div>
      <div className="relative">
        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 pl-8 text-[12px]" />
      </div>
      <div className="mt-2 max-h-64 overflow-auto">
        {loading && <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">Αναζήτηση…</p>}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">Κανένα αποτέλεσμα</p>
        )}
        {results.map((r) => (
          <button
            key={r.id}
            onClick={async () => { await onPick(r); setQ(''); }}
            className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            <FiCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 opacity-0 group-hover:opacity-100" />
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-foreground">{r.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                <span className="font-mono">{r.code}</span>{r.sub ? ` · ${r.sub}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Result = SoftoneSearchResult;

/**
 * Search + pick a SoftOne entity (item/supplier) for manual matching.
 * `type` selects the mirror; `service` ('0'|'1') narrows items to products/services.
 */
export function SoftoneMatchPicker({
  type,
  service,
  triggerLabel = 'Αντιστοίχιση',
  onPick,
}: {
  type: 'items' | 'suppliers';
  service?: '0' | '1';
  triggerLabel?: string;
  onPick: (r: Result) => void | Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <FiSearch className="mr-1 h-3 w-3" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <SoftoneSearchPanel
          type={type}
          service={service}
          onPick={async (r) => { await onPick(r); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}
