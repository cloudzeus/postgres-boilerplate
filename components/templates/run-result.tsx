'use client';

// The «Πρότυπο» card on the document page (spec §3γ, §15.5): what a template read out of this
// document, where on the page it read it, what the rules decided, and the ways out (JSON, Excel,
// ανάρτηση). Everything here is about ONE run — the history list swaps which one.

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiChevronDown, FiChevronRight, FiDownload, FiFileText, FiHelpCircle, FiPlay, FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RegionMarker, type SavedRegion } from '@/components/ui/region-marker';
import { defaultTemplateId, editSeed, matchesVat, pageCountOf } from '@/lib/templates/run-view';
import type { FlowRun } from '@/lib/templates/flow';
import type { FieldValue } from '@/lib/templates/schema';
import { templatesApi, errorMessage, type RunDto } from './api';
import { FlowCanvas } from './flow-canvas';
import { RunFieldList } from './run-field-list';
import { RunHeader, runLabel, runWhen } from './run-header';
import { RunStatusPill } from './run-status-pill';
import { TemplatePicker, type TemplateSummary } from './template-picker';
import { useRunRegions } from './use-run-regions';

type Props = {
  docId: string;
  fileName: string;
  issuerVat: string | null;
  initialRuns: RunDto[];
  templates: TemplateSummary[];
  canManage: boolean;
  canPost: boolean;
  postStatus: string;
  /** Wiki page for the `template-runs` help anchor, resolved on the server (null = no access). */
  helpHref?: string | null;
};

const pageOf = (v: FieldValue | undefined): number | null => (v?.bbox ? v.page ?? 0 : null);

function FlagList({ items, color, bg, title }: { items: string[]; color: string; bg: string; title: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border p-2.5 text-[12px]" style={{ borderColor: `${color}40`, backgroundColor: bg, color }}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </div>
  );
}

export function RunResult({ docId, fileName, issuerVat, initialRuns, templates, canManage, canPost, postStatus, helpHref }: Props) {
  const router = useRouter();
  const [runs, setRuns] = React.useState<RunDto[]>(initialRuns);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialRuns[0]?.id ?? null);
  const [templateId, setTemplateId] = React.useState(() => defaultTemplateId(templates, issuerVat, initialRuns[0]?.template.id));
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [flowOpen, setFlowOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // One element per field row, so a click on a flow node can bring its row into view (spec §16.5).
  const rowRefs = React.useRef<Record<string, HTMLLIElement | null>>({});

  const run = React.useMemo(() => runs.find((r) => r.id === selectedId) ?? runs[0] ?? null, [runs, selectedId]);
  const replaceRun = React.useCallback((updated: RunDto) => setRuns((rs) => rs.map((r) => (r.id === updated.id ? updated : r))), []);
  const regionEdit = useRunRegions({ docId, run, onRun: replaceRun });
  const values = React.useMemo(() => run?.values ?? {}, [run]);
  const pageCount = React.useMemo(() => pageCountOf(values), [values]);
  const alreadyRan = templateId !== '' && runs.some((r) => r.template.id === templateId);
  const vatHint = !run && templates.some((t) => matchesVat(t, issuerVat) && t.status === 'ACTIVE');

  /**
   * A deliberate pick — clicking or tabbing to a row, clicking a node in the flow — follows the field
   * to its page, so the coloured box is actually on screen. A HOVER deliberately does not: paging the
   * image out from under the pointer as it slides down the list is unusable.
   */
  const selectField = React.useCallback((key: string | null) => {
    setFocusKey(key);
    const p = key ? pageOf(values[key]) : null;
    if (p != null) setPage(p);
  }, [values]);

  /**
   * A node in the flow diagram is the same field as a row in the list — clicking it follows the
   * field to its page AND scrolls its row into view, because that row is where «Επανάγνωση» lives
   * (spec §16.5). `nearest` keeps the page still when the row is already visible.
   */
  const selectFieldFromFlow = React.useCallback((key: string | null) => {
    selectField(key);
    if (key) rowRefs.current[key]?.scrollIntoView({ block: 'nearest' });
  }, [selectField]);

  // The boxes of THIS page, and the field key behind each one — `onRegionHover` reports an index into
  // this list, and the highlight only travels back to the row if we can name the field again.
  const { regions, regionKeys } = React.useMemo(() => {
    const rs: SavedRegion[] = [];
    const keys: string[] = [];
    for (const [key, v] of Object.entries(values)) {
      // A box the user just moved or resized wins over the one the run was executed with, until
      // «Επανάγνωση» sends it to the server and the run comes back carrying it.
      const adjusted = regionEdit.pending[key];
      const bbox = adjusted?.bbox ?? v?.bbox;
      if (!bbox || (adjusted?.page ?? v?.page ?? 0) !== page) continue;
      keys.push(key);
      rs.push({ bbox, color: v?.color, active: key === focusKey, label: run?.template.fields.find((f) => f.key === key)?.label ?? key });
    }
    return { regions: rs, regionKeys: keys };
  }, [values, regionEdit.pending, page, focusKey, run]);

  const selectedRegion = focusKey ? regionKeys.indexOf(focusKey) : -1;

  const doRun = React.useCallback(async () => {
    setBusy(true);
    try {
      const { run: fresh, outcome } = await templatesApi.runs.run(docId, templateId || undefined);
      if (fresh) {
        setRuns((prev) => [fresh, ...prev.filter((r) => r.id !== fresh.id)]);
        setSelectedId(fresh.id);
        setTemplateId(fresh.template.id);
      }
      setFocusKey(null);
      setPage(0);
      // A FAILED run does not always carry a reason (the database can refuse the run row itself), so
      // the status — not the presence of `error` — decides both the tone and the fallback wording.
      if (outcome.status === 'FAILED') {
        toast.error(outcome.error ?? 'Η εκτέλεση απέτυχε');
      } else {
        toast.success(`Το πρότυπο έτρεξε — ${runLabel(fresh ?? { status: outcome.status, trigger: 'manual', createdAt: new Date() })}`);
      }
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [docId, templateId, router]);

  const doEdit = React.useCallback(async (key: string, value: string) => {
    if (!run) return;
    // Same expression the editor seeded the box with: otherwise a value whose `raw` differs from its
    // coerced form («1.234,50» → 1234.5) looks changed the moment it is opened and saves a no-op.
    if (editSeed(run.values[key]) === value) return;
    try {
      const { run: updated } = await templatesApi.runs.patch(docId, run.id, { [key]: value });
      setRuns((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      toast.success('Η διόρθωση αποθηκεύτηκε.');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [docId, run, router]);

  const doPost = React.useCallback(async () => {
    setPosting(true);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/post-softone`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ref?: string; error?: string; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.message ?? body.error ?? `Σφάλμα (${res.status})`);
      toast.success(`Αναρτήθηκε στο SoftOne${body.ref ? ` — ${body.ref}` : ''}.`);
      // The post moves the run to POSTED server-side; re-read the list so the card stops offering the
      // button it just used instead of waiting for a navigation.
      const fresh = await templatesApi.runs.list(docId).then((r) => r.runs).catch(() => null);
      if (fresh) setRuns(fresh);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPosting(false);
    }
  }, [docId, router]);

  const flowRun = React.useMemo<FlowRun | undefined>(
    () => (run ? { status: run.status, values: run.values, matchedIds: run.matched.map((m) => m.id), mappingName: run.mappingName } : undefined),
    [run],
  );

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="run-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-1.5">
          {run ? <RunHeader run={run} /> : <h2 className="text-sm font-semibold">Πρότυπο</h2>}
          {helpHref && (
            <Link href={helpHref} target="_blank" aria-label="Βοήθεια" title="Βοήθεια: Εκτέλεση προτύπων"
              className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <FiHelpCircle className="size-3.5" />
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <TemplatePicker templates={templates} issuerVat={issuerVat} value={templateId} onChange={setTemplateId} disabled={busy} />}
          {canManage && (
            <Button size="sm" onClick={doRun} disabled={busy}>
              <FiPlay /> {busy ? 'Εκτέλεση…' : alreadyRan ? 'Επανεκτέλεση' : 'Εκτέλεση'}
            </Button>
          )}
          {run && (
            <>
              <a href={templatesApi.runs.outputUrl(docId, run.id, true)} download
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-input bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted">
                <FiFileText className="size-3.5" /> JSON
              </a>
              <a href={`/api/admin/ocr/${docId}/template-excel?runId=${run.id}`}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-input bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted">
                <FiDownload className="size-3.5" /> Excel
              </a>
            </>
          )}
          {/* A BLOCK_POSTING reason stops the button too: the server refuses the post anyway, so offering it
              would only produce an error the user cannot act on from here. */}
          {run?.status === 'REVIEW' && run.flags.blocked.length === 0 && canPost && postStatus !== 'POSTED' && (
            <Button size="sm" variant="secondary" onClick={doPost} disabled={posting}>
              <FiUploadCloud /> {posting ? 'Ανάρτηση…' : 'Έγκριση → ανάρτηση'}
            </Button>
          )}
        </div>
      </div>

      {!run ? (
        <div className="space-y-1 rounded-lg border border-dashed border-border p-4 text-[12px] text-muted-foreground">
          <p>Δεν έχει τρέξει πρότυπο σε αυτό το έγγραφο.</p>
          {vatHint && <p style={{ color: '#047857' }}>Βρέθηκε πρότυπο για το ΑΦΜ εκδότη.</p>}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              {pageCount > 1 && (
                <div className="mb-2 flex items-center gap-2 text-[12px]">
                  <button type="button" aria-label="Προηγούμενη σελίδα" className="cursor-pointer rounded border px-2 py-0.5 disabled:cursor-default disabled:opacity-40"
                    disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>←</button>
                  <span>Σελίδα {page + 1} / {pageCount}</span>
                  <button type="button" aria-label="Επόμενη σελίδα" className="cursor-pointer rounded border px-2 py-0.5 disabled:cursor-default disabled:opacity-40"
                    disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>→</button>
                </div>
              )}
              <div className="overflow-hidden rounded-lg border border-border">
                <RegionMarker
                  pageImageUrl={(p) => `/api/admin/ocr/${docId}/page-image?page=${p}&scale=3`}
                  pageCount={pageCount} page={page} onPageChange={setPage}
                  savedRegions={regions} onRegionHover={(i) => setFocusKey(i == null ? null : regionKeys[i] ?? null)}
                  isMarking={false} onRegionComplete={() => {}} showNav={false}
                  editable={canManage}
                  selectedIndex={selectedRegion >= 0 ? selectedRegion : null}
                  onRegionSelect={(i) => setFocusKey(i == null ? null : regionKeys[i] ?? null)}
                  onRegionChange={(i, bbox) => { const key = regionKeys[i]; if (key) regionEdit.setRegion(key, { page, bbox }); }}
                  pageLabel={`${fileName}, σελίδα ${page + 1}`} className="w-full"
                />
              </div>
              {canManage && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Σύρε ή άλλαξε το μέγεθος μιας περιοχής (βέλη για μικρομετακίνηση, Shift+βέλη για μέγεθος) και μετά «Επανάγνωση» στο πεδίο.
                </p>
              )}
            </div>
            <RunFieldList
              run={run} focusKey={focusKey} onFocus={setFocusKey} onSelect={selectField} editable={canManage} onEdit={doEdit}
              pending={regionEdit.pending} rereading={regionEdit.rereading} savingRegion={regionEdit.saving}
              onReread={regionEdit.reread} onSaveRegion={regionEdit.saveToTemplate} rowRefs={rowRefs}
            />
          </div>

          <FlagList items={run.flags.blocked} color="#B91C1C" bg="#FDE8E8" title="Μπλοκάρισμα ανάρτησης" />
          <FlagList items={run.flags.review.filter((m) => !run.flags.blocked.includes(m))} color="#B45309" bg="#FDF3E3" title="Προς έλεγχο" />

          {run.matched.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              Κανόνες που ίσχυσαν:
              {run.matched.map((m) => <span key={m.id} className="rounded-full border border-border bg-background px-2 py-0.5">{m.name}</span>)}
            </p>
          )}

          <div>
            <button type="button" onClick={() => setFlowOpen((o) => !o)}
              className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
              {flowOpen ? <FiChevronDown className="size-3.5" /> : <FiChevronRight className="size-3.5" />} Ροή
            </button>
            {flowOpen && (
              <div className="mt-2 rounded-lg border border-border" style={{ height: 260 }}>
                <FlowCanvas template={run.template} run={flowRun} orientation="horizontal" focusKey={focusKey} refitOnChange
                  onNodeClick={(n) => selectFieldFromFlow(n.id.startsWith('field:') ? n.id.slice(6) : null)} />
              </div>
            )}
          </div>

          {runs.length > 1 && (
            <div>
              <button type="button" onClick={() => setHistoryOpen((o) => !o)}
                className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                {historyOpen ? <FiChevronDown className="size-3.5" /> : <FiChevronRight className="size-3.5" />} Ιστορικό ({runs.length})
              </button>
              {historyOpen && (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setSelectedId(r.id); setFocusKey(null); setPage(0); }}
                        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/40 ${r.id === run.id ? 'bg-muted/60' : ''}`}>
                        <RunStatusPill status={r.status} />
                        <span className="truncate">{r.template.name}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{runWhen(r)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
