'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiSend, FiSave, FiExternalLink, FiAlertCircle, FiPlus, FiTrash2, FiRotateCcw, FiCode } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { type OcrRow } from './ocr-table';

/* ------------------------------------------------------------------ */
/* Field specs                                                         */
/* ------------------------------------------------------------------ */

interface FieldSpec { key: string; label: string; required?: boolean; numeric?: boolean; wide?: boolean; textarea?: boolean }

const FIELD_SPECS: Record<string, FieldSpec[]> = {
  INVOICE: [
    { key: 'companyName',        label: 'Εκδότης',           required: true, wide: true },
    { key: 'vatNumber',          label: 'ΑΦΜ Εκδότη',         required: true },
    { key: 'companyDoy',         label: 'ΔΟΥ Εκδότη' },
    { key: 'companyAddress',     label: 'Διεύθυνση Εκδότη',   wide: true },
    { key: 'companyProfession',  label: 'Επάγγελμα Εκδότη',   wide: true },
    { key: 'companyPhone',       label: 'Τηλέφωνο Εκδότη' },
    { key: 'companyEmail',       label: 'Email Εκδότη' },
    { key: 'customerName',       label: 'Πελάτης',            required: true, wide: true },
    { key: 'customerVatNumber',  label: 'ΑΦΜ Πελάτη',         required: true },
    { key: 'customerDoy',        label: 'ΔΟΥ Πελάτη' },
    { key: 'customerAddress',    label: 'Διεύθυνση Πελάτη',   wide: true },
    { key: 'customerProfession', label: 'Επάγγελμα Πελάτη',   wide: true },
    { key: 'invoiceNumber',      label: 'Αρ. Τιμολογίου',     required: true },
    { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ' },
    { key: 'date',               label: 'Ημερομηνία',         required: true },
    { key: 'subtotal',           label: 'Καθαρή αξία',        required: true, numeric: true },
    { key: 'vatAmount',          label: 'ΦΠΑ',                required: true, numeric: true },
    { key: 'totalAmount',        label: 'Γενικό Σύνολο',      required: true, numeric: true },
  ],
  RECEIPT: [
    { key: 'storeName',     label: 'Κατάστημα',     required: true, wide: true },
    { key: 'vatNumber',     label: 'ΑΦΜ εκδότη',    required: true },
    { key: 'invoiceNumber', label: 'Αρ. Αποδείξεως', required: true },
    { key: 'date',          label: 'Ημερομηνία',    required: true },
    { key: 'time',          label: 'Ώρα' },
    { key: 'phone',         label: 'Τηλέφωνο' },
    { key: 'email',         label: 'Email' },
    { key: 'itemsCount',    label: 'Πλήθος ειδών',  numeric: true },
    { key: 'totalAmount',   label: 'Σύνολο',        required: true, numeric: true },
  ],
  GENERAL_TEXT: [
    { key: 'title',    label: 'Τίτλος',    required: true, wide: true },
    { key: 'summary',  label: 'Περίληψη',  wide: true, textarea: true },
    { key: 'keywords', label: 'Keywords (χωρισμένα με κόμμα)', wide: true },
    { key: 'fullText', label: 'Verbatim',  wide: true, textarea: true },
  ],
};

const CATEGORY_OPTIONS = [
  { value: 'EXPENSE', label: 'Έξοδο' },
  { value: 'INVOICE_IN', label: 'Τιμολόγιο αγοράς' },
  { value: 'INVOICE_OUT', label: 'Τιμολόγιο πώλησης' },
  { value: 'RECEIPT', label: 'Απόδειξη' },
  { value: 'CREDIT_NOTE', label: 'Πιστωτικό' },
  { value: 'PAYROLL', label: 'Μισθοδοσία' },
  { value: 'TAX', label: 'Φόρος' },
  { value: 'OTHER', label: 'Άλλο' },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface LineItem { code: string; name: string; quantity: string; price: string; discount: string; vatRate: string; total: string }

const EMPTY_LINE: LineItem = { code: '', name: '', quantity: '', price: '', discount: '', vatRate: '', total: '' };

/** Parse a user-entered numeric string (accepts comma decimals) → number | null. */
function toNum(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v: unknown): string {
  const n = toNum(v);
  if (n == null) return '—';
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}

function toLineItems(raw: any): LineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => ({
    code: it?.code != null ? String(it.code) : '',
    name: it?.name != null ? String(it.name) : '',
    quantity: it?.quantity != null ? String(it.quantity) : '',
    price: it?.price != null ? String(it.price) : '',
    discount: it?.discount != null ? String(it.discount) : '',
    vatRate: it?.vatRate != null ? String(it.vatRate) : '',
    total: it?.total != null ? String(it.total) : '',
  }));
}

/* ------------------------------------------------------------------ */
/* Inline-edit input primitives (DG design system)                    */
/* ------------------------------------------------------------------ */

function GhostInput({
  value, onChange, disabled, align = 'left', numeric, placeholder, className,
}: {
  value: string; onChange: (v: string) => void; disabled?: boolean;
  align?: 'left' | 'right'; numeric?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <input
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-foreground transition',
        'placeholder:text-muted-foreground/50',
        'hover:border-border',
        'focus:border-sisyphus-500 focus:bg-card focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25',
        'disabled:cursor-default disabled:hover:border-transparent',
        align === 'right' && 'text-right tabular-nums',
        numeric && 'font-mono',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OcrRowDetail({
  row, canCategorize, canPost,
}: { row: OcrRow; canCategorize: boolean; canPost: boolean }) {
  const router = useRouter();
  const data = (row.extractedData ?? {}) as Record<string, any>;
  const specs = FIELD_SPECS[row.docType] ?? [];
  const isInvoice = row.docType === 'INVOICE';
  const ro = !canCategorize; // read-only when the user can't edit

  // ---- initial snapshots (for dirty-tracking + reset) ----
  const initialForm = React.useMemo(() => {
    const f: Record<string, string> = {};
    for (const s of specs) {
      const raw = data[s.key];
      f[s.key] = s.key === 'keywords' && Array.isArray(raw) ? raw.join(', ') : raw != null ? String(raw) : '';
    }
    return f;
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialItems = React.useMemo(() => toLineItems(data.items), [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = React.useState<Record<string, string>>(initialForm);
  const [items, setItems] = React.useState<LineItem[]>(initialItems);
  const [category, setCategory] = React.useState(row.category ?? '');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [showJson, setShowJson] = React.useState(false);

  const dirty =
    JSON.stringify(form) !== JSON.stringify(initialForm) ||
    JSON.stringify(items) !== JSON.stringify(initialItems) ||
    category !== (row.category ?? '') ||
    notes !== '';

  const missing = specs.filter((s) => s.required && !String(form[s.key] ?? '').trim());
  const fileUrl = `/api/admin/ocr/${row.id}/file`;
  const isPdf = row.mimeType === 'application/pdf';

  // Live totals derived from the editable lines.
  const linesNet = items.reduce((sum, it) => sum + (toNum(it.total) ?? 0), 0);

  function setField(key: string, v: string) { setForm((f) => ({ ...f, [key]: v })); }
  function setLine(idx: number, key: keyof LineItem, v: string) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: v } : it)));
  }
  function addLine() { setItems((arr) => [...arr, { ...EMPTY_LINE }]); }
  function removeLine(idx: number) { setItems((arr) => arr.filter((_, i) => i !== idx)); }
  function reset() { setForm(initialForm); setItems(initialItems); setCategory(row.category ?? ''); setNotes(''); }

  function buildExtractedData() {
    const out: Record<string, any> = { ...data };
    for (const s of specs) {
      const v = form[s.key];
      if (s.key === 'keywords') {
        out.keywords = String(v ?? '').split(',').map((k) => k.trim()).filter(Boolean);
      } else if (s.numeric) {
        out[s.key] = toNum(v);
      } else {
        out[s.key] = String(v ?? '').trim() || null;
      }
    }
    if (isInvoice) {
      out.items = items
        .map((it) => ({
          code: it.code.trim() || null,
          name: it.name.trim(),
          quantity: toNum(it.quantity),
          price: toNum(it.price),
          discount: toNum(it.discount),
          vatRate: toNum(it.vatRate),
          total: toNum(it.total),
        }))
        .filter((it) => it.name || it.code || it.total != null);
    }
    return out;
  }

  async function save() {
    setSaving(true);
    try {
      const extractedData = buildExtractedData();
      const body: any = { category: category || null, notes: notes || null, extractedData };
      if (isInvoice) body.items = extractedData.items;
      const res = await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε');
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setSaving(false); }
  }

  async function post() {
    if (!category) { toast.error('Όρισε κατηγορία πρώτα.'); return; }
    setPosting(true);
    try {
      // Persist any pending edits first so SoftOne gets the corrected data.
      await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, extractedData: buildExtractedData(), ...(isInvoice ? { items: buildExtractedData().items } : {}) }),
      });
      const res = await fetch(`/api/admin/ocr/${row.id}/post-softone`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Αναρτήθηκε (ref: ${json.ref})`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`);
    } finally { setPosting(false); }
  }

  return (
    <div className="space-y-4 bg-muted/20 p-4">
      {row.status === 'FAILED' && row.errorMessage && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <p className="mb-0.5 font-semibold text-destructive">Σφάλμα εκτέλεσης OCR</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive/90">{row.errorMessage}</pre>
        </div>
      )}

      {/* ---- Top: preview | editable fields ---- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* Preview */}
        <aside className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Πρωτότυπο</span>
            <a href={fileUrl} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-[11px] font-medium text-sisyphus-600 hover:underline">
              <FiExternalLink className="size-3" /> Άνοιγμα
            </a>
          </div>
          <div className="aspect-[3/4] bg-neutral-4">
            {isPdf ? (
              <iframe src={fileUrl} title={row.fileName} className="size-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={row.fileName} className="size-full object-contain" />
            )}
          </div>
        </aside>

        {/* Editable fields */}
        <div className="rounded-xl border border-border bg-card shadow-fluent-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Πεδία</span>
            {missing.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                <FiAlertCircle className="size-3" /> {missing.length} λείπουν
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 p-4 sm:grid-cols-2">
            {specs.map((s) => (
              <label key={s.key} className={cn('flex flex-col gap-1', s.wide && 'sm:col-span-2')}>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.label}{s.required && <span className="ml-0.5 text-dg-red-500">*</span>}
                </span>
                {s.textarea ? (
                  <textarea
                    rows={s.key === 'fullText' ? 8 : 3}
                    disabled={ro}
                    value={form[s.key] ?? ''}
                    onChange={(e) => setField(s.key, e.target.value)}
                    className="w-full resize-y rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60"
                  />
                ) : (
                  <div className={cn(
                    'rounded-md',
                    s.required && !String(form[s.key] ?? '').trim() && 'bg-amber-500/5 ring-1 ring-amber-500/30',
                  )}>
                    <GhostInput
                      value={form[s.key] ?? ''} onChange={(v) => setField(s.key, v)}
                      disabled={ro} numeric={s.numeric} align={s.numeric ? 'right' : 'left'}
                      placeholder={ro ? '—' : 'συμπλήρωσε…'}
                    />
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Full-width editable line items (invoices) ---- */}
      {isInvoice && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Γραμμές <span className="text-foreground">({items.length})</span>
            </span>
            {!ro && (
              <button type="button" onClick={addLine}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] font-medium text-sisyphus-600 transition hover:bg-neutral-6/50">
                <FiPlus className="size-3.5" /> Προσθήκη γραμμής
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-neutral-6/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Κωδ.</th>
                  <th className="px-3 py-2 font-semibold">Περιγραφή</th>
                  <th className="w-[80px] px-3 py-2 text-right font-semibold">Ποσ.</th>
                  <th className="w-[110px] px-3 py-2 text-right font-semibold">Τιμή</th>
                  <th className="w-[100px] px-3 py-2 text-right font-semibold">Έκπτ.</th>
                  <th className="w-[80px] px-3 py-2 text-right font-semibold">ΦΠΑ %</th>
                  <th className="w-[120px] px-3 py-2 text-right font-semibold">Σύνολο</th>
                  {!ro && <th className="w-[44px] px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.length === 0 ? (
                  <tr><td colSpan={ro ? 7 : 8} className="px-3 py-6 text-center text-sm text-muted-foreground">Δεν υπάρχουν γραμμές.</td></tr>
                ) : items.map((it, i) => (
                  <tr key={i} className="hover:bg-neutral-6/30">
                    <td className="px-1 py-0.5"><GhostInput value={it.code} onChange={(v) => setLine(i, 'code', v)} disabled={ro} className="font-mono text-xs" /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.name} onChange={(v) => setLine(i, 'name', v)} disabled={ro} /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.quantity} onChange={(v) => setLine(i, 'quantity', v)} disabled={ro} numeric align="right" /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.price} onChange={(v) => setLine(i, 'price', v)} disabled={ro} numeric align="right" /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.discount} onChange={(v) => setLine(i, 'discount', v)} disabled={ro} numeric align="right" /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.vatRate} onChange={(v) => setLine(i, 'vatRate', v)} disabled={ro} numeric align="right" /></td>
                    <td className="px-1 py-0.5"><GhostInput value={it.total} onChange={(v) => setLine(i, 'total', v)} disabled={ro} numeric align="right" className="font-semibold" /></td>
                    {!ro && (
                      <td className="px-2 py-0.5 text-center">
                        <button type="button" onClick={() => removeLine(i)} title="Διαγραφή γραμμής"
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-dg-red-500/10 hover:text-dg-red-500">
                          <FiTrash2 className="size-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-neutral-6/40">
                <tr className="text-[12px]">
                  <td colSpan={ro ? 6 : 7} className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Άθροισμα γραμμών (καθαρό)
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMoney(linesNet)}</td>
                  {!ro && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Totals reconciliation hint */}
          {toNum(form.subtotal) != null && Math.abs((toNum(form.subtotal) ?? 0) - linesNet) > 0.02 && (
            <div className="flex items-center gap-1.5 border-t border-border bg-amber-500/5 px-4 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              <FiAlertCircle className="size-3.5 shrink-0" />
              Το άθροισμα γραμμών ({fmtMoney(linesNet)}) διαφέρει από την Καθαρή αξία ({fmtMoney(form.subtotal)}).
            </div>
          )}
        </section>
      )}

      {/* ---- Actions bar ---- */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-fluent-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Κατηγορία</span>
            <select
              value={category} disabled={ro}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60"
            >
              <option value="">— Επιλογή —</option>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Σημειώσεις</span>
            <input
              type="text" disabled={ro} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="Προαιρετικά σχόλια…"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowJson((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-muted-foreground transition hover:bg-neutral-6/50">
            <FiCode className="size-4" /> JSON
          </button>
          {dirty && !ro && (
            <button type="button" onClick={reset}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition hover:bg-neutral-6/50">
              <FiRotateCcw className="size-4" /> Επαναφορά
            </button>
          )}
          <button type="button" disabled={ro || saving || !dirty} onClick={save}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-4 text-[13px] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-50 disabled:hover:bg-sisyphus-500">
            <FiSave className="size-4" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
          <button type="button"
            disabled={!canPost || posting || row.status !== 'COMPLETED' || !category || row.postStatus === 'POSTED'}
            onClick={post}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-[13px] font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300">
            <FiSend className="size-4" /> {posting ? 'Ανάρτηση…' : row.postStatus === 'POSTED' ? 'Αναρτήθηκε' : 'Ανάρτηση στο SoftOne'}
          </button>
        </div>
      </div>

      {/* ---- JSON (collapsible) ---- */}
      {showJson && (
        <pre className="max-h-[420px] overflow-auto rounded-xl border border-border bg-neutral-4 p-3 text-[11px] font-mono leading-relaxed">
{JSON.stringify(buildExtractedData(), null, 2)}
        </pre>
      )}
    </div>
  );
}
