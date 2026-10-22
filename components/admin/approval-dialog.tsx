'use client';

// «Εγκρίσεις»: ποιες χρειάζονται και γιατί (όριο ποσού / παρατηρήσεις), ποιες δόθηκαν, και — για όποιον
// έχει τον ρόλο — Έγκριση / Απόρριψη με σχόλιο. Η έγκριση ισχύει για ΑΥΤΑ τα ποσά: αν αλλάξουν, ζητείται ξανά.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiCheckCircle, FiLoader, FiShield, FiXCircle } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RowHint } from '@/components/admin/form-kit';
import { emitDocLinesChanged } from '@/components/admin/doc-lines-events';
import { cn } from '@/lib/utils';

interface Rec { id: string; level: number; decision: string; userEmail: string | null; comment: string | null; createdAt: string; current: boolean }
interface Data {
  enabled: boolean;
  status: { required: number[]; reason: string | null; approved: number[]; missing: number[]; rejected: Rec | null; satisfied: boolean };
  config: { level1Amount: number; level1Roles: string[]; level2Amount: number; level2Roles: string[]; whenWarnings: boolean };
  canApprove: number[];
  records: Rec[];
}
const eur = (v: number) => `${v.toLocaleString('el-GR')} €`;

export function ApprovalDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/approval`, { cache: 'no-store' });
      const j = await r.json(); if (!r.ok) throw new Error(j?.message ?? `HTTP ${r.status}`);
      setD(j); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [docId]);
  React.useEffect(() => { void load(); }, [load]);

  const decide = async (level: number, decision: 'APPROVED' | 'REJECTED') => {
    setBusy(`${level}${decision}`); setError(null);
    try {
      const r = await fetch(`/api/admin/ocr/${docId}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, decision, comment: comment.trim() || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
      toast.success(decision === 'APPROVED' ? `Εγκρίθηκε (επίπεδο ${level})` : `Απορρίφθηκε (επίπεδο ${level})`);
      setComment(''); emitDocLinesChanged(docId); router.refresh(); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const levelText = (l: number) => (l === 1 ? 'Επίπεδο 1' : 'Επίπεδο 2 — από άλλον χρήστη');

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[88dvh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600"><FiShield className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Εγκρίσεις καταχώρισης</DialogTitle>
            <DialogDescription className="text-[length:var(--fs-12)]">Η έγκριση ισχύει για αυτά τα ποσά, τον εκδότη και τις γραμμές — αν αλλάξουν, ζητείται ξανά.</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-2.5">
          {!d && !error && <div className="h-24 animate-pulse rounded bg-muted motion-reduce:animate-none" role="status"><span className="sr-only">Φόρτωση…</span></div>}
          {d && !d.enabled && <RowHint>Οι εγκρίσεις δεν είναι ενεργές (Ρυθμίσεις → Αρχικοποίηση εφαρμογής → «Εγκρίσεις καταχώρισης»).</RowHint>}
          {d && d.enabled && d.status.required.length === 0 && (
            <p className="flex items-center gap-1.5 text-[length:var(--fs-12)] text-emerald-700"><FiCheckCircle aria-hidden className="size-4" /> Δεν χρειάζεται έγκριση για αυτό το παραστατικό (κάτω από {eur(d.config.level1Amount)}).</p>
          )}
          {d && d.status.required.length > 0 && (
            <>
              <p className="text-[length:var(--fs-12)] text-foreground">Χρειάζεται: <strong>{d.status.required.map(levelText).join(' + ')}</strong> — {d.status.reason}.</p>
              <ul className="space-y-1">
                {d.status.required.map((l) => {
                  const ok = d.status.approved.includes(l);
                  const rec = d.records.find((r) => r.current && r.level === l);
                  return (
                    <li key={l} className={cn('flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[length:var(--fs-12)]', ok ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-card')}>
                      <span className="min-w-0">
                        <span className="block font-semibold">{levelText(l)}</span>
                        <span className="text-muted-foreground">Εγκρίνουν: {(l === 1 ? d.config.level1Roles : d.config.level2Roles).concat('SUPER_ADMIN').filter((x, i, a) => a.indexOf(x) === i).join(', ')}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        {ok ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><FiCheckCircle aria-hidden className="size-4" /> {rec?.userEmail ?? 'Εγκρίθηκε'}</span>
                          : rec?.decision === 'REJECTED' ? <span className="inline-flex items-center gap-1 font-semibold text-destructive"><FiXCircle aria-hidden className="size-4" /> Απορρίφθηκε</span>
                            : <span className="text-amber-800">Εκκρεμεί</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {d.status.rejected && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-12)] text-destructive">Απορρίφθηκε από {d.status.rejected.userEmail ?? '—'}: «{d.status.rejected.comment}»</p>}
              {d.canApprove.length > 0 && !d.status.satisfied && (
                <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <label htmlFor="ap-comment" className="text-[length:var(--fs-12)] font-semibold">Σχόλιο <span className="font-normal text-muted-foreground">(υποχρεωτικό για απόρριψη)</span></label>
                  <textarea id="ap-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-[length:var(--fs-13)] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <div className="flex flex-wrap gap-1.5">
                    {d.canApprove.filter((l) => !d.status.approved.includes(l)).map((l) => (
                      <React.Fragment key={l}>
                        <Button type="button" size="sm" onClick={() => void decide(l, 'APPROVED')} disabled={busy != null} className="bg-emerald-600 text-white hover:bg-emerald-700">
                          {busy === `${l}APPROVED` ? <FiLoader aria-hidden className="mr-1 size-3.5 animate-spin" /> : <FiCheckCircle aria-hidden className="mr-1 size-3.5" />} Έγκριση επιπέδου {l}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void decide(l, 'REJECTED')} disabled={busy != null || !comment.trim()} title={comment.trim() ? undefined : 'Γράψε πρώτα σχόλιο'}>
                          <FiXCircle aria-hidden className="mr-1 size-3.5" /> Απόρριψη
                        </Button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              {d.canApprove.length === 0 && !d.status.satisfied && <RowHint>Ο ρόλος σου δεν εγκρίνει αυτό το επίπεδο — ζήτησε έγκριση από κάποιον με ρόλο της λίστας.</RowHint>}
            </>
          )}
          {d && d.records.length > 0 && (
            <details className="text-[length:var(--fs-12)]">
              <summary className="cursor-pointer font-semibold text-sisyphus-700">Ιστορικό εγκρίσεων ({d.records.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {d.records.map((r) => (
                  <li key={r.id} className={cn('border-t border-border/50 pt-0.5', !r.current && 'text-muted-foreground line-through')}>
                    {new Date(r.createdAt).toLocaleString('el-GR')} · επίπεδο {r.level} · {r.decision === 'APPROVED' ? 'έγκριση' : 'απόρριψη'} · {r.userEmail ?? '—'}{r.comment ? ` — «${r.comment}»` : ''}{!r.current ? ' (για παλιά εκδοχή του παραστατικού)' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {error && <p role="alert" className="text-[length:var(--fs-12)] text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="m-0 border-t border-border bg-card px-4 py-2.5"><Button type="button" variant="outline" onClick={onClose} disabled={busy != null}>Κλείσιμο</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
