'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiDollarSign, FiEdit2, FiLink, FiLoader, FiPackage, FiTag, FiTool, FiX } from 'react-icons/fi';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RegistrySearch } from '@/components/admin/registry-search';
import type { MatchKind } from '@/lib/ocr/line-match';
import { cn } from '@/lib/utils';

/** Η αντιστοίχιση μιας γραμμής όπως τη γράφει η βάση (`OcrInvoiceItem`). */
export interface LineMatch {
  mtrl: number | null;
  expn: number | null;
  lin: number | null;
  code: string | null;
  name: string | null;
  isService: boolean | null;
  matchedBy: string | null;
}

/** Μία κατηγορία δαπάνης (LINCATEGORY) — στενεύει τη λίστα χρεοπιστώσεων. */
export interface LineCategoryOption { id: number; label: string }

/**
 * Ίδια χρώματα/ετικέτες με την ουρά «Είδη & έξοδα» (`CATEGORY_META` του item-panel):
 * η ίδια αντιστοίχιση δεν επιτρέπεται να φαίνεται διαφορετική στις δύο σελίδες.
 */
const KIND_META: Record<MatchKind, { label: string; bg: string; fg: string; icon: React.ReactNode }> = {
  product: { label: 'Είδος', bg: '#EAF4FC', fg: '#0078D4', icon: <FiPackage aria-hidden className="size-3" /> },
  service: { label: 'Υπηρεσία', bg: '#E8F7F0', fg: '#047857', icon: <FiTool aria-hidden className="size-3" /> },
  expense: { label: 'Έξοδο', bg: '#FDF3E3', fg: '#B45309', icon: <FiDollarSign aria-hidden className="size-3" /> },
  lineitem: { label: 'Χρεοπίστωση', bg: '#F3EEFF', fg: '#6D28D9', icon: <FiTag aria-hidden className="size-3" /> },
};

const SEGMENTS: MatchKind[] = ['product', 'service', 'expense', 'lineitem'];

/** Γιατί αντιστοιχίστηκε — το `softoneMatchedBy` της στήλης σε ανθρώπινα ελληνικά. */
const MATCHED_BY: Record<string, string> = {
  manual: 'χειροκίνητα',
  memory: 'από μνήμη',
  code: 'ίδιος κωδικός',
  code1: 'barcode',
  code2: 'κωδικός εργοστασίου',
};

/** Σε ποια κατηγορία ανήκει μια ήδη γραμμένη αντιστοίχιση. `null` = καμία. */
export function matchKindOf(m: LineMatch | null | undefined): MatchKind | null {
  if (!m) return null;
  if (m.lin != null) return 'lineitem';
  if (m.expn != null) return 'expense';
  if (m.mtrl != null) return m.isService ? 'service' : 'product';
  return null;
}

/**
 * Το κελί «SoftOne» του πίνακα γραμμών: δείχνει σε τι αντιστοιχεί η γραμμή
 * (`κωδικός — περιγραφή` + chip κατηγορίας) ή «χωρίς αντιστοίχιση», και — με δικαίωμα
 * `ocr.categorize` — αφήνει τον χρήστη να το διαλέξει εδώ, χωρίς να φύγει από το παραστατικό.
 *
 * Γράφει μέσω του ΥΠΑΡΧΟΝΤΟΣ `POST /api/admin/ocr/match-line`, που κρατά και τη μνήμη
 * (`LineMatchRule`: ΑΦΜ εκδότη + κανονικοποιημένο κείμενο) — την ίδια που γράφει η ουρά
 * «Είδη & έξοδα». Γι' αυτό το επόμενο παραστατικό του ίδιου εκδότη έρχεται συμπληρωμένο.
 */
export function LineMatchCell({
  lineId, match: initial, canManage, defaultKind, lineCategories,
}: {
  lineId: string;
  match: LineMatch | null;
  /** `ocr.categorize` — χωρίς αυτό το κελί είναι μόνο για ανάγνωση. */
  canManage: boolean;
  /** Η κατηγορία που ανοίγει ο picker όταν η γραμμή δεν είναι ακόμη αντιστοιχισμένη. */
  defaultKind: MatchKind;
  lineCategories: LineCategoryOption[];
}) {
  const router = useRouter();
  const [match, setMatch] = React.useState<LineMatch | null>(initial);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const current = matchKindOf(match);
  const [kind, setKind] = React.useState<MatchKind>(current ?? defaultKind);
  const [lineCategory, setLineCategory] = React.useState<number | null>(null);

  // Ο server ξαναέδωσε τη γραμμή (π.χ. μετά από `router.refresh()`): η στήλη είναι η αλήθεια.
  React.useEffect(() => { setMatch(initial); }, [initial]);
  // Άνοιγμα: ξεκίνα από ό,τι είναι ήδη αντιστοιχισμένο, αλλιώς από την κατηγορία του εγγράφου.
  React.useEffect(() => { if (open) setKind(matchKindOf(match) ?? defaultKind); }, [open, match, defaultKind]);

  async function send(body: Record<string, unknown>, done: (d: Record<string, unknown>) => void) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/match-line', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { toast.error((d.message as string) ?? 'Η αντιστοίχιση απέτυχε.'); return; }
      done(d);
      setOpen(false);
      // Τα σύνολα του παραστατικού (`itemsTotal`/`itemsMatched`) ξαναγράφτηκαν στον server.
      router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου — η αντιστοίχιση δεν ολοκληρώθηκε.');
    } finally {
      setBusy(false);
    }
  }

  const pick = (id: number, picked: MatchKind, code: string, name: string) =>
    send(
      {
        lineId,
        ...(picked === 'expense' ? { expn: id } : picked === 'lineitem' ? { lin: id } : { mtrl: id }),
        isService: picked === 'service',
      },
      (d) => {
        const m = (d.match ?? {}) as Partial<LineMatch>;
        setMatch({
          mtrl: m.mtrl ?? null, expn: m.expn ?? null, lin: m.lin ?? null,
          code: m.code ?? code, name: m.name ?? name,
          isService: m.isService ?? (picked === 'service'), matchedBy: 'manual',
        });
        toast.success(`Αντιστοιχίστηκε: ${name}`, {
          description: d.remembered === false
            ? undefined
            : 'Θα συμπληρωθεί μόνη της στην ίδια περιγραφή του ίδιου εκδότη.',
        });
      },
    );

  const clear = () => send({ lineId, mtrl: null }, () => {
    setMatch(null);
    toast.success('Η αντιστοίχιση αφαιρέθηκε — η γραμμή γύρισε στα «Είδη & έξοδα».');
  });

  const meta = current ? KIND_META[current] : null;
  const label = match?.code || match?.name
    ? [match.code, match.name].filter(Boolean).join(' — ')
    : null;

  const display = meta && label ? (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ backgroundColor: meta.bg, color: meta.fg }}
      >
        {meta.icon} {meta.label}
      </span>
      <span className="min-w-0 truncate text-[12px] text-foreground" title={label}>{label}</span>
      {match?.matchedBy && MATCHED_BY[match.matchedBy] && (
        <span className="shrink-0 text-[10px] text-muted-foreground">· {MATCHED_BY[match.matchedBy]}</span>
      )}
    </span>
  ) : (
    <span className="text-[12px] text-muted-foreground">Χωρίς αντιστοίχιση</span>
  );

  if (!canManage) return <div className="flex min-w-0 items-center">{display}</div>;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1">{display}</div>
      {match && (
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          title="Αφαίρεση αντιστοίχισης"
          aria-label="Αφαίρεση αντιστοίχισης"
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-[var(--cx-hover)] hover:text-destructive focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FiX aria-hidden className="size-3.5" />
        </button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-input px-2 text-[11px] font-semibold text-foreground outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <FiLoader aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
              : match ? <FiEdit2 aria-hidden className="size-3" /> : <FiLink aria-hidden className="size-3" />}
            {match ? 'Αλλαγή' : 'Αντιστοίχιση'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div role="group" aria-label="Κατηγορία μητρώου" className="flex rounded-lg border border-border p-0.5">
            {SEGMENTS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => { setKind(k); if (k !== 'lineitem') setLineCategory(null); }}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold outline-none',
                  'cx-transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                  kind === k ? 'text-foreground' : 'text-muted-foreground hover:bg-[var(--cx-hover)]',
                )}
                style={kind === k ? { backgroundColor: KIND_META[k].bg, color: KIND_META[k].fg } : undefined}
              >
                {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>

          {/* Η κατηγορία δαπάνης είναι ΤΟ κλειδί για να βρεθεί η σωστή χρεοπίστωση. */}
          {kind === 'lineitem' && (
            <div>
              <label htmlFor={`lc-${lineId}`} className="text-caption font-medium text-muted-foreground">
                Κατηγορία δαπάνης
              </label>
              <select
                id={`lc-${lineId}`}
                value={lineCategory ?? ''}
                disabled={busy || lineCategories.length === 0}
                onChange={(e) => setLineCategory(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-input bg-background px-2.5 text-[13px]"
              >
                <option value="">Όλες οι κατηγορίες</option>
                {lineCategories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {lineCategories.length === 0 && (
                <p className="mt-1 text-caption text-muted-foreground">
                  Δεν έχουν συγχρονιστεί κατηγορίες δαπανών — Είδη → «Κατηγορίες δαπανών».
                </p>
              )}
            </div>
          )}

          <RegistrySearch
            kind={kind}
            disabled={busy}
            id={`line-registry-${lineId}`}
            category={lineCategory}
            label={KIND_META[kind].label}
            onPick={(p) => pick(p.id, p.kind, p.code, p.name)}
          />

          <p className="text-caption text-muted-foreground">
            Η επιλογή <strong>θυμάται</strong>: η ίδια περιγραφή του ίδιου εκδότη θα έρχεται
            αντιστοιχισμένη στο επόμενο παραστατικό.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
