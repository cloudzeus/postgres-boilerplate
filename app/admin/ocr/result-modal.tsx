'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiX, FiSend, FiSave, FiExternalLink, FiCheck, FiAlertCircle,
  FiFileText, FiCode, FiTag, FiUserPlus, FiZap, FiRefreshCw,
} from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface ResultModalProps {
  open: boolean;
  documentId: string | null;
  onClose: () => void;
}

interface OcrDoc {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  docType: 'INVOICE' | 'RECEIPT' | 'GENERAL_TEXT';
  language: string;
  status: string;
  pdfSource: string | null;
  category: string | null;
  postStatus: string;
  postedRef: string | null;
  durationMs: number | null;
  model: string | null;
  thumbUrl: string | null;
  extractedData: any;
  items: any[];
}

interface FieldSpec { key: string; label: string; required: boolean; format?: (v: any) => string }

const SCHEMA: Record<string, FieldSpec[]> = {
  INVOICE: [
    { key: 'companyName',        label: 'Εκδότης',                required: true },
    { key: 'vatNumber',          label: 'ΑΦΜ Εκδότη',            required: true },
    { key: 'companyAddress',     label: 'Διεύθυνση Εκδότη',       required: false },
    { key: 'companyDoy',         label: 'ΔΟΥ Εκδότη',             required: false },
    { key: 'companyProfession',  label: 'Επάγγελμα Εκδότη',       required: false },
    { key: 'companyPhone',       label: 'Τηλέφωνο Εκδότη',        required: false },
    { key: 'companyEmail',       label: 'Email Εκδότη',           required: false },
    { key: 'customerName',       label: 'Πελάτης',                required: true },
    { key: 'customerVatNumber',  label: 'ΑΦΜ Πελάτη',             required: true },
    { key: 'customerAddress',    label: 'Διεύθυνση Πελάτη',       required: false },
    { key: 'customerDoy',        label: 'ΔΟΥ Πελάτη',             required: false },
    { key: 'customerProfession', label: 'Επάγγελμα Πελάτη',       required: false },
    { key: 'invoiceNumber',      label: 'Αριθμός Παραστατικού',   required: true },
    { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',              required: false },
    { key: 'date',               label: 'Ημερομηνία',             required: true },
    { key: 'subtotal',           label: 'Καθαρή αξία',            required: true, format: fmtMoney },
    { key: 'vatAmount',          label: 'ΦΠΑ',                    required: true, format: fmtMoney },
    { key: 'totalAmount',        label: 'Γενικό Σύνολο',          required: true, format: fmtMoney },
  ],
  RECEIPT: [
    { key: 'companyName',   label: 'Κατάστημα / Εκδότης',    required: true, format: (v: any) => v },
    { key: 'vatNumber',     label: 'ΑΦΜ εκδότη',             required: true },
    { key: 'invoiceNumber', label: 'Αρ. Αποδείξεως',         required: true },
    { key: 'date',          label: 'Ημερομηνία',             required: true },
    { key: 'time',          label: 'Ώρα',                    required: false },
    { key: 'companyPhone',  label: 'Τηλέφωνο',               required: false },
    { key: 'companyEmail',  label: 'Email',                  required: false },
    { key: 'itemsCount',    label: 'Πλήθος ειδών',           required: false },
    { key: 'subtotal',      label: 'Καθαρή αξία',            required: false, format: fmtMoney },
    { key: 'vatAmount',     label: 'ΦΠΑ',                    required: false, format: fmtMoney },
    { key: 'totalAmount',   label: 'Σύνολο',                 required: true, format: fmtMoney },
  ],
  GENERAL_TEXT: [
    { key: 'title',    label: 'Τίτλος',   required: true },
    { key: 'summary',  label: 'Περίληψη', required: true },
    { key: 'keywords', label: 'Keywords', required: false, format: (v) => Array.isArray(v) ? v.join(', ') : '-' },
  ],
};

function fmtMoney(v: any) {
  if (v == null) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}

const CATEGORY_OPTIONS = [
  { value: 'EXPENSE',     label: 'Έξοδο' },
  { value: 'INVOICE_IN',  label: 'Τιμολόγιο αγοράς' },
  { value: 'INVOICE_OUT', label: 'Τιμολόγιο πώλησης' },
  { value: 'RECEIPT',     label: 'Απόδειξη' },
  { value: 'CREDIT_NOTE', label: 'Πιστωτικό' },
  { value: 'PAYROLL',     label: 'Μισθοδοσία' },
  { value: 'TAX',         label: 'Φόρος' },
  { value: 'OTHER',       label: 'Άλλο' },
];

const DOC_LABEL: Record<string, string> = {
  INVOICE: 'Τιμολόγιο', RECEIPT: 'Απόδειξη', GENERAL_TEXT: 'Κείμενο',
};

export function OcrResultModal({ open, documentId, onClose }: ResultModalProps) {
  const router = useRouter();
  const [doc, setDoc] = React.useState<OcrDoc | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [category, setCategory] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [supplying, setSupplying] = React.useState(false);
  const [reextracting, setReextracting] = React.useState(false);

  React.useEffect(() => {
    if (!open || !documentId) { setDoc(null); return; }
    setLoading(true);
    fetch(`/api/admin/ocr/${documentId}`)
      .then((r) => r.json())
      .then((d) => { setDoc(d); setCategory(d?.category ?? ''); setNotes(''); })
      .catch(() => toast.error('Αποτυχία φόρτωσης'))
      .finally(() => setLoading(false));
  }, [open, documentId]);

  // Esc to close
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const data = doc?.extractedData ?? {};
  const spec = doc ? (SCHEMA[doc.docType] ?? []) : [];
  const fields = spec.map((s) => {
    const raw = (data as any)[s.key];
    const present = raw != null && raw !== '' && !(Array.isArray(raw) && raw.length === 0);
    return {
      ...s,
      value: present ? (s.format ? s.format(raw) : String(raw)) : null,
      present,
      missing: s.required && !present,
    };
  });
  const missingCount = fields.filter((f) => f.missing).length;
  const completeness = spec.length ? Math.round(((spec.length - missingCount) / spec.length) * 100) : 100;
  const fileUrl = doc ? `/api/admin/ocr/${doc.id}/file` : '';
  const isPdf = doc?.mimeType === 'application/pdf';

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ocr/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category || null, notes: notes || null }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε');
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setSaving(false); }
  }

  async function post() {
    if (!doc) return;
    if (!category) { toast.error('Όρισε κατηγορία πρώτα.'); return; }
    setPosting(true);
    try {
      await fetch(`/api/admin/ocr/${doc.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      const res = await fetch(`/api/admin/ocr/${doc.id}/post-softone`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Αναρτήθηκε στο SoftOne · ${json.ref}`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setPosting(false); }
  }

  async function reextract() {
    if (!doc) return;
    if (!confirm('Επανεκτέλεση με ισχυρότερο μοντέλο (gemini-2.5-pro);\nΑυτό είναι λίγο πιο αργό και ακριβό αλλά αποδίδει καλύτερα σε θολά scans.')) return;
    setReextracting(true);
    try {
      const res = await fetch(`/api/admin/ocr/${doc.id}/reextract`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Επιτυχής ανακατασκευή (${json.model})`);
      // Refresh modal data
      const fresh = await fetch(`/api/admin/ocr/${doc.id}`).then((r) => r.json());
      setDoc(fresh);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
    } finally {
      setReextracting(false);
    }
  }

  async function createCompany(role: 'SUPPLIER' | 'CUSTOMER') {
    if (!doc) return;
    setSupplying(true);
    try {
      const res = await fetch(`/api/admin/ocr/${doc.id}/create-supplier?role=${role}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const noun = role === 'CUSTOMER' ? 'πελάτης' : 'προμηθευτής';
      toast.success(json.reused
        ? `Υπήρχε ήδη: ${json.company?.name}`
        : `Δημιουργήθηκε ${noun}: ${json.company?.name}`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Αποτυχία: ${err?.message ?? err}`);
    } finally { setSupplying(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-fade-in backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-card shadow-fluent-16 ring-1 ring-border/60 animate-slide-up"
      >
        {/* HEADER — hero band */}
        <header className="relative shrink-0 border-b border-border bg-gradient-to-br from-sisyphus-50 via-card to-card px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
              <FiZap className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-title-3 font-semibold tracking-tight text-foreground">
                  {doc?.fileName ?? 'Επεξεργασία…'}
                </h2>
                {doc && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    <FiCheck className="size-3" /> Έτοιμο
                  </span>
                )}
              </div>
              {doc && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  <span>{DOC_LABEL[doc.docType] ?? doc.docType}</span>
                  <span className="text-border">·</span>
                  <span>{doc.language.toUpperCase()}</span>
                  {doc.pdfSource && (<><span className="text-border">·</span><span>{doc.pdfSource === 'DIGITAL' ? 'Digital PDF' : 'Vision'}</span></>)}
                  {doc.model && (<><span className="text-border">·</span><span className="font-mono">{doc.model}</span></>)}
                  {/* Auto-retry indicator: pro models are used by the auto-retry path */}
                  {doc.model?.includes('pro') && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      HQ retry
                    </span>
                  )}
                  {doc.durationMs != null && (<><span className="text-border">·</span><span>{(doc.durationMs / 1000).toFixed(1)}s</span></>)}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-neutral-8 hover:text-foreground"
              aria-label="Κλείσιμο"
            >
              <FiX className="size-4" />
            </button>
          </div>

          {/* Completeness bar */}
          {doc && (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-8">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-standard',
                    completeness === 100 ? 'bg-emerald-500' : completeness >= 60 ? 'bg-sisyphus-500' : 'bg-amber-500',
                  )}
                  style={{ width: `${completeness}%` }}
                />
              </div>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {completeness}% συμπληρωμένο
              </span>
              {missingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  <FiAlertCircle className="size-3" /> {missingCount} λείπουν
                </span>
              )}
            </div>
          )}
        </header>

        {/* BODY — split layout */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[42%_58%]">
          {/* LEFT — Preview */}
          <aside className="relative flex min-h-0 flex-col border-b border-border bg-neutral-6/60 dg-mica lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Πρωτότυπο</span>
              {doc && (
                <a
                  href={fileUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sisyphus-600 hover:underline"
                >
                  <FiExternalLink className="size-3" /> Άνοιγμα
                </a>
              )}
            </div>
            <div className="relative flex-1 overflow-auto p-4">
              {loading ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">Φόρτωση…</div>
              ) : doc && isPdf ? (
                <iframe
                  src={fileUrl}
                  title={doc.fileName}
                  className="size-full min-h-[520px] rounded-md border border-border bg-card shadow-fluent-4"
                />
              ) : doc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fileUrl} alt={doc.fileName}
                  className="mx-auto max-h-[600px] w-auto rounded-md border border-border bg-card shadow-fluent-4 object-contain"
                />
              ) : null}
            </div>
          </aside>

          {/* RIGHT — Tabs */}
          <section className="flex min-h-0 flex-col bg-card">
            <Tabs defaultValue="fields" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="m-3 mb-0 self-start">
                <TabsTrigger value="fields"><FiFileText className="size-3.5" /> Πεδία</TabsTrigger>
                <TabsTrigger value="json"><FiCode className="size-3.5" /> JSON</TabsTrigger>
                <TabsTrigger value="categorize"><FiTag className="size-3.5" /> Κατηγοριοποίηση</TabsTrigger>
              </TabsList>

              {/* FIELDS */}
              <TabsContent value="fields" className="m-3 mt-2 flex-1 overflow-auto">
                <div className="space-y-1.5">
                  {fields.map((f) => (
                    <div
                      key={f.key}
                      className={cn(
                        'grid grid-cols-[140px_1fr] items-start gap-3 rounded-md border px-3 py-2 transition',
                        f.missing
                          ? 'border-amber-500/30 bg-amber-500/5'
                          : f.present
                            ? 'border-border bg-card hover:bg-neutral-6/40'
                            : 'border-border bg-card',
                      )}
                    >
                      <div className="text-[12px] font-medium text-muted-foreground">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-dg-red-500">*</span>}
                      </div>
                      <div className="min-w-0">
                        {f.present ? (
                          <div className="flex items-start gap-1.5">
                            <FiCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                            <span className="break-words font-mono text-[12px] text-foreground">{f.value}</span>
                          </div>
                        ) : f.missing ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium italic text-amber-700 dark:text-amber-400">
                            <FiAlertCircle className="size-3.5" /> λείπει
                          </span>
                        ) : (
                          <span className="text-[12px] italic text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Invoice items table */}
                  {doc?.docType === 'INVOICE' && Array.isArray(doc.items) && doc.items.length > 0 && (
                    <div className="mt-4 overflow-hidden rounded-md border border-border">
                      <div className="border-b border-border bg-neutral-6/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Γραμμές ({doc.items.length})
                      </div>
                      <table className="w-full text-[12px]">
                        <thead className="border-b border-border bg-neutral-4 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5">Κωδ.</th>
                            <th className="px-2 py-1.5">Περιγραφή</th>
                            <th className="px-2 py-1.5 text-right">Ποσ.</th>
                            <th className="px-2 py-1.5 text-right">Τιμή</th>
                            <th className="px-2 py-1.5 text-right">ΦΠΑ %</th>
                            <th className="px-2 py-1.5 text-right">Σύνολο</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {doc.items.map((it: any) => (
                            <tr key={it.id} className="hover:bg-neutral-6/40">
                              <td className="px-2 py-1.5 font-mono text-[11px]">{it.code ?? '-'}</td>
                              <td className="px-2 py-1.5">{it.name}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{it.quantity ?? '-'}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(it.price)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                                {it.vatRate != null ? `${it.vatRate}%` : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtMoney(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Totals footer — only when there are items + at least one money total */}
                      {(data.subtotal != null || data.vatAmount != null || data.totalAmount != null) && (
                        <div className="border-t border-border bg-neutral-6/40 px-3 py-2">
                          <dl className="grid grid-cols-3 gap-2 text-[12px]">
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Καθαρή αξία</dt>
                              <dd className="font-semibold tabular-nums">{fmtMoney(data.subtotal)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">ΦΠΑ</dt>
                              <dd className="font-semibold tabular-nums">{fmtMoney(data.vatAmount)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Γενικό Σύνολο</dt>
                              <dd className="font-bold tabular-nums text-sisyphus-600">{fmtMoney(data.totalAmount)}</dd>
                            </div>
                          </dl>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* JSON */}
              <TabsContent value="json" className="m-3 mt-2 flex-1 overflow-auto">
                <pre className="rounded-md border border-border bg-neutral-4 p-3 text-[11px] font-mono leading-relaxed text-foreground">
{JSON.stringify(data, null, 2)}
                </pre>
              </TabsContent>

              {/* CATEGORIZE */}
              <TabsContent value="categorize" className="m-3 mt-2 flex-1 space-y-3 overflow-auto">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Κατηγορία
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
                  >
                    <option value="">— Επιλογή —</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Σημειώσεις
                  </span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Προαιρετικά σχόλια…"
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
                  />
                </label>

                <div className="rounded-md border border-sisyphus-500/30 bg-sisyphus-500/5 p-3 text-[12px] text-foreground">
                  <p className="font-medium">Quick actions</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Δημιούργησε αυτόματα προμηθευτή από το ΑΦΜ ή κάνε ανάρτηση του παραστατικού στο SoftOne.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {/* FOOTER — actions */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-neutral-6/50 px-6 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reextract}
              disabled={!doc || reextracting}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-[13px] font-medium text-amber-900 dark:text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
              title="Επανεκτέλεση με ισχυρότερο μοντέλο (gemini-2.5-pro) για θολά/δύσκολα scans"
            >
              <FiRefreshCw className={cn('size-4', reextracting && 'animate-spin')} />
              {reextracting ? 'Ανακατασκευή…' : 'Re-OCR (HQ)'}
            </button>
            <button
              type="button"
              onClick={() => createCompany('SUPPLIER')}
              disabled={!doc || supplying || !(data?.vatNumber)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-neutral-8 disabled:opacity-50"
              title="Δημιουργία Προμηθευτή από το ΑΦΜ του Εκδότη"
            >
              <FiUserPlus className="size-4" />
              {supplying ? 'Δημιουργία…' : '+ Προμηθευτής'}
            </button>
            <button
              type="button"
              onClick={() => createCompany('CUSTOMER')}
              disabled={!doc || supplying || !(data?.customerVatNumber)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-neutral-8 disabled:opacity-50"
              title="Δημιουργία Πελάτη από το ΑΦΜ του Παραλήπτη"
            >
              <FiUserPlus className="size-4" />
              {supplying ? 'Δημιουργία…' : '+ Πελάτης'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!doc || saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-neutral-8 disabled:opacity-50"
            >
              <FiSave className="size-4" />
              {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
            </button>
            <button
              type="button"
              onClick={post}
              disabled={!doc || posting || !category || doc?.postStatus === 'POSTED'}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-4 text-[13px] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-50 disabled:hover:bg-sisyphus-500"
            >
              <FiSend className="size-4" />
              {posting ? 'Ανάρτηση…' : doc?.postStatus === 'POSTED' ? 'Αναρτήθηκε' : 'Ανάρτηση στο SoftOne'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
