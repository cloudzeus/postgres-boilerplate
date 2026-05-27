'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiSend, FiSave, FiExternalLink, FiAlertCircle, FiCheck } from 'react-icons/fi';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { type OcrRow } from './ocr-table';

interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  format?: (v: any) => string;
}

const SCHEMA: Record<string, FieldSpec[]> = {
  INVOICE: [
    { key: 'companyName',        label: 'Εκδότης',                required: true  },
    { key: 'vatNumber',          label: 'ΑΦΜ Εκδότη',             required: true  },
    { key: 'companyAddress',     label: 'Διεύθυνση Εκδότη',       required: false },
    { key: 'companyDoy',         label: 'ΔΟΥ Εκδότη',             required: false },
    { key: 'companyProfession',  label: 'Επάγγελμα Εκδότη',       required: false },
    { key: 'customerName',       label: 'Πελάτης',                required: true  },
    { key: 'customerVatNumber',  label: 'ΑΦΜ Πελάτη',             required: true  },
    { key: 'customerAddress',    label: 'Διεύθυνση Πελάτη',       required: false },
    { key: 'customerDoy',        label: 'ΔΟΥ Πελάτη',             required: false },
    { key: 'customerProfession', label: 'Επάγγελμα Πελάτη',       required: false },
    { key: 'invoiceNumber',      label: 'Αρ. Τιμολογίου',         required: true  },
    { key: 'aadeMark',           label: 'ΜΑΡΚ ΑΑΔΕ',              required: false },
    { key: 'date',               label: 'Ημερομηνία',             required: true  },
    { key: 'subtotal',           label: 'Καθαρή αξία',            required: true, format: fmtMoney },
    { key: 'vatAmount',          label: 'ΦΠΑ',                    required: true, format: fmtMoney },
    { key: 'totalAmount',        label: 'Γενικό Σύνολο',          required: true, format: fmtMoney },
    { key: 'items',              label: 'Γραμμές',                required: true, format: (v) => Array.isArray(v) ? String(v.length) : '-' },
  ],
  RECEIPT: [
    { key: 'storeName',     label: 'Κατάστημα',       required: true  },
    { key: 'vatNumber',     label: 'ΑΦΜ εκδότη',      required: true  },
    { key: 'invoiceNumber', label: 'Αρ. Αποδείξεως',  required: true  },
    { key: 'date',          label: 'Ημερομηνία',      required: true  },
    { key: 'time',          label: 'Ώρα',             required: false },
    { key: 'itemsCount',    label: 'Πλήθος ειδών',    required: false },
    { key: 'totalAmount',   label: 'Σύνολο',          required: true, format: fmtMoney },
  ],
  GENERAL_TEXT: [
    { key: 'title',    label: 'Τίτλος',    required: true },
    { key: 'summary',  label: 'Περίληψη',  required: true },
    { key: 'keywords', label: 'Keywords',  required: false, format: (v) => Array.isArray(v) ? v.join(', ') : '-' },
    { key: 'fullText', label: 'Verbatim',  required: true,  format: (v) => v ? `${String(v).length} chars` : '-' },
  ],
};

function fmtMoney(v: any) {
  if (v == null) return '-';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(n);
}

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

export function OcrRowDetail({
  row, canCategorize, canPost,
}: { row: OcrRow; canCategorize: boolean; canPost: boolean }) {
  const router = useRouter();
  const [category, setCategory] = React.useState(row.category ?? '');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [posting, setPosting] = React.useState(false);

  const data = row.extractedData ?? {};
  const spec = SCHEMA[row.docType] ?? [];

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
  const fileUrl = `/api/admin/ocr/${row.id}/file`;
  const isPdf = row.mimeType === 'application/pdf';

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ocr/${row.id}`, {
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
    if (!category) { toast.error('Όρισε κατηγορία πρώτα.'); return; }
    setPosting(true);
    try {
      await fetch(`/api/admin/ocr/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
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
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4 p-4 bg-muted/20">
      {/* LEFT — image / pdf preview */}
      <aside className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Πρωτότυπο</span>
          <a href={fileUrl} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            <FiExternalLink className="size-3" /> Άνοιγμα
          </a>
        </div>
        <div className="aspect-[3/4] bg-muted/40">
          {isPdf ? (
            <iframe src={fileUrl} title={row.fileName} className="size-full" />
          ) : row.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={row.fileName} className="size-full object-contain" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
              No preview
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT — extracted data tabs */}
      <div className="rounded-xl border border-border bg-card">
        <Tabs defaultValue="fields">
          <div className="border-b border-border px-3 pt-3">
            <TabsList>
              <TabsTrigger value="fields">
                Πεδία
                {missingCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-destructive/15 px-1 text-[10px] font-bold text-destructive">
                    {missingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
              {row.docType === 'INVOICE' && <TabsTrigger value="items">Γραμμές</TabsTrigger>}
              {row.docType === 'GENERAL_TEXT' && <TabsTrigger value="text">Κείμενο</TabsTrigger>}
              <TabsTrigger value="actions">Κατηγορία & Ανάρτηση</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="fields" className="p-4">
            {row.status === 'FAILED' && row.errorMessage && (
              <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <p className="mb-0.5 font-semibold text-destructive">Σφάλμα εκτέλεσης OCR</p>
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive/90">{row.errorMessage}</pre>
              </div>
            )}
            {missingCount > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <FiAlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span><strong>{missingCount}</strong> υποχρεωτικά πεδία λείπουν.</span>
              </div>
            )}
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td className="w-1/3 py-2 pr-3 align-top">
                      <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
                      {f.required && <span className="ml-1 text-destructive">*</span>}
                    </td>
                    <td className="py-2">
                      {f.present ? (
                        <span className="font-mono text-xs text-foreground inline-flex items-center gap-1">
                          <FiCheck className="size-3 text-emerald-600" />
                          {f.value}
                        </span>
                      ) : f.missing ? (
                        <span className="text-xs italic text-destructive">— λείπει —</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="json" className="p-4">
            <pre className="max-h-[500px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs font-mono">
{JSON.stringify(data, null, 2)}
            </pre>
          </TabsContent>

          {row.docType === 'INVOICE' && (
            <TabsContent value="items" className="p-4">
              <ItemsTable items={Array.isArray((data as any).items) ? (data as any).items : []} />
            </TabsContent>
          )}

          {row.docType === 'GENERAL_TEXT' && (
            <TabsContent value="text" className="p-4">
              <textarea
                readOnly
                value={(data as any).fullText ?? ''}
                rows={16}
                className="w-full resize-y rounded-md border border-input bg-muted/30 p-3 text-sm font-mono"
              />
            </TabsContent>
          )}

          <TabsContent value="actions" className="space-y-3 p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Κατηγορία</span>
                <select
                  value={category}
                  disabled={!canCategorize}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                >
                  <option value="">— Επιλογή —</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Σημειώσεις</span>
                <textarea
                  rows={2}
                  disabled={!canCategorize}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded-md border border-input bg-background p-2 text-sm disabled:opacity-60"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!canCategorize || saving} onClick={save}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">
                <FiSave className="size-4" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </button>
              <button type="button"
                disabled={!canPost || posting || row.status !== 'COMPLETED' || !category || row.postStatus === 'POSTED'}
                onClick={post}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                <FiSend className="size-4" /> {posting ? 'Ανάρτηση…' : 'Ανάρτηση στο SoftOne'}
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ItemsTable({ items }: { items: any[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Δεν εξήχθησαν γραμμές.</p>;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Κωδ.</th>
            <th className="px-3 py-2">Περιγραφή</th>
            <th className="px-3 py-2 text-right">Ποσ.</th>
            <th className="px-3 py-2 text-right">Τιμή</th>
            <th className="px-3 py-2 text-right">Έκπτ.</th>
            <th className="px-3 py-2 text-right">Σύνολο</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((it, i) => (
            <tr key={i}>
              <td className="px-3 py-2 font-mono text-xs">{it.code ?? '-'}</td>
              <td className="px-3 py-2 font-medium">{it.name}</td>
              <td className="px-3 py-2 text-right">{it.quantity ?? '-'}</td>
              <td className="px-3 py-2 text-right">{fmtMoney(it.price)}</td>
              <td className="px-3 py-2 text-right">{it.discount ?? '-'}</td>
              <td className="px-3 py-2 text-right font-semibold">{fmtMoney(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
