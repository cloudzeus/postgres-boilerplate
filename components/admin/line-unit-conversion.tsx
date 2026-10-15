'use client';

// Κάτω από μια γραμμή αγοράς σε είδος με μονάδα αγορών ≠ βασική: τι θα γράψει η SoftOne.
//   «2 Κιβώτια → 200 Τεμάχια στην αποθήκη»
// με επιλογή «η ποσότητα του τιμολογίου είναι σε: Κιβώτια | Τεμάχια» — η εφαρμογή το βρίσκει από
// τη μονάδα της γραμμής, αλλά ο χρήστης έχει τον τελευταίο λόγο (αποθηκεύεται στη γραμμή).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiLoader, FiPackage } from 'react-icons/fi';
import { toast } from 'sonner';
import { toBaseQty } from '@/lib/item-units';

export interface LineUnitInfo { buyName: string; baseName: string; ratio: number; qtyInBase: boolean; source: 'user' | 'printed' | 'default' }

const fmt = (n: number) => n.toLocaleString('el-GR', { maximumFractionDigits: 4 });

export function LineUnitConversion({ docId, rowIndex, quantity, price, info, canManage }: {
  docId: string; rowIndex: number; quantity: number; price: number | null; info: LineUnitInfo; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'buy' | 'base' | null>(null);
  const inBase = info.qtyInBase;
  const buyQty = inBase ? quantity / info.ratio : quantity;
  const baseQty = inBase ? quantity : toBaseQty(quantity, info.ratio);

  const choose = async (v: 'buy' | 'base') => {
    if (busy || (v === 'base') === inBase && info.source === 'user') return;
    setBusy(v);
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/line-unit`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, qtyIn: v }),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => null))?.message ?? 'Δεν αποθηκεύτηκε.'); return; }
      router.refresh();
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  };

  return (
    <div className="mt-1 rounded-md border border-sisyphus-500/25 bg-sisyphus-50/50 px-2 py-1 text-[length:var(--fs-11)] leading-snug dark:bg-sisyphus-500/10">
      <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-foreground">
        <FiPackage aria-hidden className="size-3 shrink-0 text-sisyphus-600" />
        <span className="tabular-nums">{fmt(buyQty)} {info.buyName}</span>
        <FiArrowRight aria-hidden className="size-3 text-muted-foreground" />
        <strong className="tabular-nums">{fmt(baseQty)} {info.baseName}</strong>
        <span className="text-muted-foreground">στη SoftOne (1 = {fmt(info.ratio)})</span>
        {price != null && !inBase && <span className="text-muted-foreground">· {(price / info.ratio).toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 })}/{info.baseName.toLowerCase()}</span>}
      </p>
      {canManage && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-muted-foreground">
          <span>Η ποσότητα του τιμολογίου είναι σε:</span>
          {(['buy', 'base'] as const).map((v) => {
            const active = (v === 'base') === inBase;
            return (
              <button
                key={v} type="button" onClick={() => void choose(v)} aria-pressed={active} disabled={busy != null}
                className={`inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-1.5 font-medium transition-colors ${active ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'hover:text-foreground'}`}
              >
                {busy === v && <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />}
                {v === 'buy' ? info.buyName : info.baseName}
              </button>
            );
          })}
          {info.source === 'printed' && <span>· από τη μονάδα της γραμμής</span>}
        </div>
      )}
    </div>
  );
}
