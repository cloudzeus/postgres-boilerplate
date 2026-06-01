'use client';

import * as React from 'react';
import { FiLink, FiCheck, FiX } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SoftoneMatchPicker } from '@/components/admin/softone-match-picker';

type Match = { mtrl: number; code: string; code1?: string | null; code2?: string | null; name: string; isService: boolean };
type Line = {
  id: string;
  rowIndex: number;
  lineCode: string | null;
  lineName: string;
  match: Match | null;
  matchedBy: 'code2' | 'code1' | 'code' | null;
};
type Result = {
  invoiceType: 'service' | 'product' | 'mixed' | 'unknown';
  reason: string;
  totalLines: number;
  matchedCount: number;
  lines: Line[];
};

const TYPE_LABEL: Record<string, string> = {
  service: 'Τιμολόγιο Υπηρεσιών', product: 'Τιμολόγιο Προϊόντων', mixed: 'Μικτό', unknown: 'Άγνωστο',
};
const TYPE_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  service: { bg: '#FFF1E6', fg: '#C2410C', bd: '#FFD8B5' },
  product: { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  mixed:   { bg: '#EAF2FF', fg: '#1D4ED8', bd: '#BFD7FF' },
  unknown: { bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' },
};
const MATCHED_BY_LABEL: Record<string, string> = {
  code2: 'Εργοστασίου', code1: 'EAN', code: 'Κωδικός',
};

export function OcrSoftoneCorrelation({ docId }: { docId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  // Manual matches applied inline (lineId → match), overrides the auto result.
  const [overrides, setOverrides] = React.useState<Record<string, Line['match']>>({});

  const pickItem = async (line: Line, picked: { id: number; code: string; name: string; isService?: boolean }) => {
    setOverrides((o) => ({ ...o, [line.id]: { mtrl: picked.id, code: picked.code, name: picked.name, isService: !!picked.isService } }));
    const res = await fetch('/api/admin/ocr/match-line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId: line.id, mtrl: picked.id }),
    });
    if (res.ok) toast.success(`Αντιστοιχίστηκε: ${picked.name}`);
    else { toast.error('Αποτυχία'); setOverrides((o) => { const n = { ...o }; delete n[line.id]; return n; }); }
  };

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/correlate`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? d?.error ?? 'σφάλμα');
      setResult(d);
    } catch (e) {
      toast.error(`Αποτυχία συσχέτισης: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const ts = result ? (TYPE_STYLE[result.invoiceType] ?? TYPE_STYLE.unknown) : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Συσχέτιση με SoftOne</p>
          <p className="text-[11px] text-muted-foreground">Ταυτοποίηση γραμμών με είδη/υπηρεσίες (CODE / εργοστασίου / EAN) + τύπος τιμολογίου (DeepSeek).</p>
        </div>
        <Button variant="secondary" size="sm" onClick={run} disabled={busy}>
          <FiLink className="mr-1.5 h-3.5 w-3.5" /> {busy ? 'Ανάλυση…' : 'Συσχέτιση'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: ts!.bg, color: ts!.fg, borderColor: ts!.bd }}>
              {TYPE_LABEL[result.invoiceType]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              Ταυτοποιήθηκαν {result.matchedCount}/{result.totalLines} γραμμές
            </span>
            {result.reason && <span className="text-[11px] text-muted-foreground italic">— {result.reason}</span>}
          </div>

          <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-semibold">Κωδ. γραμμής</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">Περιγραφή</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">SoftOne</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">Match</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.rowIndex} className="border-t border-border/60">
                    <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{l.lineCode || '—'}</td>
                    <td className="px-2.5 py-1.5 align-top">{l.lineName}</td>
                    <td className="px-2.5 py-1.5 align-top">
                      {(() => {
                        const m = overrides[l.id] ?? l.match;
                        if (!m) return <span className="text-muted-foreground/60">—</span>;
                        return (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                                  <span className="font-mono text-[11px] text-muted-foreground">{m.code}</span>{' '}
                                  <span className="text-foreground">{m.name}</span>{' '}
                                  <span className="text-[10px] text-muted-foreground">({m.isService ? 'υπηρεσία' : 'είδος'})</span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" className="max-w-xs">
                                <MtrlTooltip m={m} />
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
                    </td>
                    <td className="px-2.5 py-1.5 align-top whitespace-nowrap text-right">
                      {overrides[l.id] ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700" style={{ color: '#047857' }}>
                          <FiCheck className="h-3 w-3" /> χειροκίνητα
                        </span>
                      ) : l.match ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700" style={{ color: '#047857' }}>
                          <FiCheck className="h-3 w-3" /> {MATCHED_BY_LABEL[l.matchedBy ?? 'code']}
                        </span>
                      ) : (
                        // Inline search — products + services, by name/code/code1/code2.
                        <SoftoneMatchPicker type="items" triggerLabel="Ψάξε & σύνδεσε" onPick={(p) => pickItem(l, p)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tooltip body for a matched SoftOne MTRL item. Field names shown to avoid CODE1/CODE2 ambiguity. */
function MtrlTooltip({ m }: { m: Match }) {
  const rows: Array<[string, string | null | undefined]> = [
    ['Κωδικός (CODE)', m.code],
    ['EAN (CODE1)', m.code1],
    ['Κατασκευαστή (CODE2)', m.code2],
  ];
  return (
    <div className="space-y-1">
      <p className="font-semibold leading-tight">{m.name}</p>
      <p className="text-[10px] opacity-70">MTRL {m.mtrl} · {m.isService ? 'Υπηρεσία' : 'Είδος'}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        {rows.map(([label, val]) => (
          <React.Fragment key={label}>
            <dt className="opacity-70">{label}</dt>
            <dd className="font-mono">{val && String(val).trim() ? val : '—'}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}
