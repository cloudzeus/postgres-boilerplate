'use client';

import * as React from 'react';
import { FiCheck, FiX, FiChevronRight, FiSearch } from 'react-icons/fi';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type DecodedKad = {
  code: string;
  codeWithoutDots: string | null;
  title: string;
  level: number | null;
  sector: string | null;
  path: string | null;
  hierarchy: Array<{ code: string; title: string; level: number | null; sector: string | null }>;
  children: Array<{ code: string; title: string; level: number | null }>;
};

const levelLabels: Record<number, string> = {
  1: 'Τομέας',
  2: 'Κλάδος',
  3: 'Ομάδα',
  4: 'Τάξη NACE',
  5: 'Κατηγορία CPA',
  6: 'Υποκατηγορία CPA',
  7: 'Εθνική δραστηριότητα',
};

export function KadDecoder() {
  const [input, setInput] = React.useState('');
  const [result, setResult] = React.useState<DecodedKad | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const decode = React.useCallback(async () => {
    if (!input.trim()) { setError('Παρακαλώ εισάγετε έναν ΚΑΔ κωδικό'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/kad/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Σφάλμα'); setResult(null); return; }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Άγνωστο σφάλμα'); setResult(null);
    } finally { setLoading(false); }
  }, [input]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex gap-2">
          <Input
            placeholder="π.χ. 43210000 ή 43.21.00"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') decode(); }}
            disabled={loading}
            className="font-mono"
          />
          <Button onClick={decode} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FiSearch />}
            Αναζήτηση
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
          <div className="flex items-start justify-between border-b pb-3">
            <div>
              <div className="flex items-center gap-2">
                <FiCheck className="text-emerald-600" />
                <span className="text-xl font-bold font-mono">{result.code}</span>
                {result.codeWithoutDots && (
                  <Badge variant="outline" className="font-mono">{result.codeWithoutDots}</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{result.title}</p>
            </div>
            {result.sector && (
              <Badge className="bg-blue-100 text-blue-900 border-blue-200">Τομέας {result.sector}</Badge>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-2">Πλήρης ιεραρχία</h3>
            <ol className="space-y-1">
              {result.hierarchy.map((it) => (
                <li key={it.code} className="flex items-start gap-2 text-sm">
                  <span className="font-mono text-xs w-24 text-muted-foreground">{it.code}</span>
                  <FiChevronRight className="mt-1 text-muted-foreground" />
                  <span className="flex-1">
                    <span className="text-xs text-muted-foreground mr-2">
                      {it.level ? levelLabels[it.level] : ''}
                    </span>
                    {it.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {result.children.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm mb-2">Παιδιά ({result.children.length})</h3>
              <ul className="space-y-1 max-h-60 overflow-auto">
                {result.children.map((c) => (
                  <li key={c.code} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs w-24 text-muted-foreground">{c.code}</span>
                    <span>{c.title}</span>
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
