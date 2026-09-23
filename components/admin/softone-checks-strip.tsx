'use client';

import * as React from 'react';
import {
  FiAlertOctagon, FiAlertTriangle, FiCheck, FiChevronDown, FiChevronRight, FiCopy, FiLoader,
  FiPercent, FiPlusCircle, FiBox, FiUser, FiHelpCircle,
} from 'react-icons/fi';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TraderSearch } from '@/components/admin/trader-search';
import { CreateTraderDialog } from '@/components/admin/create-trader-dialog';
import { VatMapFix } from '@/components/admin/vat-map-fix';
import { emitDocLinesChanged, emitFocusLine, useDocLinesChanged } from '@/components/admin/doc-lines-events';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TraderKindName } from '@/lib/ocr/posting-target';
import type { MatchKind } from '@/lib/ocr/line-match';

type RequiredTrader = {
  kind: TraderKindName; sodtype: number; label: string; labelAcc: string; chip: string; object: string;
};

type Checks = {
  duplicate: { checked: boolean; exists: boolean; ref: string | null };
  supplier: {
    checked: boolean; found: boolean; trdr: number | null;
    name: string | null; code: string | null; kind: string | null; afm: string;
    sodtype: number | null; required: RequiredTrader | null; mismatch: boolean;
  };
  items: {
    total: number; matched: number;
    unmatched: { id: string; rowIndex: number; code: string | null; name: string }[];
    allowedKinds: MatchKind[]; reason: string;
  };
  target: { object: string; lines: string; source: string; supported: boolean; reason: string; label: string } | null;
  vat: { missing: (number | null)[]; overridden: number[]; ignored: { rate: number; code: string }[] };
};

type Tone = 'ok' | 'warn' | 'danger' | 'idle';
const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  ok: { bg: '#ECFDF5', fg: '#047857', bd: '#A7F3D0' },
  warn: { bg: '#FFF8EE', fg: '#B45309', bd: '#FCD9A8' },
  danger: { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' },
  idle: { bg: '#F3F4F6', fg: '#6B7280', bd: '#E5E7EB' },
};

/**
 * Η λωρίδα ελέγχων της σελίδας ενός παραστατικού — τι λείπει για να καταχωρηθεί, και **από εδώ**
 * η λύση του.
 *
 * ΤΙ ΑΛΛΑΞΕ ΚΑΙ ΓΙΑΤΙ. Η λωρίδα ήξερε τρία πράγματα (διπλό / προμηθευτής / είδη) και τα ήξερε
 * **χωρίς τον προορισμό** του παραστατικού. Αυτό παρήγαγε τρία αδιέξοδα σε σειρά:
 *
 *  • Πρότεινε πάντα «Προμηθευτή», ακόμη και σε παραστατικό **πιστωτών**. Ο χρήστης συνέδεε
 *    προμηθευτή, η λωρίδα γινόταν πράσινη, και η καταχώριση μπλοκάριζε παρακάτω με
 *    `trader_kind_mismatch`. Τώρα το chip **ονομάζει** τον τύπο που ζητά η σειρά, ψάχνει ΜΟΝΟ
 *    αυτόν, και δημιουργεί αυτόν.
 *  • Είχε **δικό της** δημιουργό εγγραφών μητρώου, που έφτιαχνε πάντα είδος/υπηρεσία — άχρηστο
 *    για γραμμή `LINLINES`. Ο δρόμος αυτός καταργήθηκε: το «Λύσε» **παραπέμπει** στον ΕΝΑΝ
 *    picker του πίνακα γραμμών ({@link emitFocusLine}), που ξέρει και τα τέσσερα μητρώα.
 *  • Δεν ανέφερε καθόλου το `no_vat_category`. Τώρα υπάρχει τέταρτο τμήμα που δείχνει **ποιος
 *    συντελεστής** δεν έχει κωδικό και τον λύνει επί τόπου.
 */
export function SoftoneChecksStrip({ docId, helpHref = null }: { docId: string; helpHref?: string | null }) {
  const [data, setData] = React.useState<Checks | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [creatingTrader, setCreatingTrader] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ocr/${docId}/checks`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [docId]);
  React.useEffect(() => { void load(); }, [load]);
  useDocLinesChanged(docId, () => { void load(); });

  if (loading) {
    return <div className="h-[52px] animate-pulse rounded-xl border border-border bg-muted/30" />;
  }
  if (!data) return null;

  const req = data.supplier.required;
  const dupTone: Tone = !data.duplicate.checked ? 'idle' : data.duplicate.exists ? 'danger' : 'ok';
  // Συνδεδεμένη καρτέλα ΛΑΘΟΣ τύπου δεν είναι «βρέθηκε»: είναι εμπόδιο, και πρέπει να το λέει εδώ.
  const supTone: Tone = data.supplier.mismatch ? 'danger'
    : !data.supplier.checked ? 'idle'
      : data.supplier.found ? 'ok' : 'warn';
  const itemsUnmatched = data.items.unmatched.length;
  const itemsTone: Tone = data.items.total === 0 ? 'idle' : itemsUnmatched === 0 ? 'ok' : 'warn';
  const vatMissing = data.vat.missing.length;
  const vatTone: Tone = data.items.total === 0 ? 'idle' : vatMissing === 0 ? 'ok' : 'warn';

  const needsAction = supTone !== 'ok' || itemsTone === 'warn' || dupTone === 'danger' || vatTone === 'warn';

  const linkTrader = async (trdr: number, name: string) => {
    const res = await fetch(`/api/admin/ocr/${docId}/match-supplier`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trdr }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(`${req?.label ? req.label[0].toUpperCase() + req.label.slice(1) : 'Καρτέλα'}: ${name}`);
      void load();
      emitDocLinesChanged(docId);
    } else {
      // Ο server αρνείται λάθος ΤΥΠΟ καρτέλας με πλήρη εξήγηση — τη δείχνουμε αυτούσια.
      toast.error(d?.message ?? 'Η σύνδεση απέτυχε.');
    }
  };

  const traderValue = data.supplier.mismatch
    ? `${data.supplier.name} — λάθος τύπος (${data.supplier.kind ?? data.supplier.sodtype})`
    : !data.supplier.checked ? 'Δεν ελέγχθηκε'
      : data.supplier.found ? String(data.supplier.name) : 'Δεν βρέθηκε';

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {/* Πού πάει — πρώτο, γιατί ΑΥΤΟ ορίζει τι ζητούν τα υπόλοιπα τμήματα. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-1.5 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Προορισμός</span>
          {helpHref && (
            <Link href={helpHref} target="_blank" aria-label="Βοήθεια: ολοκλήρωση παραστατικού"
              title="Βοήθεια: ολοκλήρωση παραστατικού"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <FiHelpCircle aria-hidden className="size-3.5" />
            </Link>
          )}
          {data.target?.supported ? (
            <>
              <span className="font-medium text-foreground">{data.target.label}</span>
              <span className="text-muted-foreground">· {data.target.reason}</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1" style={{ color: '#B45309' }}>
              <FiAlertTriangle aria-hidden className="size-3" />
              Άγνωστη ή μη υποστηριζόμενη σειρά — δεν ξέρουμε πού καταχωρείται, οπότε δεν προτείνουμε
              ούτε τύπο καρτέλας ούτε μητρώο γραμμών.
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          <Segment
            tone={dupTone}
            icon={dupTone === 'danger' ? <FiAlertOctagon /> : <FiCopy />}
            title="Διπλό"
            value={!data.duplicate.checked ? 'Δεν ελέγχθηκε'
              : data.duplicate.exists ? `Υπάρχει ήδη${data.duplicate.ref ? ` · ${data.duplicate.ref}` : ''}` : 'Δεν υπάρχει διπλό'}
          />

          {/* ── Καρτέλα συναλλασσομένου, του ΤΥΠΟΥ που ζητά η σειρά ───────────── */}
          <Segment
            tone={supTone}
            icon={<FiUser />}
            title={req ? req.chip : 'ΣΥΝΑΛΛΑΣΣΟΜΕΝΟΣ'}
            value={traderValue}
            action={supTone !== 'ok'
              ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-semibold hover:bg-current/5">
                      {data.supplier.mismatch ? 'Διόρθωσε' : 'Σύνδεσε'} <FiChevronDown className="size-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[24rem] space-y-2">
                    {req ? (
                      <p className="text-caption text-muted-foreground">
                        Η σειρά καταχωρείται σε <strong>{req.object}</strong>, που δέχεται καρτέλα{' '}
                        <strong>{req.label}</strong> (SODTYPE {req.sodtype}). Στο SoftOne η ίδια εταιρεία
                        έχει ξεχωριστή καρτέλα ανά τύπο — άλλος τύπος εδώ μπλοκάρει την καταχώριση.
                      </p>
                    ) : (
                      /**
                       * ΑΓΝΩΣΤΗ ΣΕΙΡΑ — και όμως η σύνδεση προσφέρεται.
                       *
                       * Πρώτη εκδοχή αυτής της λωρίδας κλείδωνε ΟΛΟΚΛΗΡΗ την ενέργεια πίσω από
                       * γνωστή σειρά («Χρειάζεται σειρά»). Επειδή όμως η λωρίδα είναι ο ΜΟΝΟΣ
                       * καλών του `match-supplier`, ένα παραστατικό με άγνωστη σειρά έχανε κάθε
                       * τρόπο να συνδεθεί με συναλλασσόμενο από τη σελίδα του — δηλαδή ακριβώς το
                       * αδιέξοδο που αυτή η δουλειά υπάρχει για να λύσει, ανάποδα.
                       *
                       * Αυτό που δεν ξέρουμε είναι ο **τύπος**, όχι η ταυτότητα του εκδότη: η
                       * αναζήτηση δείχνει και τους τρεις τύπους, χωρίς να κρίνει. Η **δημιουργία**
                       * μένει κλειδωμένη — μια λάθος καρτέλα μέσα στο ERP δεν ξεγίνεται, ενώ μια
                       * λάθος σύνδεση εδώ αλλάζει με ένα κλικ.
                       */
                      <p className="text-caption" style={{ color: '#B45309' }}>
                        Η σειρά του παραστατικού είναι άγνωστη ή μη υποστηριζόμενη, οπότε δεν ξέρουμε
                        ποιον <strong>τύπο</strong> καρτέλας δέχεται η κεφαλίδα. Μπορείς να συνδέσεις
                        καρτέλα — διάλεξέ την εσύ — αλλά η δημιουργία νέας μένει κλειδωμένη μέχρι να
                        οριστεί σειρά, για να μη γεννηθεί καρτέλα λάθος τύπου μέσα στο SoftOne.
                      </p>
                    )}
                    {data.supplier.mismatch && req && (
                      <p className="rounded-md border p-2 text-caption"
                        style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2', color: '#B91C1C' }}>
                        Η συνδεδεμένη καρτέλα «{data.supplier.name}» είναι{' '}
                        {data.supplier.kind ?? `τύπου ${data.supplier.sodtype}`} — διάλεξε ή δημιούργησε{' '}
                        {req.labelAcc}.
                      </p>
                    )}
                    {/* Η ΔΗΜΙΟΥΡΓΙΑ πάνω από την αναζήτηση, όχι από ιεραρχία αλλά από μηχανική:
                        η λίστα αποτελεσμάτων της αναζήτησης είναι absolute και σκέπαζε ένα κουμπί
                        που βρισκόταν από κάτω — δηλαδή ακριβώς όταν δεν βρισκόταν καρτέλα και ο
                        χρήστης χρειαζόταν περισσότερο τη δημιουργία, το κουμπί γινόταν άκλικτο. */}
                    {req && (
                      <button type="button" onClick={() => setCreatingTrader(true)}
                        className="inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-sisyphus-500/30 px-2 py-1.5 text-[12px] font-semibold text-sisyphus-600 hover:bg-sisyphus-50">
                        <FiPlusCircle className="size-3.5" /> Δημιουργία {req.labelAcc}
                        {data.supplier.afm ? ` (ΑΦΜ ${data.supplier.afm})` : ''}
                      </button>
                    )}
                    <TraderSearch
                      id={`trader-${docId}`}
                      label={req
                        ? `…ή σύνδεση σε υπάρχουσα καρτέλα ${req.labelAcc}`
                        : 'Σύνδεση σε υπάρχουσα καρτέλα (όλοι οι τύποι)'}
                      placeholder={req
                        ? `Αναζήτηση ${req.labelAcc} (επωνυμία, κωδικός ή ΑΦΜ)…`
                        : 'Επωνυμία, κωδικός ή ΑΦΜ…'}
                      initialQuery={data.supplier.afm || ''}
                      sodtype={req?.sodtype ?? null}
                      onPick={(h) => void linkTrader(h.id, h.name)}
                    />
                  </PopoverContent>
                </Popover>
              )
              : undefined}
          />

          {/* ── Γραμμές: ΜΟΝΟ παραπομπή, κανένας δεύτερος δημιουργός ───────────── */}
          <Segment
            tone={itemsTone}
            icon={<FiBox />}
            title="Γραμμές"
            value={data.items.total === 0 ? '—'
              : itemsUnmatched === 0 ? `Όλες αντιστοιχισμένες (${data.items.total})` : `${itemsUnmatched} χωρίς αντιστοίχιση`}
            action={itemsTone === 'warn'
              ? (
                <button type="button" onClick={() => setOpen((o) => !o)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-current/20 px-2 py-1 text-[11px] font-semibold hover:bg-current/5">
                  Λύσε <FiChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
                </button>
              )
              : undefined}
          />

          {/* ── ΦΠΑ: το `no_vat_category` ως κάτι που λύνεται ──────────────────── */}
          <Segment
            tone={vatTone}
            icon={<FiPercent />}
            title="ΦΠΑ"
            value={data.items.total === 0 ? '—'
              : vatMissing === 0 ? 'Όλοι οι συντελεστές έχουν κωδικό'
                : `${vatMissing} ${vatMissing === 1 ? 'συντελεστής' : 'συντελεστές'} χωρίς κωδικό`}
            action={vatTone === 'warn'
              ? <VatMapFix docId={docId} missing={data.vat.missing} onFixed={() => { void load(); emitDocLinesChanged(docId); }} />
              : undefined}
          />
        </div>

        {/* Η λίστα των αταίριαστων γραμμών — κάθε μία παραπέμπει στον picker ΤΗΣ. */}
        {open && itemsUnmatched > 0 && (
          <div className="border-t border-border bg-muted/20 p-2">
            <p className="px-1 pb-1.5 text-[11px] text-muted-foreground">{data.items.reason}</p>
            <div className="max-h-56 overflow-auto rounded-lg border border-border bg-card">
              {data.items.unmatched.map((l) => (
                <div key={l.id} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0">
                  <span className="w-[90px] shrink-0 font-mono text-[11px] text-muted-foreground">{l.code || `#${l.rowIndex + 1}`}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{l.name}</span>
                  <button type="button" onClick={() => emitFocusLine(l.id)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-sisyphus-500/30 px-2 py-1 text-[11px] font-semibold text-sisyphus-600 hover:bg-sisyphus-50"
                    title="Άνοιγμα της γραμμής στον πίνακα — εκεί γίνεται η αντιστοίχιση ΚΑΙ η δημιουργία">
                    Άνοιξε τη γραμμή <FiChevronRight className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!needsAction && (
          <div className="flex items-center gap-1.5 border-t border-border bg-emerald-50/40 px-3 py-1.5 text-[11px] font-medium" style={{ color: '#047857' }}>
            <FiCheck className="size-3.5" /> Όλοι οι έλεγχοι ΟΚ — έτοιμο για καταχώριση.
          </div>
        )}
      </div>

      {req && (
        <CreateTraderDialog
          open={creatingTrader}
          onOpenChange={setCreatingTrader}
          afm={data.supplier.afm}
          kind={req.kind}
          fallbackName={data.supplier.name}
          reason={data.target?.reason ?? null}
          onCreated={() => { setCreatingTrader(false); void load(); emitDocLinesChanged(docId); }}
        />
      )}
    </>
  );
}

function Segment({
  tone, icon, title, value, action,
}: { tone: Tone; icon: React.ReactNode; title: string; value: string; action?: React.ReactNode }) {
  const t = TONE[tone];
  const StatusIcon = tone === 'ok' ? FiCheck : tone === 'danger' ? FiAlertOctagon : tone === 'warn' ? FiAlertTriangle : FiLoader;
  // Η ενέργεια πάει σε ΔΙΚΗ της γραμμή, κάτω από την κατάσταση. Δίπλα της, σε τέσσερις στήλες,
  // έτρωγε τον χώρο του κειμένου και η κατάσταση γινόταν «Δεν βρέθ…» — δηλαδή το τμήμα έλεγε
  // ότι κάτι φταίει χωρίς να λέει τι.
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: t.bg, color: t.fg }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </div>
          <div className="flex items-center gap-1.5">
            <StatusIcon className="size-3.5 shrink-0" style={{ color: t.fg }} />
            <span className="truncate text-[13px] font-medium text-foreground" title={value}>{value}</span>
          </div>
        </div>
      </div>
      {action && <div className="mt-2 flex justify-end" style={{ color: t.fg }}>{action}</div>}
    </div>
  );
}
