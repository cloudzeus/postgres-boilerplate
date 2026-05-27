import { Prisma } from '@prisma/client';

type DocWithItems = Prisma.OcrDocumentGetPayload<{ include: { items: true } }>;

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

export function OcrResultView({ doc }: { doc: DocWithItems }) {
  const data = (doc.extractedData ?? {}) as any;

  if (doc.status !== 'COMPLETED') {
    return (
      <section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {doc.status === 'PROCESSING' ? 'Σε επεξεργασία…' : 'Δεν υπάρχουν αποτελέσματα.'}
      </section>
    );
  }

  if (doc.docType === 'INVOICE') {
    return (
      <section className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-border bg-card p-4">
          <Field label="Εκδότης" value={data.companyName} />
          <Field label="Αριθμός" value={data.invoiceNumber} mono />
          <Field label="ΑΦΜ" value={data.vatNumber} mono />
          <Field label="Ημερομηνία" value={data.date} />
          <Field label="Σύνολο" value={fmtMoney(data.totalAmount)} accent />
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
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
              {doc.items.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Δεν εξήχθησαν γραμμές.</td></tr>
              ) : doc.items.map((it) => (
                <tr key={it.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{it.code ?? '-'}</td>
                  <td className="px-3 py-2 font-medium">{it.name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(it.quantity)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(it.price)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{fmtNum(it.discount)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtMoney(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (doc.docType === 'RECEIPT') {
    return (
      <section className="mx-auto max-w-sm rounded-xl border border-border bg-card p-5 font-mono space-y-3 shadow-sm">
        <div className="border-b border-dashed border-border pb-3 text-center">
          <h3 className="text-base font-bold uppercase">{data.storeName ?? 'POS'}</h3>
          <p className="text-xs text-muted-foreground">
            {data.date ?? '—'} {data.time ?? ''}
          </p>
        </div>
        <div className="flex justify-between text-sm"><span>Είδη:</span><span>{data.itemsCount ?? 0}</span></div>
        <div className="flex justify-between border-t border-dashed border-border pt-2 text-base font-bold">
          <span>ΣΥΝΟΛΟ:</span><span>{fmtMoney(data.totalAmount)}</span>
        </div>
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Verbatim</p>
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

function Field({ label, value, mono, accent }: { label: string; value: any; mono?: boolean; accent?: boolean }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
      <p className={[
        'mt-0.5 truncate',
        mono ? 'font-mono text-sm' : 'text-sm',
        accent ? 'text-primary font-bold' : 'text-foreground font-semibold',
      ].join(' ')}>
        {value ?? '-'}
      </p>
    </div>
  );
}
