'use client';

import * as React from 'react';
import { FiCheck, FiX, FiChevronRight, FiSearch } from 'react-icons/fi';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Breadcrumb = {
  region: { code: string; nameEL: string } | null;
  regionalUnit: { code: string; nameEL: string } | null;
  municipality: { code: string; nameEL: string } | null;
};
type Decoded = {
  code: string; nameEL: string; level: number;
  breadcrumb: Breadcrumb;
  children: Array<{ code: string; nameEL: string; level: number }>;
};

const levelLabels: Record<number, string> = { 3: 'Περιφέρεια', 4: 'Περιφ. Ενότητα / Νομός', 5: 'Δήμος' };

export function RegionDecoder() {
  const [input, setInput] = React.useState('');
  const [result, setResult] = React.useState<Decoded | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const decode = React.useCallback(async () => {
    if (!input.trim()) { setError('Εισάγετε κωδικό ή όνομα'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/regions/decode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Σφάλμα'); setResult(null); return; }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Άγνωστο σφάλμα'); setResult(null);
    } finally { setLoading(false); }
  }, [input]);

  const chain = result
    ? [result.breadcrumb.region, result.breadcrumb.regionalUnit, result.breadcrumb.municipality].filter(Boolean) as { code: string; nameEL: string }[]
    : [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex gap-2">
          <Input
            placeholder="π.χ. 1110202 ή «ΔΟΞΑΤΟΥ»"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') decode(); }}
            disabled={loading}
          />
          <Button onClick={decode} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FiSearch />} Αναζήτηση
          </Button>
        </div>
        {error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex gap-2">
            <FiX className="mt-0.5" /> {error}
          </div>
        )}
      </Card>

      {result && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <FiCheck className="text-emerald-600" />
            <span className="text-xl font-bold font-mono">{result.code}</span>
            <span className="text-sm text-muted-foreground">{result.nameEL}</span>
            <Badge variant="outline" className="ml-auto">{levelLabels[result.level] ?? `L${result.level}`}</Badge>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">Ιεραρχία Καλλικράτη</h3>
            <ol className="space-y-1">
              {chain.map((it) => (
                <li key={it.code} className="flex items-start gap-2 text-sm">
                  <span className="font-mono text-xs w-24 text-muted-foreground">{it.code}</span>
                  <FiChevronRight className="mt-1 text-muted-foreground" />
                  <span className="flex-1">{it.nameEL}</span>
                </li>
              ))}
            </ol>
          </div>
          {result.children.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm mb-2">Υποδιαιρέσεις ({result.children.length})</h3>
              <ul className="space-y-1 max-h-60 overflow-auto">
                {result.children.map((c) => (
                  <li key={c.code} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs w-24 text-muted-foreground">{c.code}</span>
                    <span>{c.nameEL}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
