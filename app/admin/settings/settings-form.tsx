'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiSave, FiEye, FiEyeOff } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LocaleMultiSelect } from '@/components/i18n/locale-multi-select';
import { LocaleBadge } from '@/components/i18n/locale-badge';
import { LOCALES } from '@/i18n/locales';

type ItemType = 'text'|'password'|'url'|'email'|'number'|'boolean'|'textarea'|'locale'|'locales-multi';
type Item = {
  key: string;
  category: string;
  label: string;
  description?: string;
  type: ItemType;
  isSecret: boolean;
  value: unknown;
  hasValue: boolean;
};
type Category = { id: string; label: string };

export function SettingsForm({ items, categories }: { items: Item[]; categories: Category[] }) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, unknown>>(
    Object.fromEntries(items.map((i) => [i.key, i.value])),
  );
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());

  const update = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty((s) => new Set(s).add(key));
  };

  const save = async () => {
    if (dirty.size === 0) { toast.info('Καμία αλλαγή'); return; }
    setSaving(true);
    const updates = Array.from(dirty).map((k) => ({ key: k, value: values[k] }));
    const res = await fetch('/api/admin/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    setSaving(false);
    if (res.ok) { toast.success(`Αποθηκεύτηκαν ${dirty.size} ρυθμίσεις`); setDirty(new Set()); router.refresh(); }
    else toast.error('Αποτυχία αποθήκευσης');
  };

  const renderField = (item: Item) => {
    const isPw = item.isSecret;
    const v = values[item.key];

    // Locale single select
    if (item.type === 'locale') {
      return (
        <Select value={(v as string) || ''} onValueChange={(nv) => update(item.key, nv)}>
          <SelectTrigger id={item.key} className="w-full">
            <SelectValue placeholder="Επίλεξε γλώσσα" />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                <span className="flex items-center gap-2">
                  <LocaleBadge code={l.code} />
                  {l.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Locale multi-select
    if (item.type === 'locales-multi') {
      const arr = Array.isArray(v) ? (v as string[]) : (typeof v === 'string' ? safeParseStringArray(v) : []);
      return <LocaleMultiSelect value={arr} onChange={(next) => update(item.key, next)} />;
    }

    // Boolean
    if (item.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 cursor-pointer py-1">
          <Checkbox
            checked={!!v}
            onCheckedChange={(checked) => update(item.key, !!checked)}
          />
          <span className="text-[13px] text-foreground">Ενεργοποιημένο</span>
        </label>
      );
    }

    // Textarea
    if (item.type === 'textarea') {
      return (
        <textarea
          id={item.key}
          rows={3}
          value={(v as string) ?? ''}
          onChange={(e) => update(item.key, e.target.value)}
          className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      );
    }

    // Text / password / url / email / number — input
    const masked = isPw && typeof v === 'string' && (v as string).startsWith('••••');
    return (
      <div className="relative">
        <Input
          id={item.key}
          type={isPw && !revealed[item.key] ? 'password' : item.type === 'number' ? 'number' : 'text'}
          value={(v as string) ?? ''}
          onChange={(e) => update(item.key, e.target.value)}
          placeholder={masked ? 'Αφήστε ως έχει για να μην αλλάξει' : ''}
          className={isPw ? 'pr-8' : ''}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setRevealed((r) => ({ ...r, [item.key]: !r[item.key] }))}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={revealed[item.key] ? 'Απόκρυψη' : 'Εμφάνιση'}
          >
            {revealed[item.key] ? <FiEyeOff className="h-3.5 w-3.5" /> : <FiEye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20">
      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category === cat.id);
        if (catItems.length === 0) return null;
        // i18n category gets full-width fields (locale picker needs space)
        const isI18n = cat.id === 'i18n';
        return (
          <div key={cat.id} className="bg-card border border-border rounded-xl shadow-card p-5">
            <h3 className="text-[14px] font-semibold mb-4 text-foreground">{cat.label}</h3>
            <div className={isI18n ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
              {catItems.map((item) => (
                <div key={item.key} className="grid gap-1.5">
                  <Label htmlFor={item.key} className="flex items-center gap-2 text-[12px] font-semibold">
                    {item.label}
                    {item.isSecret && item.hasValue && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Αποθ.</span>
                    )}
                  </Label>
                  {item.description && (
                    <p className="text-[11px] text-muted-foreground leading-tight -mt-0.5 mb-1">{item.description}</p>
                  )}
                  {renderField(item)}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button onClick={save} disabled={saving || dirty.size === 0} className="shadow-pop">
          <FiSave /> {saving ? 'Αποθήκευση…' : dirty.size > 0 ? `Αποθήκευση (${dirty.size})` : 'Αποθήκευση'}
        </Button>
      </div>
    </div>
  );
}

function safeParseStringArray(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
