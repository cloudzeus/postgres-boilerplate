'use client';

// components/templates/test-json-dialog.tsx — the «Δοκιμή προτύπου» result: the output JSON of
// spec §14.1(5), one coloured chip per field, copy and download.
import * as React from 'react';
import { FiCopy, FiDownload } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { TestTemplateResult } from './api';

export function TestJsonDialog({ open, onOpenChange, result, slug }: { open: boolean; onOpenChange: (o: boolean) => void; result: TestTemplateResult | null; slug: string }) {
  const json = React.useMemo(
    () => (result ? JSON.stringify({ template: result.template, version: result.version, extractedAt: result.extractedAt, values: result.values }, null, 2) : ''),
    [result],
  );

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); toast.success('Αντιγράφηκε'); }
    catch { toast.error('Δεν ήταν δυνατή η αντιγραφή'); }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Δοκιμή προτύπου — JSON</DialogTitle>
          <DialogDescription>
            {result ? `${Object.keys(result.values).length} πεδία · ${result.model ?? '—'} · ${result.tokensUsed} tokens · ${result.durationMs} ms` : 'Ανάγνωση…'}
          </DialogDescription>
        </DialogHeader>
        {result && (
          <>
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(result.fields).map(([k, v]) => (
                <li key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: v.color, color: v.color }}>
                  <span className="font-mono">{k}</span>
                  <span className="truncate text-foreground">{v.value == null ? '∅' : typeof v.value === 'object' ? `${(v.value as unknown[]).length} γραμμές` : String(v.value)}</span>
                </li>
              ))}
            </ul>
            {result.errors.length > 0 && <p className="text-[11px] text-dg-red-600">{result.errors.map((e) => `${e.fieldKey}: ${e.message}`).join(' · ')}</p>}
            <pre className="max-h-[50vh] overflow-auto rounded-md border border-border bg-neutral-4 p-3 font-mono text-[11px] leading-relaxed">{json}</pre>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={copy}><FiCopy className="mr-1 size-3.5" /> Αντιγραφή</Button>
              <Button size="sm" onClick={download}><FiDownload className="mr-1 size-3.5" /> Λήψη .json</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
