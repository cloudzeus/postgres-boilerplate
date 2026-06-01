'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiSave, FiEye, FiEyeOff, FiZap, FiCheckCircle, FiXCircle, FiCopy } from 'react-icons/fi';
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
import { MediaPicker, type PickedMediaFile } from '@/components/media/media-picker';

type ItemType = 'text'|'password'|'url'|'email'|'number'|'boolean'|'textarea'|'locale'|'locales-multi'|'media';
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

// Mirror of lib/softone.ts SoftoneTestResult (server-only module can't be imported here).
type SoftoneTestResult = {
  ok: boolean;
  endpoint: string;
  stage: 'login' | 'authenticate';
  clientID?: string;
  tempClientID?: string;
  authenticated: boolean;
  ver?: string;
  sn?: string;
  companies?: Array<Record<string, unknown>>;
  error?: string;
};

export function SettingsForm({ items, categories }: { items: Item[]; categories: Category[] }) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, unknown>>(
    Object.fromEntries(items.map((i) => [i.key, i.value])),
  );
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [s1Testing, setS1Testing] = React.useState(false);
  const [s1Result, setS1Result] = React.useState<SoftoneTestResult | null>(null);

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

  const testSoftone = async () => {
    if (dirty.size > 0) {
      toast.info('Αποθήκευσε πρώτα τις αλλαγές για να δοκιμάσεις τις τρέχουσες ρυθμίσεις');
      return;
    }
    setS1Testing(true);
    setS1Result(null);
    try {
      const res = await fetch('/api/admin/settings/softone-test', { method: 'POST' });
      const data: SoftoneTestResult = await res.json();
      setS1Result(data);
      if (data.ok) {
        toast.success(data.authenticated ? 'Σύνδεση SoftOne OK — μόνιμο token' : 'Login OK — προσωρινό token');
      } else {
        toast.error(data.error || 'Αποτυχία σύνδεσης SoftOne');
      }
    } catch {
      setS1Result({ ok: false, endpoint: '', stage: 'login', authenticated: false, error: 'Σφάλμα δικτύου' });
      toast.error('Σφάλμα δικτύου');
    } finally {
      setS1Testing(false);
    }
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

    // Media (URL string backed by media gallery picker)
    if (item.type === 'media') {
      const url = (typeof v === 'string' ? v : '') ?? '';
      const picked: PickedMediaFile | null = url
        ? {
            id: url, name: url.split('/').pop() || url, publicUrl: url, originalUrl: null,
            mimeType: 'image/*', width: null, height: null, isImage: true, isSvg: url.endsWith('.svg'), size: 0,
          }
        : null;
      return (
        <div className="grid gap-2">
          <Input
            id={item.key}
            type="text"
            value={url}
            onChange={(e) => update(item.key, e.target.value)}
            placeholder="https://… ή επίλεξε από Media"
          />
          <MediaPicker
            value={picked}
            onChange={(f) => update(item.key, f?.publicUrl ?? '')}
            acceptImagesOnly
            triggerLabel="Επιλογή από Media Gallery"
          />
        </div>
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

            {cat.id === 'integrations' && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">Δοκιμή σύνδεσης SoftOne</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      Εκτελεί login → authenticate με τις αποθηκευμένες ρυθμίσεις και εμφανίζει το token (clientID).
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={testSoftone} disabled={s1Testing}>
                    <FiZap /> {s1Testing ? 'Δοκιμή…' : 'Δοκιμή σύνδεσης'}
                  </Button>
                </div>

                {s1Result && (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-[12px] ${
                      s1Result.ok
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-destructive/30 bg-destructive/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {s1Result.ok ? (
                        <FiCheckCircle className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <FiXCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className={s1Result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>
                        {s1Result.ok
                          ? s1Result.authenticated
                            ? 'Μόνιμο token (authenticate)'
                            : 'Προσωρινό token (login)'
                          : 'Αποτυχία σύνδεσης'}
                      </span>
                    </div>

                    {s1Result.error && <p className="mt-1.5 text-destructive">{s1Result.error}</p>}

                    {s1Result.clientID && (
                      <div className="mt-2">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Token (clientID)
                        </Label>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-[12px] text-foreground">
                            {s1Result.clientID}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(s1Result.clientID!);
                              toast.success('Αντιγράφηκε');
                            }}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Αντιγραφή token"
                          >
                            <FiCopy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {(s1Result.endpoint || s1Result.ver || s1Result.sn) && (
                      <div className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
                        {s1Result.endpoint && <span>Endpoint: {s1Result.endpoint}</span>}
                        {s1Result.ver && <span>Version: {s1Result.ver}</span>}
                        {s1Result.sn && <span>Serial: {s1Result.sn}</span>}
                      </div>
                    )}

                    {!s1Result.authenticated && s1Result.companies && s1Result.companies.length > 0 && (
                      <div className="mt-2">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Διαθέσιμες εταιρίες (συμπλήρωσε Company/Branch/Module/RefID)
                        </Label>
                        <div className="mt-1 max-h-40 overflow-auto rounded border border-border">
                          <table className="w-full text-[11px]">
                            <thead className="bg-muted/50 text-muted-foreground">
                              <tr>
                                <th className="px-2 py-1 text-left font-semibold">Company</th>
                                <th className="px-2 py-1 text-left font-semibold">Branch</th>
                                <th className="px-2 py-1 text-left font-semibold">Module</th>
                                <th className="px-2 py-1 text-left font-semibold">RefID</th>
                                <th className="px-2 py-1 text-left font-semibold">Όνομα</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s1Result.companies.map((c, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="px-2 py-1">{String(c.COMPANY ?? c.company ?? '')}</td>
                                  <td className="px-2 py-1">{String(c.BRANCH ?? c.branch ?? '')}</td>
                                  <td className="px-2 py-1">{String(c.MODULE ?? c.module ?? '')}</td>
                                  <td className="px-2 py-1">{String(c.REFID ?? c.refid ?? '')}</td>
                                  <td className="px-2 py-1">{String(c.COMPANYNAME ?? c.BRANCHNAME ?? c.name ?? '')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
