'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiEye, FiRefreshCw, FiSearch, FiInbox } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SoftoneResyncPanel } from '@/components/admin/softone-resync';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { syncErrorMessage } from '@/lib/softone-sync/sync-error';

type SyncKind = 'gemi' | 'vat' | 'purdoc' | 'docseries' | 'traders' | 'lookups' | 'expenses';
type Stat = {
  key: string;
  label: string;
  count: number;
  lastUpdated: string | null;
  source: string;
  /** If set, the view button navigates to this admin page instead of opening a modal. */
  viewHref?: string;
  /** If set, the card shows a sync icon button that triggers this kind of refresh. */
  syncKind?: SyncKind;
};

// Registries that expose data through the generic /api/admin/metadata/registry feed
// (i.e. those without a dedicated page → shown in a modal).
// Customers/suppliers have dedicated pages (viewHref), so they are not modal keys.
const MODAL_KEYS = new Set(['legalTypes', 'gemiOffices', 'companyStatuses', 'vatCategories', 'purchaseDocTypes', 'docSeries', 'expenses']);

// Per-source badge colors (inline hex → guaranteed visible in light & dark themes).
const SOURCE_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  'ΓΕΜΗ':                { bg: '#EAF2FF', fg: '#1D4ED8', bd: '#BFD7FF' },
  'SoftOne':             { bg: '#FFF1E6', fg: '#C2410C', bd: '#FFD8B5' },
  'Manual':              { bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' },
  'Auto (από lookups)':  { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  'NF BUSNESS.xlsx':     { bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' },
};
const DEFAULT_STYLE = { bg: '#F3F4F6', fg: '#374151', bd: '#E5E7EB' };

type RegistryData = { title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };

// Adaptive modal width by column count — wider when there's more data to show.
// Static class literals (no dynamic Tailwind) so the JIT keeps them, and they
// override DialogContent's default `sm:max-w-md`.
function modalWidthClass(cols: number): string {
  if (cols >= 5) return 'sm:max-w-6xl';
  if (cols === 4) return 'sm:max-w-4xl';
  return 'sm:max-w-2xl';
}

export function ReferenceDataClient({ stats, canManage }: { stats: Stat[]; canManage: boolean }) {
  const router = useRouter();
  const [syncingKey, setSyncingKey] = React.useState<string | null>(null);
  const [modalKey, setModalKey] = React.useState<string | null>(null);
  const [modalData, setModalData] = React.useState<RegistryData | null>(null);
  const [modalLoading, setModalLoading] = React.useState(false);
  const [modalSearch, setModalSearch] = React.useState('');

  const openModal = async (key: string) => {
    setModalKey(key);
    setModalData(null);
    setModalSearch('');
    setModalLoading(true);
    try {
      const res = await fetch(`/api/admin/metadata/registry?key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error();
      setModalData(await res.json());
    } catch {
      toast.error('Αποτυχία φόρτωσης μητρώου');
      setModalKey(null);
    } finally {
      setModalLoading(false);
    }
  };

  const syncGemi = async () => {
    const res = await fetch('/api/admin/metadata/refresh-gemi', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      const total = Object.values(d.summary as Record<string, number>).reduce((a, b) => a + b, 0);
      toast.success(`Ανανεώθηκαν ${total} εγγραφές από ΓΕΜΗ`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'gemi_error' ? `Σφάλμα ΓΕΜΗ: ${e.message ?? e.status}` : 'Αποτυχία ανανέωσης');
    }
  };

  const syncVat = async () => {
    const res = await fetch('/api/admin/metadata/sync-vat-softone', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      const extra = [
        d.removed ? `${d.removed} διαγραφές` : '',
        d.disabled ? `${d.disabled} απενεργοποιήσεις` : '',
      ].filter(Boolean).join(', ');
      toast.success(
        `Ενεργές κατηγορίες ΦΠΑ: ${d.total} (νέες ${d.created}, ενημερώσεις ${d.updated})` +
        (extra ? ` · ${extra}` : ''),
      );
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού ΦΠΑ'));
    }
  };

  const syncPurdoc = async () => {
    const res = await fetch('/api/admin/metadata/sync-purdoc-softone', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      const extra = d.removed ? ` · ${d.removed} διαγραφές` : '';
      toast.success(`Τύποι παραστατικών αγορών: ${d.total} (νέες ${d.created}, ενημερώσεις ${d.updated})${extra}`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού'));
    }
  };

  const syncDocSeries = async () => {
    const res = await fetch('/api/admin/metadata/sync-docseries-softone', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      const extra = d.removed ? ` · ${d.removed} διαγραφές` : '';
      const fams = Array.isArray(d.families) && d.families.length ? ` · ενότητες: ${d.families.join(', ')}` : '';
      toast.success(`Σειρές παραστατικών: ${d.total} (νέες ${d.created}, ενημερώσεις ${d.updated})${extra}${fams}`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού σειρών'));
    }
  };

  const syncTraders = async () => {
    const res = await fetch('/api/admin/metadata/sync-traders-softone', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συναλλασσόμενοι: ${d.total.toLocaleString('el-GR')} συγχρονίστηκαν`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού'));
    }
  };

  const syncLookups = async () => {
    const res = await fetch('/api/admin/metadata/sync-lookups-softone', { method: 'POST' });
    if (res.ok) { const d = await res.json(); toast.success(`Βοηθητικοί πίνακες: ${d.total.toLocaleString('el-GR')} εγγραφές`); router.refresh(); }
    else { const e = await res.json().catch(() => ({})); toast.error(syncErrorMessage(e, 'Αποτυχία')); }
  };

  const syncExpenses = async () => {
    const res = await fetch('/api/admin/metadata/sync-expenses-softone', { method: 'POST' });
    if (res.ok) {
      const d = await res.json();
      const extra = d.deactivated ? ` · ${d.deactivated} απενεργοποιήσεις` : '';
      toast.success(`Έξοδα: ${d.total.toLocaleString('el-GR')} (νέα ${d.created}, ενημερώσεις ${d.updated})${extra}`);
      router.refresh();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(syncErrorMessage(e, 'Αποτυχία συγχρονισμού εξόδων'));
    }
  };

  const runSync = async (stat: Stat) => {
    if (!stat.syncKind) return;
    setSyncingKey(stat.key);
    try {
      if (stat.syncKind === 'vat') await syncVat();
      else if (stat.syncKind === 'purdoc') await syncPurdoc();
      else if (stat.syncKind === 'docseries') await syncDocSeries();
      else if (stat.syncKind === 'lookups') await syncLookups();
      else if (stat.syncKind === 'traders') await syncTraders();
      else if (stat.syncKind === 'expenses') await syncExpenses();
      else await syncGemi();
    } finally {
      setSyncingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="rounded-md border border-border bg-background p-3">
          <SoftoneResyncPanel
            title="Συγχρονισμός όλων των βοηθητικών πινάκων"
            description={
              'Τρέχει με τη σειρά και τους επτά συγχρονισμούς SoftOne: κατηγορίες ΦΠΑ, βοηθητικοί πίνακες, '
              + 'έξοδα, είδη & υπηρεσίες, συναλλασσόμενοι, τύποι παραστατικών αγορών, σειρές παραστατικών. '
              + 'Αν κάποιος αποτύχει, οι υπόλοιποι συνεχίζουν. Ασφαλές να ξανατρέξει.'
            }
          />
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((s) => {
          const st = SOURCE_STYLE[s.source] ?? DEFAULT_STYLE;
          const hasModal = MODAL_KEYS.has(s.key);
          const hasView = !!s.viewHref || hasModal;
          const canSync = canManage && !!s.syncKind;
          const isSyncing = syncingKey === s.key;
          return (
            <div key={s.key} className="rounded-md border border-border p-3 bg-background flex flex-col">
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{s.label}</span>
                <span
                  className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ backgroundColor: st.bg, color: st.fg, borderColor: st.bd }}
                >
                  {s.source}
                </span>
              </div>
              <div className="text-[20px] font-semibold text-foreground tabular-nums">{s.count.toLocaleString('el-GR')}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {s.lastUpdated ? `Last update: ${new Date(s.lastUpdated).toLocaleDateString('el-GR')}` : 'No timestamp'}
              </div>

              {(hasView || canSync) && (
                <div className="mt-2 pt-2 border-t border-border flex items-center gap-1">
                  {s.viewHref ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 justify-between px-2 text-[11px]"
                      onClick={() => router.push(s.viewHref!)}
                    >
                      Άνοιγμα σελίδας <FiArrowRight className="h-3 w-3" />
                    </Button>
                  ) : hasModal ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 justify-between px-2 text-[11px]"
                      onClick={() => openModal(s.key)}
                    >
                      Προβολή <FiEye className="h-3 w-3" />
                    </Button>
                  ) : (
                    <span className="flex-1" />
                  )}

                  {canSync && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title={s.syncKind === 'gemi' ? 'Ανανέωση από ΓΕΜΗ Open Data' : 'Συγχρονισμός από SoftOne'}
                      aria-label="Συγχρονισμός"
                      disabled={isSyncing}
                      onClick={() => runSync(s)}
                    >
                      <FiRefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={modalKey != null} onOpenChange={(o) => { if (!o) { setModalKey(null); setModalData(null); setModalSearch(''); } }}>
        <DialogContent
          className={cn(
            'w-[95vw] max-h-[88vh] flex flex-col gap-0 overflow-hidden rounded-xl p-0',
            modalWidthClass(modalData?.columns.length ?? 4),
          )}
        >
          {/* Header */}
          <DialogHeader className="gap-1 border-b border-border px-5 pt-5 pb-4">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-[15px]">{modalData?.title ?? 'Μητρώο αναφοράς'}</DialogTitle>
              {modalData && (
                <span className="rounded-full bg-sisyphus-50 px-2 py-0.5 text-[11px] font-semibold text-sisyphus-700 tabular-nums">
                  {modalData.rows.length.toLocaleString('el-GR')}
                </span>
              )}
            </div>
            <DialogDescription className="text-[12px]">
              {modalLoading ? 'Φόρτωση δεδομένων…' : 'Δεδομένα μητρώου αναφοράς (read-only).'}
            </DialogDescription>

            {modalData && modalData.rows.length > 8 && (
              <div className="relative mt-2 max-w-xs">
                <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder="Αναζήτηση…"
                  className="h-8 pl-8 text-[12px]"
                />
              </div>
            )}
          </DialogHeader>

          {/* Body */}
          {modalLoading && (
            <div className="flex flex-1 items-center justify-center py-16 text-[12px] text-muted-foreground">
              Φόρτωση…
            </div>
          )}

          {modalData && (() => {
            const q = modalSearch.trim().toLowerCase();
            const rows = q
              ? modalData.rows.filter((r) => modalData.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)))
              : modalData.rows;
            return (
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                      {modalData.columns.map((c) => (
                        <th
                          key={c.key}
                          className="border-b border-border px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/60 transition-colors even:bg-muted/20 hover:bg-sisyphus-50/40">
                        {modalData.columns.map((c, ci) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-3 py-2 align-top',
                              ci === 0 && 'font-mono text-[11px] tabular-nums text-muted-foreground',
                            )}
                          >
                            {String(row[c.key] ?? '') || <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={modalData.columns.length} className="px-3 py-12 text-center text-muted-foreground">
                          <FiInbox className="mx-auto mb-2 h-6 w-6 opacity-40" />
                          {q ? 'Κανένα αποτέλεσμα' : 'Κενό μητρώο'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Footer count */}
          {modalData && (
            <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
              {modalData.columns.length} στήλες · {modalData.rows.length.toLocaleString('el-GR')} εγγραφές
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
