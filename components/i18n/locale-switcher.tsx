'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiGlobe } from 'react-icons/fi';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LOCALES, type LocaleCode } from '@/i18n/locales';
import { LocaleBadge } from './locale-badge';

export function LocaleSwitcher({ currentLocale }: { currentLocale: LocaleCode }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const change = async (code: string) => {
    setPending(true);
    const res = await fetch('/api/me/locale', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: code }),
    });
    setPending(false);
    if (res.ok) { toast.success('Η γλώσσα άλλαξε'); router.refresh(); }
    else toast.error('Αποτυχία αλλαγής γλώσσας');
  };

  return (
    <Select value={currentLocale} onValueChange={change} disabled={pending}>
      <SelectTrigger className="h-7 w-full text-[12px] gap-1.5">
        <FiGlobe className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {LOCALES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            <span className="flex items-center gap-2 w-full">
              <LocaleBadge code={l.code} />
              <span className="flex-1">{l.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
