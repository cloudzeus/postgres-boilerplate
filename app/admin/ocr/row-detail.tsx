'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiSend, FiSave, FiExternalLink, FiAlertCircle, FiPlus, FiTrash2, FiRotateCcw, FiCheck, FiPlusCircle } from 'react-icons/fi';
import { CreateSoftoneItemModal } from '@/components/admin/create-softone-item-modal';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { reconcileInvoice, analyzeLine } from '@/lib/ocr/invoice-math';
import { SoftoneChecksStrip } from '@/components/admin/softone-checks-strip';
import { ZoomablePreview } from '@/components/admin/zoomable-preview';
import { type OcrRow, type SeriesOption } from './ocr-table';

/* ------------------------------------------------------------------ */
/* Field specs — same standardized layout for every document          */
/* ------------------------------------------------------------------ */

type Group = 'issuer' | 'customer' | 'meta' | 'totals' | 'main';
interface FieldSpec { key: string; label: string; required?: boolean; numeric?: boolean; wide?: boolean; textarea?: boolean; group?: Group }

const FIELD_SPECS: Record<string, FieldSpec[]> = {
  INVOICE: [
    { key: 'companyName',        label: 'Επωνυμία',     required: true, wide: true, group: 'issuer' },
    { key: 'vatNumber',          label: 'ΑΦΜ',          required: true, group: 'issuer' },
    { key: 'companyDoy',         label: 'ΔΟΥ',          group: 'issuer' },
    { key: 'companyPhone',       label: 'Τηλέφωνο',     group: 'issuer' },
    { key: 'companyEmail',       label: 'Email',        group: 'issuer' },
    { key: 'companyAddress',     label: 'Διεύθυνση',    wide: true, group: 'issuer' },
    { key: 'companyProfession',  label: 'Δραστηριότητα', wide: true, group: 'issuer' },
    { key: 'customerName',       label: 'Επωνυμία',     required: true, wide: true, group: 'customer' },
    { key: 'customerVatNumber',  label: 'ΑΦΜ',          required: true, group: 'customer' },
    { key: 'customerDoy',        label: 'ΔΟΥ',          group: 'customer' },
    { key: 'customerAddress',    label: 'Διεύθυνση',    wide: true, group: 'customer' },
    { key: 'invoiceNumber',      label: 'Αρ. Τιμολογίου', required: true, group: 'meta' },
    { key: 'date',               label: 'Ημερομηνία',   required: true, group: 'meta' },
    { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',    group: 'meta' },
    { key: 'subtotal',           label: 'Καθαρή αξία',  required: true, numeric: true, group: 'totals' },
    { key: 'vatAmount',          label: 'ΦΠΑ',          required: true, numeric: true, group: 'totals' },
    { key: 'totalAmount',        label: 'Γενικό Σύνολο', required: true, numeric: true, group: 'totals' },
  ],
  RECEIPT: [
    { key: 'companyName',    label: 'Κατάστημα / Εκδότης', required: true, wide: true, group: 'main' },
    { key: 'vatNumber',      label: 'ΑΦΜ',          required: true, group: 'main' },
    { key: 'companyDoy',     label: 'ΔΟΥ',          group: 'main' },
    { key: 'companyAddress', label: 'Διεύθυνση',    wide: true, group: 'main' },
    { key: 'companyPhone',   label: 'Τηλέφωνο',     group: 'main' },
    { key: 'companyEmail',   label: 'Email',        group: 'main' },
    { key: 'invoiceNumber',  label: 'Αρ. Αποδείξεως', required: true, group: 'main' },
    { key: 'date',           label: 'Ημερομηνία',   required: true, group: 'main' },
    { key: 'time',           label: 'Ώρα',          group: 'main' },
    { key: 'itemsCount',     label: 'Πλήθος ειδών', numeric: true, group: 'main' },
    { key: 'subtotal',       label: 'Καθαρή αξία',  numeric: true, group: 'totals' },
    { key: 'vatAmount',      label: 'ΦΠΑ',          numeric: true, group: 'totals' },
    { key: 'totalAmount',    label: 'Σύνολο',       required: true, numeric: true, group: 'totals' },
  ],
  GENERAL_TEXT: [
    { key: 'title',    label: 'Τίτλος',    required: true, wide: true, group: 'main' },
    { key: 'summary',  label: 'Περίληψη',  wide: true, textarea: true, group: 'main' },
    { key: 'keywords', label: 'Keywords (χωρισμένα με κόμμα)', wide: true, group: 'main' },
    { key: 'fullText', label: 'Verbatim',  wide: true, textarea: true, group: 'main' },
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
function fmt2(v: unknown): string {
  const n = toNum(v);
  return n == null ? '' : n.toFixed(2).replace('.', ',');
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
/* High-contrast input primitives (12px, solid, dark text on white)   */
/* ------------------------------------------------------------------ */

const LABEL_CLS = 'text-[11px] font-semibold text-muted-foreground';
const INPUT_CLS =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground ' +
  'placeholder:text-muted-foreground/60 transition focus:border-sisyphus-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60';

function CellInput({
  value, onChange, onBlur, disabled, align = 'left', numeric, className,
}: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; disabled?: boolean;
  align?: 'left' | 'right'; numeric?: boolean; className?: string;
}) {
  return (
    <input
      type="text" inputMode={numeric ? 'decimal' : undefined} disabled={disabled}
      value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
      className={cn(INPUT_CLS, align === 'right' && 'text-right tabular-nums', numeric && 'font-mono', className)}
    />
  );
}

/** Pass/neutral/fail reconciliation row. Colors are inline (hex) so they never
 * depend on whether a given Tailwind palette is generated in this build. */
const BADGE_STYLE = {
  ok:      { backgroundColor: '#dcfce7', color: '#14532d', borderColor: '#4ade80' }, // green-100 / green-900 / green-400
  fail:    { backgroundColor: '#fef3c7', color: '#78350f', borderColor: '#fbbf24' }, // amber-100 / amber-900 / amber-400
  neutral: { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' }, // gray-100 / gray-700 / gray-300
} as const;

function CheckRow({ ok, label, got, exp }: { ok: boolean | null | undefined; label: string; got: string; exp: string }) {
  const style = ok == null ? BADGE_STYLE.neutral : ok ? BADGE_STYLE.ok : BADGE_STYLE.fail;
  return (
    <div style={style} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold">
      <span className="inline-flex items-center gap-1.5">
        {ok ? <FiCheck className="size-3.5" /> : <FiAlertCircle className={cn('size-3.5', ok == null && 'opacity-60')} />}
        {label}
      </span>
      <span className="font-mono tabular-nums">{got}{ok === false ? ` ≠ ${exp}` : ''}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function OcrRowDetail({
  row, canCategorize, canPost, seriesOptions = [],
}: { row: OcrRow; canCategorize: boolean; canPost: boolean; seriesOptions?: SeriesOption[] }) {
  const router = useRouter();
  const data = (row.extractedData ?? {}) as Record<string, any>;
  const ro = !canCategorize;

  // The user can re-classify the document after the scan; the full field set is
  // always extracted, so switching type only changes which fields are shown.
  const [docType, setDocType] = React.useState<string>(row.docType);
  const specs = FIELD_SPECS[docType] ?? [];
  const isInvoice = docType === 'INVOICE';

  // Union of every key across all types — so values survive a type switch and the
  // editor always has the full extracted payload in hand.
  const ALL_SPECS = React.useMemo(() => {
    const m = new Map<string, FieldSpec>();
    for (const list of Object.values(FIELD_SPECS)) for (const s of list) if (!m.has(s.key)) m.set(s.key, s);
    return [...m.values()];
  }, []);

  const initialForm = React.useMemo(() => {
    const f: Record<string, string> = {};
    for (const s of ALL_SPECS) {
      // Receipts used to store `storeName`; the unified schema uses `companyName`.
      const raw = s.key === 'companyName' ? (data.companyName ?? data.storeName) : data[s.key];
      if (s.group === 'totals' || s.numeric) f[s.key] = fmt2(raw);
      else if (s.key === 'keywords' && Array.isArray(raw)) f[s.key] = raw.join(', ');
      else f[s.key] = raw != null ? String(raw) : '';
    }
    return f;
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialItems = React.useMemo(() => toLineItems(data.items), [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = React.useState<Record<string, string>>(initialForm);
  const [items, setItems] = React.useState<LineItem[]>(initialItems);
  const [category, setCategory] = React.useState(row.category ?? '');
  const [softoneSeries, setSoftoneSeries] = React.useState(row.softoneSeries ?? '');
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);

  const dirty =
    JSON.stringify(form) !== JSON.stringify(initialForm) ||
    JSON.stringify(items) !== JSON.stringify(initialItems) ||
    category !== (row.category ?? '') || softoneSeries !== (row.softoneSeries ?? '') || docType !== row.docType;

  const missing = specs.filter((s) => s.required && !String(form[s.key] ?? '').trim());
  const fileUrl = `/api/admin/ocr/${row.id}/file`;
  const isPdf = row.mimeType === 'application/pdf';
  const linesNet = items.reduce((sum, it) => sum + (toNum(it.total) ?? 0), 0);

  const tNet = toNum(form.subtotal), tVat = toNum(form.vatAmount), tTotal = toNum(form.totalAmount);
  const tSum = (tNet ?? 0) + (tVat ?? 0);
  const totalsBothPresent = tNet != null && tVat != null;
  const totalsOk = totalsBothPresent && tTotal != null && Math.abs(tSum - tTotal) <= 0.02;

  // Full invoice reconciliation: lines→net, VAT per rate (multi-VAT), grand total.
  const recon = React.useMemo(
    () => reconcileInvoice({ items, subtotal: form.subtotal, vatAmount: form.vatAmount, totalAmount: form.totalAmount }),
    [items, form.subtotal, form.vatAmount, form.totalAmount],
  );

  function setField(key: string, v: string) { setForm((f) => ({ ...f, [key]: v })); }
  function blurFmt(key: string) { setForm((f) => ({ ...f, [key]: fmt2(f[key]) })); }
  function setLine(idx: number, key: keyof LineItem, v: string) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [key]: v } : it)));
  }
  function addLine() { setItems((arr) => [...arr, { ...EMPTY_LINE }]); }
  function removeLine(idx: number) { setItems((arr) => arr.filter((_, i) => i !== idx)); }
  const [createLine, setCreateLine] = React.useState<{ code: string; name: string; service: boolean; vat: string } | null>(null);
  function reset() { setForm(initialForm); setItems(initialItems); setCategory(row.category ?? ''); setSoftoneSeries(row.softoneSeries ?? ''); setDocType(row.docType); }

  function buildExtractedData() {
    const out: Record<string, any> = { ...data };
    // Write every known key (not just the visible subset) so edits survive a type switch.
    for (const s of ALL_SPECS) {
      if (!(s.key in form)) continue;
      const v = form[s.key];
      if (s.key === 'keywords') out.keywords = String(v ?? '').split(',').map((k) => k.trim()).filter(Boolean);
      else if (s.numeric || s.group === 'totals') out[s.key] = toNum(v);
      else out[s.key] = String(v ?? '').trim() || null;
    }
    if (isInvoice) {
      out.items = items.map((it) => ({
        code: it.code.trim() || null, name: it.name.trim(),
        quantity: toNum(it.quantity), price: toNum(it.price), discount: toNum(it.discount),
        vatRate: toNum(it.vatRate), total: toNum(it.total),
      })).filter((it) => it.name || it.code || it.total != null);
    }
    return out;
  }

  async function save() {
    setSaving(true);
    try {
      const extractedData = buildExtractedData();
      const body: any = { category: category || null, softoneSeries: softoneSeries || null, extractedData, docType };
      if (isInvoice) body.items = extractedData.items;
      const res = await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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
      const extractedData = buildExtractedData();
      await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, extractedData, ...(isInvoice ? { items: extractedData.items } : {}) }),
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

  /* ---- render helpers ---- */
  const field = (s: FieldSpec) => {
    const invalid = s.required && !String(form[s.key] ?? '').trim();
    return (
      <label key={s.key} className={cn('flex flex-col gap-0.5', s.wide && 'sm:col-span-2')}>
        <span className={LABEL_CLS}>{s.label}{s.required && <span className="ml-0.5 text-dg-red-500">*</span>}</span>
        {s.textarea ? (
          <textarea rows={s.key === 'fullText' ? 8 : 2} disabled={ro}
            value={form[s.key] ?? ''} onChange={(e) => setField(s.key, e.target.value)}
            className={cn(INPUT_CLS, 'h-auto resize-y py-1')} />
        ) : (
          <CellInput value={form[s.key] ?? ''} onChange={(v) => setField(s.key, v)}
            disabled={ro} numeric={s.numeric} align={s.numeric ? 'right' : 'left'}
            className={cn(invalid && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30')} />
        )}
      </label>
    );
  };
  const byGroup = (g: Group) => specs.filter((s) => s.group === g);

  const totalsBox = byGroup('totals').length > 0 ? (
    <div className="ml-auto w-full max-w-md overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
        Σύνολα
      </header>
      <div className="space-y-1 p-3">
        {byGroup('totals').map((s) => {
          const grand = s.key === 'totalAmount';
          return (
            <React.Fragment key={s.key}>
              {grand && <div className="my-1.5 border-t border-dotted border-muted-foreground/50" />}
              <div className={cn('flex items-center justify-between gap-3 rounded-md px-2 py-1', grand && 'bg-sisyphus-500/10')}>
                <span className={cn('text-[12px]', grand ? 'font-bold text-sisyphus-700 dark:text-sisyphus-300' : 'font-medium text-foreground')}>
                  {s.label}
                </span>
                <input
                  type="text" inputMode="decimal" disabled={ro}
                  value={form[s.key] ?? ''} onChange={(e) => setField(s.key, e.target.value)} onBlur={() => blurFmt(s.key)}
                  className={cn(
                    'w-[140px] rounded-md border border-input bg-background px-2 py-1 text-right font-mono text-[12px] tabular-nums text-foreground transition',
                    'focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/25 disabled:opacity-60',
                    grand && 'border-sisyphus-500/50 font-bold text-sisyphus-700 dark:text-sisyphus-300',
                  )}
                />
              </div>
            </React.Fragment>
          );
        })}
        {totalsBothPresent && (
          <div style={totalsOk ? BADGE_STYLE.ok : BADGE_STYLE.fail}
            className="mt-1 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] font-semibold">
            <span className="inline-flex items-center gap-1">
              {totalsOk ? <FiCheck className="size-3.5" /> : <FiAlertCircle className="size-3.5" />}
              Καθαρή + ΦΠΑ {totalsOk ? '= Σύνολο ✓' : tTotal != null ? '≠ Σύνολο' : ''}
            </span>
            <span className="font-mono tabular-nums">{fmt2(tSum)}{!totalsOk && tTotal != null && ` / ${fmt2(tTotal)}`}</span>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="bg-muted/30 p-3">
      {row.status === 'FAILED' && row.errorMessage && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px]">
          <p className="mb-0.5 font-semibold text-destructive">Σφάλμα εκτέλεσης OCR</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive/90">{row.errorMessage}</pre>
        </div>
      )}

      {/* Consolidated SoftOne checks — the decision surface, first thing the user sees. */}
      {row.status === 'COMPLETED' && (
        <div className="mb-3">
          <SoftoneChecksStrip docId={row.id} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-stretch">
        {/* ---- PERSISTENT preview ---- */}
        <aside className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">Πρωτότυπο</span>
            <a href={fileUrl} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-[11px] font-semibold text-sisyphus-600 hover:underline">
              <FiExternalLink className="size-3" /> Άνοιγμα
            </a>
          </div>
          <ZoomablePreview
            src={isPdf ? `/api/admin/ocr/${row.id}/page-image?scale=3` : fileUrl}
            alt={row.fileName}
            fallbackHref={fileUrl}
            className="min-h-[440px] flex-1 bg-muted"
          />
        </aside>

        {/* ---- Editor ---- */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Tabs defaultValue="fields" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border bg-muted/30 px-3 pt-2.5">
              <TabsList>
                <TabsTrigger value="fields" className="text-[12px]">
                  Πεδία
                  {missing.length > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      {missing.length}
                    </span>
                  )}
                </TabsTrigger>
                {isInvoice && <TabsTrigger value="items" className="text-[12px]">Γραμμές ({items.length})</TabsTrigger>}
                <TabsTrigger value="json" className="text-[12px]">JSON</TabsTrigger>
              </TabsList>
            </div>

            {/* ---------- Πεδία: invoice-styled ---------- */}
            <TabsContent value="fields" className="max-h-[480px] overflow-auto p-3">
              {isInvoice ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {/* Issuer */}
                    <section className="overflow-hidden rounded-lg border border-sisyphus-500/40 bg-card">
                      <header className="border-b border-sisyphus-500/30 bg-sisyphus-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-sisyphus-700 dark:text-sisyphus-300">
                        Εκδότης
                      </header>
                      <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 p-3 sm:grid-cols-2">{byGroup('issuer').map(field)}</div>
                    </section>
                    {/* Customer */}
                    <section className="overflow-hidden rounded-lg border border-emerald-500/40 bg-card">
                      <header className="border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Πελάτης
                      </header>
                      <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 p-3 sm:grid-cols-2">{byGroup('customer').map(field)}</div>
                    </section>
                  </div>

                  {/* Meta strip */}
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-3">
                    {byGroup('meta').map(field)}
                  </div>

                  {/* Totals box (label left / amount right, 2 decimals, sum check) */}
                  {totalsBox}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    {specs.filter((s) => s.group !== 'totals').map(field)}
                  </div>
                  {totalsBox}
                </div>
              )}
            </TabsContent>

            {/* ---------- Γραμμές ---------- */}
            {isInvoice && (
              <TabsContent value="items" className="max-h-[480px] overflow-auto p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">Γραμμές <span className="text-foreground">({items.length})</span></span>
                  {!ro && (
                    <button type="button" onClick={addLine}
                      className="inline-flex items-center gap-1 rounded-md border border-sisyphus-500/40 bg-sisyphus-500/10 px-2 py-1 text-[11px] font-semibold text-sisyphus-700 transition hover:bg-sisyphus-500/20 dark:text-sisyphus-300">
                      <FiPlus className="size-3.5" /> Προσθήκη γραμμής
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[680px]">
                    <thead className="border-b border-border bg-sisyphus-500/10 text-left text-[11px] font-bold uppercase tracking-wide text-sisyphus-700 dark:text-sisyphus-300">
                      <tr>
                        <th className="px-3 py-1.5">Κωδ.</th>
                        <th className="px-3 py-1.5">Περιγραφή</th>
                        <th className="w-[86px] px-3 py-1.5 text-right">Ποσ.</th>
                        <th className="w-[110px] px-3 py-1.5 text-right">Τιμή</th>
                        <th className="w-[96px] px-3 py-1.5 text-right">Έκπτ.</th>
                        <th className="w-[78px] px-3 py-1.5 text-right">ΦΠΑ %</th>
                        <th className="w-[118px] px-3 py-1.5 text-right">Σύνολο</th>
                        {!ro && <th className="w-[40px] px-2 py-1.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.length === 0 ? (
                        <tr><td colSpan={ro ? 7 : 8} className="px-3 py-5 text-center text-[12px] text-muted-foreground">Δεν υπάρχουν γραμμές.</td></tr>
                      ) : items.map((it, i) => {
                        const la = analyzeLine(it);
                        const dTitle = la.discountKind === 'percent' ? 'Έκπτωση επί τοις %' : la.discountKind === 'amount' ? 'Έκπτωση ως ποσό' : undefined;
                        return (
                        <tr key={i} className={cn('hover:bg-sisyphus-500/5', !la.consistent ? 'bg-amber-500/5' : 'odd:bg-muted/20')}>
                          <td className="px-1.5 py-1"><CellInput value={it.code} onChange={(v) => setLine(i, 'code', v)} disabled={ro} className="font-mono" /></td>
                          <td className="px-1.5 py-1"><CellInput value={it.name} onChange={(v) => setLine(i, 'name', v)} disabled={ro} /></td>
                          <td className="px-1.5 py-1"><CellInput value={it.quantity} onChange={(v) => setLine(i, 'quantity', v)} disabled={ro} numeric align="right" /></td>
                          <td className="px-1.5 py-1"><CellInput value={it.price} onChange={(v) => setLine(i, 'price', v)} disabled={ro} numeric align="right" /></td>
                          <td className="px-1.5 py-1" title={dTitle}><CellInput value={it.discount} onChange={(v) => setLine(i, 'discount', v)} disabled={ro} numeric align="right" className={cn(la.discountKind === 'percent' && 'text-sisyphus-700 dark:text-sisyphus-300')} /></td>
                          <td className="px-1.5 py-1"><CellInput value={it.vatRate} onChange={(v) => setLine(i, 'vatRate', v)} disabled={ro} numeric align="right" /></td>
                          <td className="px-1.5 py-1"><CellInput value={it.total} onChange={(v) => setLine(i, 'total', v)} disabled={ro} numeric align="right"
                            className={cn('font-semibold', !la.consistent && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30')} /></td>
                          {!ro && (
                            <td className="px-2 py-1">
                              <div className="flex items-center justify-center gap-0.5">
                                <button type="button" onClick={() => setCreateLine({ code: it.code, name: it.name, service: false, vat: it.vatRate })}
                                  title="Δημιουργία είδους/υπηρεσίας στο SoftOne"
                                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sisyphus-500/10 hover:text-sisyphus-600">
                                  <FiPlusCircle className="size-3.5" />
                                </button>
                                <button type="button" onClick={() => removeLine(i)} title="Διαγραφή γραμμής"
                                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-dg-red-500/10 hover:text-dg-red-500">
                                  <FiTrash2 className="size-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        ); })}
                    </tbody>
                    <tfoot className="border-t border-border bg-muted/50">
                      <tr className="text-[12px]">
                        <td colSpan={ro ? 6 : 7} className="px-3 py-1.5 text-right font-semibold text-foreground">Άθροισμα γραμμών (καθαρό)</td>
                        <td className="px-3 py-1.5 text-right font-bold tabular-nums text-foreground">{fmtMoney(linesNet)}</td>
                        {!ro && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {/* Reconciliation: lines→net, VAT per rate (multi-VAT), grand total */}
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {recon.vatGroups.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <header className="border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
                        ΦΠΑ ανά συντελεστή{recon.hasMultipleRates && <span className="ml-1.5 font-semibold text-sisyphus-600">• πολλαπλά</span>}
                      </header>
                      <table className="w-full text-[12px]">
                        <thead className="text-left text-[11px] text-muted-foreground">
                          <tr><th className="px-3 py-1 font-semibold">Συντ/στής</th><th className="px-3 py-1 text-right font-semibold">Καθαρή</th><th className="px-3 py-1 text-right font-semibold">ΦΠΑ</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {recon.vatGroups.map((g) => (
                            <tr key={g.rate}>
                              <td className="px-3 py-1 tabular-nums">{g.rate}%</td>
                              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(g.net)}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(g.vat)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-border bg-muted/30 font-semibold">
                          <tr><td className="px-3 py-1">Σύνολο ΦΠΑ (υπολ.)</td><td /><td className="px-3 py-1 text-right tabular-nums">{fmtMoney(recon.vatComputed)}</td></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <CheckRow ok={recon.linesVsSubtotal?.ok ?? null} label="Άθροισμα γραμμών = Καθαρή αξία"
                      got={fmtMoney(recon.sumNet)} exp={recon.subtotal != null ? fmtMoney(recon.subtotal) : '—'} />
                    <CheckRow ok={recon.vatOk} label="Υπολ. ΦΠΑ = δηλωμένο ΦΠΑ"
                      got={fmtMoney(recon.vatComputed)} exp={recon.vatField != null ? fmtMoney(recon.vatField) : '—'} />
                    <CheckRow ok={recon.totalOk} label="Καθαρή + ΦΠΑ = Γενικό Σύνολο"
                      got={recon.totalComputed != null ? fmtMoney(recon.totalComputed) : '—'} exp={recon.totalField != null ? fmtMoney(recon.totalField) : '—'} />
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ---------- JSON ---------- */}
            <TabsContent value="json" className="p-3">
              <pre className="max-h-[440px] overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px] font-mono leading-relaxed text-foreground">
{JSON.stringify(buildExtractedData(), null, 2)}
              </pre>
            </TabsContent>
          </Tabs>

          {/* ---- Footer (sticky action bar — always visible) ---- */}
          <div className="sticky bottom-0 z-20 flex flex-col gap-2 border-t border-border bg-card/95 px-3 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur lg:flex-row lg:items-end lg:justify-between">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-xl">
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={LABEL_CLS}>Τύπος παραστατικού (SoftOne)</span>
                <select value={softoneSeries} disabled={ro} onChange={(e) => setSoftoneSeries(e.target.value)} className={cn(INPUT_CLS, 'w-full')}>
                  <option value="">— Επιλογή σειράς —</option>
                  {seriesOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.abbrev ? `${o.abbrev} · ` : ''}{o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-0.5">
                <span className={LABEL_CLS}>Κατηγορία</span>
                <select value={category} disabled={ro} onChange={(e) => setCategory(e.target.value)} className={cn(INPUT_CLS, 'w-full')}>
                  <option value="">— Επιλογή —</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dirty && !ro && (
                <button type="button" onClick={reset}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[12px] font-semibold text-foreground transition hover:bg-muted">
                  <FiRotateCcw className="size-3.5" /> Επαναφορά
                </button>
              )}
              <button type="button" disabled={ro || saving || !dirty} onClick={save}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-50 disabled:hover:bg-sisyphus-500">
                <FiSave className="size-3.5" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </button>
              <button type="button"
                disabled={!canPost || posting || row.status !== 'COMPLETED' || !category || row.postStatus === 'POSTED'}
                onClick={post}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                <FiSend className="size-3.5" /> {posting ? 'Ανάρτηση…' : row.postStatus === 'POSTED' ? 'Αναρτήθηκε' : 'Ανάρτηση'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <CreateSoftoneItemModal
        open={createLine != null}
        onOpenChange={(o) => { if (!o) setCreateLine(null); }}
        initialCode={createLine?.code}
        initialName={createLine?.name}
        defaultService={createLine?.service}
        initialVatRate={createLine?.vat}
        onCreated={() => { setCreateLine(null); router.refresh(); }}
      />
    </div>
  );
}
