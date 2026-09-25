'use client';
import * as React from 'react';
import { FiSearch, FiCheckCircle, FiAlertTriangle, FiSlash } from 'react-icons/fi';

/**
 * ΕΞΑΚΡΙΒΩΣΗ ΣΤΗΝ ΑΑΔΕ, ΧΩΡΙΣ ΝΑ ΓΡΑΦΤΕΙ ΤΙΠΟΤΑ.
 *
 * Η άντληση από την ΑΑΔΕ υπήρχε ήδη, αλλά ΜΟΝΟ μέσα στον διάλογο δημιουργίας: για να δεις τι λέει
 * το μητρώο για έναν ΑΦΜ έπρεπε να ξεκινήσεις να φτιάχνεις καρτέλα. Εδώ η ίδια πηγή γίνεται
 * ΑΝΑΓΝΩΣΗ: τι επιστρέφει η ΑΑΔΕ και σε ΠΟΙΟ πεδίο του SoftOne κάθεται το καθένα.
 *
 * Δείχνει και τα δύο ονόματα (ΑΑΔΕ → SoftOne) επίτηδες: ο χρήστης που θα πατήσει «Δημιουργία»
 * μετά, πρέπει να ξέρει ότι το «Επάγγελμα» της ΑΑΔΕ γίνεται `JOBTYPETRD` και η Δ.Ο.Υ. `IRSDATA` —
 * αλλιώς μια λάθος αντιστοίχιση φαίνεται μόνο αφού γραφτεί η καρτέλα στο ERP.
 */
type Preview = {
  afm: string; name: string | null;
  doyCode: string | null; doyDescr: string | null;
  profession: string | null; address: string | null;
  zip: string | null; city: string | null;
  legalForm: string | null; isActive: boolean;
  softoneDoy?: { office: { code: string; name: string } | null; note?: string | null } | null;
};

const Row = ({ aade, softone, value, hint }: {
  aade: string; softone: string; value: React.ReactNode; hint?: string | null;
}) => (
  <div className="grid grid-cols-[9rem_1fr] gap-x-2 gap-y-0 border-b border-border/50 py-1 last:border-0">
    <div className="min-w-0">
      <div className="truncate text-[length:var(--fs-11)] font-semibold text-foreground">{aade}</div>
      <div className="truncate font-mono text-[length:var(--fs-10)] text-muted-foreground">→ {softone}</div>
    </div>
    <div className="min-w-0 self-center">
      <div className="break-words text-[length:var(--fs-12)] text-foreground">{value || <span className="text-muted-foreground">—</span>}</div>
      {hint && <div className="text-[length:var(--fs-10)] text-muted-foreground">{hint}</div>}
    </div>
  </div>
);

export function AadeVerifyPanel({ afm }: { afm: string }) {
  const [data, setData] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const clean = String(afm ?? '').replace(/\D/g, '');
  const usable = /^\d{9}$/.test(clean);

  async function verify() {
    setBusy(true); setError(null); setData(null);
    try {
      const r = await fetch('/api/admin/ocr/supplier-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afm: clean }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // Η αιτία ΟΝΟΜΑΣΤΙΚΑ: «δεν βρέθηκε» και «δεν απαντά η ΑΑΔΕ» θέλουν άλλη ενέργεια.
        setError(
          d?.error === 'not_found' ? 'Ο ΑΦΜ δεν βρέθηκε στο μητρώο της ΑΑΔΕ.'
          : d?.error === 'invalid_afm' ? 'Μη έγκυρος ΑΦΜ (9 ψηφία).'
          : d?.error === 'aade_unreachable' || d?.error === 'aade_http'
            ? 'Η υπηρεσία της ΑΑΔΕ δεν απάντησε — ξαναδοκίμασε σε λίγο.'
            : (d?.message ?? 'Η εξακρίβωση απέτυχε.'),
        );
        return;
      }
      setData(d as Preview);
    } catch {
      setError('Σφάλμα δικτύου.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button" onClick={verify} disabled={busy || !usable}
        title={usable ? 'Άντληση στοιχείων από το μητρώο της ΑΑΔΕ — δεν γράφεται τίποτα'
          : 'Χρειάζεται ελληνικός ΑΦΜ 9 ψηφίων'}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-sisyphus-500 px-2.5 py-1.5 text-[length:var(--fs-12)] font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 disabled:opacity-50"
      >
        <FiSearch className="size-3.5" /> {busy ? 'Εξακρίβωση…' : 'Εξακρίβωση στην ΑΑΔΕ'}
      </button>

      {error && (
        <p className="flex items-start gap-1 rounded border border-dg-red-500/30 bg-dg-red-500/5 p-1.5 text-[length:var(--fs-11)] text-dg-red-600">
          <FiAlertTriangle className="mt-0.5 size-3 shrink-0" /> {error}
        </p>
      )}

      {data && (
        <div className="rounded border border-border bg-card p-2 shadow-fluent-2">
          <div className="mb-1 flex items-center gap-1.5">
            {data.isActive
              ? <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[length:var(--fs-10)] font-bold uppercase text-emerald-700 dark:text-emerald-300"><FiCheckCircle className="size-3" /> Ενεργός στην ΑΑΔΕ</span>
              : <span className="inline-flex items-center gap-1 rounded bg-dg-red-500/10 px-1.5 py-0.5 text-[length:var(--fs-10)] font-bold uppercase text-dg-red-600"><FiSlash className="size-3" /> Ανενεργός στην ΑΑΔΕ</span>}
            <span className="text-[length:var(--fs-10)] text-muted-foreground">Δεν έχει γραφτεί τίποτα στο SoftOne</span>
          </div>

          <Row aade="Επωνυμία" softone="NAME" value={data.name} />
          <Row aade="ΑΦΜ" softone="AFM" value={<span className="font-mono">{data.afm}</span>} />
          <Row
            aade="Δ.Ο.Υ." softone="IRSDATA"
            value={data.softoneDoy?.office
              ? `${data.softoneDoy.office.code} — ${data.softoneDoy.office.name}`
              : (data.doyDescr ?? null)}
            /* Η αντιστοίχιση Δ.Ο.Υ. είναι το ΜΟΝΟ πεδίο που μπορεί να αποτύχει σιωπηλά: η ΑΑΔΕ
               δίνει κωδικό, το SoftOne θέλει δική του γραμμή IRSDATA. Το λέμε ρητά. */
            hint={data.softoneDoy?.office
              ? `ΑΑΔΕ ${data.doyCode ?? '—'} · ${data.doyDescr ?? ''}`
              : (data.softoneDoy?.note ?? 'Δεν αντιστοιχίστηκε σε Δ.Ο.Υ. του SoftOne — η καρτέλα θα δημιουργηθεί χωρίς αυτήν.')}
          />
          <Row aade="Επάγγελμα" softone="JOBTYPETRD" value={data.profession} />
          <Row aade="Διεύθυνση" softone="ADDRESS" value={data.address} />
          <Row aade="Πόλη" softone="CITY" value={data.city} />
          <Row aade="Τ.Κ." softone="ZIP" value={data.zip} />
          <Row aade="Νομική μορφή" softone="—" value={data.legalForm} hint="Πληροφοριακό· δεν στέλνεται" />
        </div>
      )}
    </div>
  );
}
