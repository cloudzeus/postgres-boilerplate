'use client';

import * as React from 'react';
import { FiAlertTriangle, FiCheckCircle, FiLoader } from 'react-icons/fi';
import { DEPRECIATION_SOURCE, auditGlDepreciation } from '@/lib/ocr/depreciation';

type Gl = { mtrAcn: number; code: string; name: string; acnmsk: string | null; depreciation: number | null };

/**
 * Οι λογιστικές κατηγορίες παγίων του SoftOne απέναντι στους συντελεστές του νόμου. Μόνο ανάγνωση:
 * η εφαρμογή ΔΕΝ αλλάζει κατηγορίες — γράφει τον σωστό συντελεστή σε κάθε νέο πάγιο ξεχωριστά.
 */
export function DepreciationAudit() {
  const [rows, setRows] = React.useState<ReturnType<typeof auditGlDepreciation> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let ignore = false;
    fetch('/api/admin/softone/assets/lookups', { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.message ?? 'Οι κατηγορίες δεν φορτώθηκαν.'); return d as { glCategories: Gl[] }; })
      .then((d) => { if (!ignore) setRows(auditGlDepreciation(d.glCategories)); })
      .catch((e: Error) => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, []);

  const wrong = rows?.filter((r) => r.mismatch).length ?? 0;
  return (
    <section aria-labelledby="depr-h" className="rounded-xl border border-border bg-card shadow-fluent-2">
      <header className="border-b border-border px-4 py-3">
        <h2 id="depr-h" className="text-[length:var(--fs-14)] font-semibold text-foreground">Συντελεστές απόσβεσης κατηγοριών παγίων</h2>
        <p className="text-[length:var(--fs-12)] text-muted-foreground">
          Σύγκριση του φορολογικού συντελεστή κάθε λογιστικής κατηγορίας του SoftOne με τον {DEPRECIATION_SOURCE}. Σε κάθε νέο
          πάγιο η εφαρμογή προτείνει τον συντελεστή του νόμου και τον γράφει στο ίδιο το πάγιο· τις κατηγορίες τις διορθώνει ο λογιστής στο SoftOne.
        </p>
      </header>
      {!rows && !error && (
        <p className="flex items-center gap-2 px-4 py-3 text-[length:var(--fs-12)] text-muted-foreground">
          <FiLoader aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Φόρτωση από το SoftOne…
        </p>
      )}
      {error && <p role="alert" className="px-4 py-3 text-[length:var(--fs-12)] text-rose-700">{error}</p>}
      {rows && (
        <>
          <p className={`flex items-center gap-1.5 px-4 pt-3 text-[length:var(--fs-13)] font-semibold ${wrong ? 'text-amber-800' : 'text-emerald-700'}`}>
            {wrong ? <FiAlertTriangle aria-hidden className="size-4" /> : <FiCheckCircle aria-hidden className="size-4" />}
            {wrong ? `${wrong} από ${rows.length} κατηγορίες έχουν άλλον συντελεστή από τον νόμο` : 'Όλες οι κατηγορίες συμφωνούν με τον νόμο'}
          </p>
          <div className="overflow-x-auto px-4 pb-3 pt-2">
            <table className="w-full text-[length:var(--fs-12)]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Κατηγορία SoftOne</th>
                  <th className="py-1.5 pr-3 font-medium">Λογαριασμός</th>
                  <th className="py-1.5 pr-3 text-right font-medium">SoftOne</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Νόμος</th>
                  <th className="py-1.5 font-medium">Κατηγορία του νόμου</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.mtrAcn} className="border-t border-border">
                    <td className="py-1.5 pr-3 text-foreground">{r.name}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">{r.acnmsk ?? '—'}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono tabular-nums ${r.mismatch ? 'font-semibold text-amber-800' : ''}`}>
                      {r.glRate != null ? `${r.glRate}%` : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{r.legalRate != null ? `${r.legalRate}%` : '—'}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {r.mismatch && <span className="mr-1 rounded bg-amber-500/15 px-1 font-semibold text-amber-800">διαφέρει</span>}
                      {r.legalLabel ?? 'δεν αναγνωρίστηκε — έλεγξέ τη με τον λογιστή'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
