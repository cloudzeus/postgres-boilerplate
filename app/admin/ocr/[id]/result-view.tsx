import * as React from 'react';
import { Prisma } from '@prisma/client';
import { FieldCorrection } from './field-correction';
import { LineAllocations, type AllocationRow } from './line-allocations';
import { LineMatchCell, type LineAnalyticsState } from './line-match-cell';
import { matchKindOf, type LineCategoryOption, type LineMatch } from './line-match-kind';
import { CustomFieldsBlock, LineCustomFields, hasLineCustomFields } from '@/components/admin/custom-fields';
import type { MatchKind } from '@/lib/ocr/line-match';
import { commonLineKind, defaultLineKind } from '@/lib/ocr/resolution-plan';
import type { PostingTarget } from '@/lib/ocr/posting-target';
import type { AccountCheckLine } from '@/lib/ocr/account-check';
import { AccountLine } from '@/components/admin/account-line';

type DocWithItems = Prisma.OcrDocumentGetPayload<{ include: { items: { include: { allocations: true } } } }>;

/** Τι μπορεί να κάνει ο χρήστης στη στήλη «SoftOne» του πίνακα γραμμών. */
export interface LineMatchOptions {
  /** `ocr.categorize` — χωρίς αυτό η στήλη είναι μόνο για ανάγνωση (η ΕΝΔΕΙΞΗ μένει). */
  canManage: boolean;
  /** Κατηγορίες δαπανών (LINCATEGORY) για το φίλτρο των χρεοπιστώσεων. */
  lineCategories: LineCategoryOption[];
  /**
   * Ετικέτες «κωδικός — περιγραφή» για τα ids αναλυτικής των γραμμών (η γραμμή κρατά μόνο
   * αριθμούς). Ο server τις φέρνει μία φορά για όλο το παραστατικό.
   */
  analyticsLabels: {
    costCntr: Record<number, string>;
    prjc: Record<number, string>;
    prjcStage: Record<number, string>;
  };
  /** TRDR του εκδότη — τα έργα ΤΟΥ πρώτα στον picker, όπως και στην ουρά. */
  trdr: number | null;
  /** Ο λογαριασμός γενικής κάθε αντιστοιχισμένης γραμμής, ανά `rowIndex` (βλ. `lineAccountsFor`). */
  lineAccounts?: Record<number, AccountCheckLine>;
  /**
   * Πού καταχωρείται το παραστατικό. Ορίζει ΠΟΙΑ μητρώα χωράνε σε κάθε γραμμή — χωρίς αυτό ο
   * picker πρότεινε «Είδος» και σε παραστατικά που δέχονται μόνο χρεοπιστώσεις.
   */
  target: PostingTarget | null;
}

/**
 * Η αναλυτική μιας γραμμής για την οθόνη. Η ΠΗΓΗ βγαίνει από το `softoneMatchedBy`: ό,τι
 * έγραψε το πέρασμα μνήμης είναι ΠΡΟΤΑΣΗ και σημαδεύεται ως τέτοια — δεν είναι επιλογή
 * που έκανε ο χρήστης.
 */
function lineAnalyticsOf(
  it: DocWithItems['items'][number],
  labels: LineMatchOptions['analyticsLabels'],
): LineAnalyticsState {
  const source = it.softoneMatchedBy === 'memory' ? 'memory' as const : 'manual' as const;
  const one = (id: number | null, by: Record<number, string>) =>
    (id == null ? { id: null, label: null, source: null } : { id, label: by[id] ?? String(id), source });
  return {
    costCntr: one(it.softoneCostCntr, labels.costCntr),
    prjc: one(it.softonePrjc, labels.prjc),
    prjcStage: one(it.softonePrjcStage, labels.prjcStage),
  };
}

const lineMatchOf = (it: DocWithItems['items'][number]): LineMatch | null =>
  it.softoneMtrl == null && it.softoneExpn == null && it.softoneLinMtrl == null
    ? null
    : {
      mtrl: it.softoneMtrl, expn: it.softoneExpn, lin: it.softoneLinMtrl,
      code: it.softoneCode, name: it.softoneName,
      isService: it.softoneIsService, matchedBy: it.softoneMatchedBy,
    };

/**
 * Η κατηγορία που ανοίγει ο picker για μια ΑΤΑΙΡΙΑΣΤΗ γραμμή.
 *
 * Παλιά ήταν «η πιο συχνή ανάμεσα στις ήδη αντιστοιχισμένες, αλλιώς **Είδος**». Το «αλλιώς
 * Είδος» ήταν ισχυρισμός, όχι προεπιλογή: σε ένα παραστατικό ρεύματος που καταχωρείται σε
 * `LINLINES` — όπου καμία γραμμή δεν είναι αντιστοιχισμένη και **μόνο χρεοπίστωση χωράει** —
 * ο picker άνοιγε στο «Είδος» και ό,τι κι αν διάλεγε ο χρήστης εκεί ήταν άχρηστο.
 *
 * Τώρα αποφασίζει πρώτα ο **προορισμός** και μόνο μετά το ιστορικό του παραστατικού
 * ({@link defaultLineKind}). Όταν δεν φτάνουν ούτε τα δύο, η απάντηση είναι `null`.
 */
function pickerKind(items: DocWithItems['items'], target: PostingTarget | null): MatchKind | null {
  const seen = commonLineKind(items.map((it) => matchKindOf(lineMatchOf(it))));
  return defaultLineKind(target, seen);
}

function fmtNum(n: any): string {
  if (n == null) return '-';
  const v = typeof n === 'object' && typeof n.toNumber === 'function' ? n.toNumber() : Number(n);
  if (Number.isNaN(v)) return '-';
  return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 2 }).format(v);
}

function fmtMoney(n: any): string {
  const s = fmtNum(n);
  return s === '-' ? s : `${s} €`;
}

/**
 * Ο πίνακας γραμμών — ΙΔΙΟΣ για τιμολόγιο και απόδειξη. Μια απόδειξη έχει κι αυτή είδη, και
 * εδώ φαίνονται όλα όσα μπορεί να διορθώσει ο χρήστης στην καρτέλα «Γραμμές», μαζί με τη
 * μονάδα μέτρησης — που δεν είναι στήλη της βάσης αλλά ζει στο κανονικό JSON (`lines.unit`).
 */
function LinesTable({ doc, data, match }: { doc: DocWithItems; data: any; match: LineMatchOptions }) {
  const defaultKind = pickerKind(doc.items, match.target);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Κωδ.</th>
            <th className="px-3 py-2">Περιγραφή</th>
            <th className="px-3 py-2 text-right">Ποσ.</th>
            <th className="px-3 py-2">Μον.</th>
            <th className="px-3 py-2 text-right">Τιμή</th>
            <th className="px-3 py-2 text-right">Έκπτ.</th>
            <th className="px-3 py-2 text-right">Σύνολο</th>
            <th className="px-3 py-2">SoftOne</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {doc.items.length === 0 ? (
            <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Δεν εξήχθησαν γραμμές.</td></tr>
          ) : doc.items.map((it, idx) => {
            const line = (data.items?.[idx] ?? {}) as any;
            const lineCf = (line.customFields ?? null) as Record<string, unknown> | null;
            return (
              <React.Fragment key={it.id}>
                <tr className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{it.code ?? '-'}</td>
                  <td className="px-3 py-2 font-medium">{it.name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(it.quantity)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{(line.unit ?? '') || '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(it.price)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{fmtNum(it.discount)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtMoney(it.total)}</td>
                  <td className="px-3 py-2 min-w-[260px] align-top">
                    <LineMatchCell
                      lineId={it.id}
                      docId={doc.id}
                      match={lineMatchOf(it)}
                      analytics={lineAnalyticsOf(it, match.analyticsLabels)}
                      canManage={match.canManage}
                      defaultKind={defaultKind}
                      lineCategories={match.lineCategories}
                      trdr={match.trdr}
                      target={match.target}
                      lineCode={it.code}
                      lineName={it.name}
                      lineVatRate={it.vatRate == null ? null : String(it.vatRate)}
                      /* Η μονάδα ΔΕΝ είναι στήλη της βάσης — ζει στο κανονικό JSON (`lines.unit`). */
                      lineUnit={(line.unit ?? null) as string | null}
                    />
                    {match.lineAccounts?.[it.rowIndex] && (
                      <div className="mt-1">
                        <AccountLine line={match.lineAccounts[it.rowIndex]} compact />
                      </div>
                    )}
                  </td>
                </tr>
                <LineAllocations
                  key={`${it.id}-alloc`}
                  lineId={it.id}
                  lineTotal={it.total == null ? null : Number(it.total)}
                  canManage={match.canManage}
                  colSpan={8}
                  /* Ο κόσμος τον ορίζει η ΣΕΙΡΑ: `SXDOCLINES` = απλογραφικά (λογαριασμοί
                     εσόδων/εξόδων), οτιδήποτε άλλο = χρεοπιστώσεις των διπλογραφικών. */
                  kind={match.target?.lines === 'SXDOCLINES' ? 'SXACCOUNT' : 'LINEITEM'}
                  initial={(it.allocations ?? []).map((a): AllocationRow => ({
                    order: a.order, registryMtrl: a.registryMtrl,
                    kind: a.kind === 'SXACCOUNT' ? 'SXACCOUNT' : 'LINEITEM', accountCode: a.accountCode,
                    percent: Number(a.percent), amount: Number(a.amount),
                  }))}
                />
                {hasLineCustomFields(lineCf) && (
                  <tr key={`${it.id}-cf`} className="bg-muted/20">
                    <td colSpan={8} className="px-3 py-1.5 text-[length:var(--fs-11)] text-muted-foreground">
                      <LineCustomFields cf={lineCf} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OcrResultView({ doc, match }: { doc: DocWithItems; match: LineMatchOptions }) {
  const data = (doc.extractedData ?? {}) as any;

  if (doc.status !== 'COMPLETED') {
    return (
      <section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {doc.status === 'PROCESSING' ? 'Σε επεξεργασία…' : 'Δεν υπάρχουν αποτελέσματα.'}
      </section>
    );
  }

  const fieldList = doc.docType === 'RECEIPT'
    ? ['companyName', 'vatNumber', 'documentTypeLabel', 'invoiceNumber', 'date', 'companyPhone', 'companyEmail', 'subtotal', 'vatAmount', 'totalAmount']
    : ['companyName', 'vatNumber', 'documentTypeLabel', 'companyPhone', 'companyEmail', 'customerName', 'customerVatNumber', 'invoiceNumber', 'date', 'subtotal', 'vatAmount', 'totalAmount'];

  const correction = (doc.docType === 'INVOICE' || doc.docType === 'RECEIPT') ? (
    <FieldCorrection
      docId={doc.id}
      mimeType={doc.mimeType}
      fileUrl={`/api/admin/ocr/${doc.id}/file`}
      initialData={(doc.extractedData ?? {}) as any}
      fields={fieldList}
    />
  ) : null;

  if (doc.docType === 'INVOICE') {
    return (
      <section className="space-y-4">
        {correction}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-border bg-card p-4">
          <Field label="Εκδότης" value={data.companyName} />
          <Field label="Τύπος" value={data.documentTypeLabel} />
          <Field label="Αριθμός" value={data.invoiceNumber} mono />
          <Field label="ΑΦΜ" value={data.vatNumber} mono />
          <Field label="Ημερομηνία" value={data.date} />
          <Field label="Σύνολο" value={fmtMoney(data.totalAmount)} accent />
        </div>

        <LinesTable doc={doc} data={data} match={match} />

        <BankAccounts accounts={data.bankAccounts} />
        <CustomFieldsBlock data={data} />
      </section>
    );
  }

  if (doc.docType === 'RECEIPT') {
    return (
      <section className="space-y-4">
        {correction}
        <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-5 font-mono space-y-3 shadow-sm">
        <div className="border-b border-dashed border-border pb-3 text-center">
          <h3 className="text-base font-bold uppercase">{data.companyName ?? data.storeName ?? 'POS'}</h3>
          <p className="text-xs text-muted-foreground">
            {data.date ?? '—'} {data.time ?? ''}
          </p>
        </div>
        <div className="flex justify-between text-sm"><span>Είδη:</span><span>{data.itemsCount ?? 0}</span></div>
        <div className="flex justify-between border-t border-dashed border-border pt-2 text-base font-bold">
          <span>ΣΥΝΟΛΟ:</span><span>{fmtMoney(data.totalAmount)}</span>
        </div>
        </div>

        {doc.items.length > 0 && <LinesTable doc={doc} data={data} match={match} />}

        <BankAccounts accounts={data.bankAccounts} />
        <CustomFieldsBlock data={data} />
      </section>
    );
  }

  // GENERAL_TEXT
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-base font-semibold">{data.title ?? doc.fileName}</h3>
        {data.summary && (
          <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm italic">
            {data.summary}
          </p>
        )}
        {Array.isArray(data.keywords) && data.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.keywords.map((k: string, i: number) => (
              <span key={i} className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">
                #{k}
              </span>
            ))}
          </div>
        )}
      </div>

      {data.fullText && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">Verbatim</p>
          <textarea
            readOnly
            value={data.fullText}
            rows={14}
            className="w-full resize-y rounded-md border border-input bg-muted/30 p-3 text-sm font-mono"
          />
        </div>
      )}
    </section>
  );
}

function BankAccounts({ accounts }: { accounts: any }) {
  const list = Array.isArray(accounts)
    ? accounts.filter((a) => a && (a.iban || a.bank))
    : [];
  if (list.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <p className="text-[length:var(--fs-11)] font-semibold uppercase tracking-wide text-muted-foreground">
        Τραπεζικοί λογαριασμοί εκδότη
      </p>
      <ul className="space-y-1">
        {list.map((a: any, i: number) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-foreground">{a.bank ?? '—'}</span>
            <span className="font-mono text-body-sm text-muted-foreground">{a.iban ?? ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, value, mono, accent }: { label: string; value: any; mono?: boolean; accent?: boolean }) {
  return (
    <div>
      <span className="block text-caption uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
      <p className={[
        'mt-0.5 truncate',
        mono ? 'font-mono text-body-sm' : 'text-body-sm',
        accent ? 'text-primary font-bold' : 'text-foreground font-semibold',
      ].join(' ')}>
        {value ?? '-'}
      </p>
    </div>
  );
}
