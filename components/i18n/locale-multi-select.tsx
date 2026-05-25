'use client';

import * as React from 'react';
import { FiChevronDown, FiX } from 'react-icons/fi';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { LOCALES } from '@/i18n/locales';
import { LocaleBadge } from './locale-badge';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function LocaleMultiSelect({ value, onChange, placeholder = 'Επίλεξε γλώσσες', className }: Props) {
  const toggle = (code: string) => {
    const next = value.includes(code) ? value.filter((c) => c !== code) : [...value, code];
    onChange(next);
  };

  const selectedLocales = LOCALES.filter((l) => value.includes(l.code));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex w-full min-h-8 items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 py-1 text-[13px] text-foreground hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors ${className ?? ''}`}
        >
          <div className="flex flex-wrap gap-1 flex-1 min-w-0 py-0.5">
            {selectedLocales.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              selectedLocales.map((l) => (
                <span
                  key={l.code}
                  className="inline-flex items-center gap-1 rounded-md bg-accent text-accent-foreground pl-1 pr-1.5 py-0.5 text-[11px] font-medium"
                >
                  <LocaleBadge code={l.code} className="!bg-card/70" />
                  {l.label}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); toggle(l.code); }}
                    className="inline-flex items-center justify-center hover:bg-foreground/10 rounded-sm ml-0.5"
                    aria-label={`Αφαίρεση ${l.label}`}
                  >
                    <FiX className="h-3 w-3" />
                  </span>
                </span>
              ))
            )}
          </div>
          <FiChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1 w-[var(--radix-popover-trigger-width)] min-w-[260px]" align="start">
        <div className="max-h-64 overflow-y-auto">
          {LOCALES.map((l) => {
            const checked = value.includes(l.code);
            return (
              <label
                key={l.code}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] cursor-pointer hover:bg-muted"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(l.code)} className="size-3.5" />
                <LocaleBadge code={l.code} />
                <span className="flex-1">{l.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
