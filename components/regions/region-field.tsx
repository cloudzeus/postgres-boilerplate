'use client';

import * as React from 'react';
import { FiMapPin, FiSearch, FiX } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { RegionPicker } from '@/components/regions/region-picker';

type Breadcrumb = {
  region: { code: string; nameEL: string } | null;
  regionalUnit: { code: string; nameEL: string } | null;
  municipality: { code: string; nameEL: string } | null;
};

export type RegionFieldValue = { regionCode: string | null; breadcrumb: Breadcrumb | null };

export function RegionField({
  value,
  address,
  onChange,
}: {
  value: RegionFieldValue;
  address: {
    address?: string | null;
    city?: string | null;
    district?: string | null;
    zip?: string | null;
    country?: string | null;
    municipalityId?: string | null;
    prefectureId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  onChange: (v: RegionFieldValue) => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const detect = async () => {
    setDetecting(true); setMsg(null);
    try {
      const res = await fetch('/api/regions/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(address),
      });
      if (!res.ok) { setMsg('Δεν βρέθηκε αντιστοίχιση — επιλέξτε χειροκίνητα'); return; }
      const data = await res.json();
      onChange({ regionCode: data.regionCode, breadcrumb: data.breadcrumb });
      setMsg(
        data.confidence === 'name' ? 'Εντοπίστηκε από όνομα' :
        data.confidence === 'gemi' ? 'Εντοπίστηκε από ΓΕΜΗ' :
        'Εντοπίστηκε από συντεταγμένες'
      );
    } finally { setDetecting(false); }
  };

  const pickManually = async (code: string) => {
    const res = await fetch('/api/regions/decode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const data = await res.json();
    onChange({ regionCode: code, breadcrumb: data.breadcrumb ?? null });
  };

  const b = value.breadcrumb;
  const chain = b ? [b.region?.nameEL, b.regionalUnit?.nameEL, b.municipality?.nameEL].filter(Boolean) : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-h-9 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
          {chain.length ? chain.join(' › ') : <span className="text-muted-foreground">— καμία αντιστοίχιση —</span>}
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={detect} disabled={detecting}>
          <FiMapPin className="w-4 h-4" /> {detecting ? 'Εντοπισμός…' : 'Εντοπισμός'}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPickerOpen(true)}>
          <FiSearch className="w-4 h-4" /> Επιλογή
        </Button>
        {value.regionCode && (
          <Button type="button" variant="ghost" size="sm" aria-label="clear"
                  onClick={() => onChange({ regionCode: null, breadcrumb: null })}>
            <FiX className="w-4 h-4" />
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <RegionPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(code) => pickManually(code)} />
    </div>
  );
}
