'use client';

// components/templates/test-json-dialog.tsx — the «Δοκιμή προτύπου» result: the output JSON of
// spec §14.1(5), one coloured chip per field, copy and download.
import * as React from 'react';
import { FiCode, FiCopy, FiDownload, FiList } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSection, RowHint } from '@/components/admin/form-kit';
import type { TestTemplateResult } from './api';

export function TestJsonDialog({ open, onOpenChange, result, slug }: { open: boolean; onOpenChange: (o: boolean) => void; result: TestTemplateResult | null; slug: string }) {
  const json = React.useMemo(
    () => (result ? JSON.stringify({ template: result.template, version: result.version, extractedAt: result.extractedAt, values: result.values }, null, 2) : ''),
    [result],
  );

  // The Clipboard API is missing outside a secure context and can be denied by permissions —
  // fall back to selecting the JSON so the user only has to press Cmd/Ctrl+C.
  const preRef = React.useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(json);
      toast.success('Αντιγράφηκε');
    } catch {
      const el = preRef.current;
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (el && sel) { const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); }
      toast.error('Επίλεξε και αντίγραψε το κείμενο');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    // Firefox ignores a click on an anchor that is not in the document, and revoking the URL
    // in the same tick can beat the download off the line — hand the browser a turn first.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15 [&_svg]:size-4"><FiCode /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Δοκιμή προτύπου — JSON</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)] tabular-nums">
              {result ? `${Object.keys(result.values).length} πεδία · ${result.model ?? '—'} · ${result.tokensUsed} tokens · ${result.durationMs} ms` : 'Ανάγνωση…'}
            </DialogDescription>
          </div>
        </DialogHeader>
        {result && (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-muted/20 px-4 py-3">
              <FormSection tone="emerald" icon={<FiList />} title="Πεδία" aside={<span className="tabular-nums">{Object.keys(result.fields).length}</span>}>
                <ul className="flex flex-wrap gap-1.5">
                  {Object.entries(result.fields).map(([k, v]) => (
                    <li key={k} className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[length:var(--fs-11)]" style={{ borderColor: v.color, color: v.color }}>
                      <span className="font-mono">{k}</span>
                      <span className="truncate text-foreground">{v.value == null ? '∅' : Array.isArray(v.value) ? `${v.value.length} γραμμές` : String(v.value)}</span>
                    </li>
                  ))}
                </ul>
                {result.errors.length > 0 && <RowHint tone="bad">{result.errors.map((e) => `${e.fieldKey}: ${e.message}`).join(' · ')}</RowHint>}
              </FormSection>
              <FormSection tone="slate" icon={<FiCode />} title="JSON εξόδου" aside={<span className="font-mono">{slug}.json</span>}>
                <pre ref={preRef} className="-mx-3 -my-2.5 max-h-[50vh] overflow-auto bg-neutral-4 px-3 py-2.5 font-mono text-[length:var(--fs-11)] leading-relaxed">{json}</pre>
              </FormSection>
            </div>
            <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
              <Button variant="secondary" size="sm" onClick={copy}><FiCopy className="mr-1 size-3.5" /> Αντιγραφή</Button>
              <Button size="sm" onClick={download}><FiDownload className="mr-1 size-3.5" /> Λήψη .json</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
