'use client';
import * as React from 'react';
import { FiChevronDown, FiCheck, FiPlus } from 'react-icons/fi';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export type ComboItem = { value: string; label: string };

export function Combobox({
  value, items, onSelect, onCreate, placeholder, allowCreate = false, disabled = false,
}: {
  value: string | null;
  items: ComboItem[];
  onSelect: (value: string) => void;
  onCreate?: (label: string) => void | Promise<void>;
  placeholder?: string;
  allowCreate?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = items.find((i) => i.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const exact = items.some((i) => i.label.trim().toLowerCase() === q);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-between font-normal">
          <span className={selected ? '' : 'text-muted-foreground'}>{selected ? selected.label : (placeholder ?? 'Επίλεξε…')}</span>
          <FiChevronDown className="ml-2 size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Αναζήτηση…" className="mb-1 h-8" />
        <div className="max-h-56 overflow-auto">
          {filtered.map((i) => (
            <button key={i.value} type="button"
              onClick={() => { onSelect(i.value); setOpen(false); setQuery(''); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-sm hover:bg-muted">
              <FiCheck className={`size-4 ${i.value === value ? 'opacity-100' : 'opacity-0'}`} />
              {i.label}
            </button>
          ))}
          {filtered.length === 0 && !q && <p className="px-2 py-1.5 text-xs text-muted-foreground">Καμία επιλογή.</p>}
          {allowCreate && onCreate && q && !exact && (
            <button type="button"
              onClick={async () => { await onCreate(query.trim()); setOpen(false); setQuery(''); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body-sm text-primary hover:bg-muted">
              <FiPlus className="size-4" /> Δημιουργία «{query.trim()}»
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
