'use client';

import * as React from 'react';
import {
  FiAlertTriangle, FiCheck, FiCode, FiCopy, FiDollarSign, FiEdit3, FiLayers, FiPackage, FiSearch, FiTag, FiTool,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RegistrySearch } from '@/components/admin/registry-search';
import { OpenAccountDialog, type OpenRequest } from '@/components/admin/open-account-dialog';
import { vatOfAccount } from '@/lib/ocr/scan-accounts';
import { isValidGtin, lineEan } from '@/lib/ocr/ean';
import { matchUnit, unitOptions } from '@/lib/ocr/unit-match';
import { ratioFromText, unitsError } from '@/lib/item-units';
import { ItemUnitsSection } from '@/components/admin/item-units-section';
import { Field, FormSection, FormSelect, RowHint, fieldCls } from '@/components/admin/form-kit';
import { NamePreview, TranslateButton, TranslatedFrom, useGreekTranslation, useItemNaming, useNamePreview } from '@/components/admin/translate-greek';

/** Μονάδες «συσκευασίας»: όταν το τιμολόγιο γράφει μία από αυτές, η βασική είναι μάλλον το τεμάχιο. */
const PACK_UNIT = /^(κιβ|κουτ|πακ|συσκ|παλ|δοχ|σακ|ρολ)/i;
const ratioNum = (v: string): number | null => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
import { LINE_KIND_LABEL } from '@/lib/ocr/resolution-plan';
import { parseLisourceType } from '@/lib/ocr/lineitem-create';
import type { MatchKind } from '@/lib/ocr/line-match';
import type { InactiveLineItem } from '@/lib/softone-sync/lineitem-activate';

type Opt = { id: string; name: string };
/** Η κατηγορία ΦΠΑ κουβαλά και το **δηλωμένο** ποσοστό της — `null` όταν το SoftOne δεν το δίνει. */
type VatOpt = Opt & { rate: number | null };
type Meta = {
  vats: VatOpt[]; units: Opt[]; groups: Opt[]; categories: Opt[];
  lineCategories: Opt[]; manufacturers: Opt[]; brands: Opt[];
};

const EMPTY_META: Meta = {
  vats: [], units: [], groups: [], categories: [], lineCategories: [], manufacturers: [], brands: [],
};

/** Η κρίση του ΔΙΚΟΥ μας ελέγχου για έναν λογαριασμό γενικής, όπως την επιστρέφει ο server. */
type AccountVerdict = { status: string; message: string | null; accountName: string | null };

type TemplateDto = {
  mtrl: number; code: string; name: string;
  flags: Record<string, unknown>;
  acnmsk: string | null; vat: string | null; mtrCategory: string | null;
  lisourceType: string | null;
  requiredSodtype: number | null;
  account: AccountVerdict;
};

const KIND_ICON: Record<MatchKind, React.ReactNode> = {
  product: <FiPackage className="h-4 w-4" />,
  service: <FiTool className="h-4 w-4" />,
  expense: <FiDollarSign className="h-4 w-4" />,
  lineitem: <FiTag className="h-4 w-4" />,
};

/** Τι ακριβώς γράφεται πού — ο χρήστης πρέπει να το ξέρει ΠΡΙΝ πατήσει. */
const KIND_WHERE: Record<MatchKind, string> = {
  product: 'Νέα καρτέλα είδους στο SoftOne (object ITEM → MTRL, SODTYPE 51).',
  service: 'Νέα καρτέλα υπηρεσίας στο SoftOne (object ITEM → MTRL, SODTYPE 52).',
  expense: 'Νέο έξοδο στο SoftOne (object EXPENSES → EXPN).',
  lineitem: 'Νέα χρεοπίστωση στο SoftOne (object LINEITEM → MTRL, SODTYPE 53) — αυτό δέχεται η γραμμή LINLINES.',
};

const SODTYPE_NAME: Record<number, string> = {
  12: 'προμηθευτής', 13: 'πελάτης', 14: 'χρηματικός λογαριασμός', 15: 'χρεώστης', 16: 'πιστωτής',
};

/**
 * Ταιριάζει κατηγορία ΦΠΑ με τον συντελεστή της γραμμής.
 *
 * ΠΡΩΤΑ το **δηλωμένο** `rate` του μητρώου· μόνο αν λείπει, το ποσοστό μέσα στην περιγραφή
 * («ΦΠΑ 13 % Νέος Συντελεστής»). Η σειρά έχει σημασία: οι μηδενικές κατηγορίες του πελάτη δεν
 * δηλώνουν ποσοστό και το γράφουν μόνο στο όνομά τους — δες `lib/ocr/vat-map.ts`.
 */
const vatMatches = (v: VatOpt, rate: number): boolean => {
  if (v.rate != null) return Number(v.rate) === rate;
  const m = String(v.name).match(/([\d.,]+)\s*%/);
  return m ? parseFloat(m[1].replace(',', '.')) === rate : false;
};

type FormState = { code: string; name: string; vat: string; unit: string; price: string; group: string; category: string };

/**
 * Module-level, ΟΧΙ μέσα στο σώμα του component: ένα component ορισμένο στο render είναι νέος
 * τύπος σε κάθε render, οπότε το React ξεστήνει και ξαναστήνει κάθε `<Select>` — χάνοντας focus
 * και κλείνοντας το ανοιχτό dropdown στο πρώτο πάτημα πλήκτρου.
 */
function Combo({
  label, value, onChange, opts, ph = 'Επιλογή…',
}: { label: string; value: string; onChange: (v: string) => void; opts: Opt[]; ph?: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">{label}</span>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-[length:var(--fs-13)]"><SelectValue placeholder={ph} /></SelectTrigger>
        <SelectContent className="max-h-72">
          {opts.length === 0 && <div className="px-2 py-1.5 text-[length:var(--fs-12)] text-muted-foreground">— κενό —</div>}
          {opts.map((o) => <SelectItem key={o.id} value={o.id} className="text-[length:var(--fs-13)]">{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function Note({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'bad' | 'ok' }) {
  const color = tone === 'bad' ? '#B91C1C' : tone === 'ok' ? '#047857' : '#B45309';
  return (
    <span className="flex items-start gap-1 text-[length:var(--fs-11)]" style={{ color }}>
      {tone !== 'ok' && <FiAlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
      {tone === 'ok' && <FiCheck aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
      {children}
    </span>
  );
}

/** Μικρό combobox πάνω στο λογιστικό σχέδιο — μόνο ΚΙΝΟΥΜΕΝΟΙ λογαριασμοί (τους φιλτράρει ο server). */
/** Πλήρης κωδικός λογαριασμού που κινείται (4 επίπεδα), π.χ. 64.00.00.0006. */
const FULL_ACCOUNT = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

function AccountPicker({
  id, value, onPick, disabled, onMissing,
}: {
  id: string; value: string; onPick: (a: { code: string; name: string }) => void; disabled?: boolean;
  /** Ο χρήστης έγραψε πλήρη κωδικό που ΔΕΝ υπάρχει στο σχέδιο — προσφέρουμε άνοιγμα επί τόπου. */
  onMissing?: (code: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<{ id: number; code: string; name: string }[]>([]);
  const [searched, setSearched] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    let ignore = false;
    const h = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=accounts&q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => { if (!ignore) { setRows(d.results ?? []); setSearched(term); setOpen(true); } })
        .catch(() => { if (!ignore) setRows([]); });
    }, 250);
    return () => { ignore = true; clearTimeout(h); };
  }, [q]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <FiSearch aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id} value={q} disabled={disabled}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder={value ? `Αλλαγή (τώρα: ${value})` : 'Αναζήτηση λογαριασμού (κωδικός ή περιγραφή)…'}
          className="h-9 pl-8 text-[length:var(--fs-13)]" autoComplete="off"
        />
      </div>
      {open && rows.length > 0 && (
        <ul role="listbox" aria-label="Λογαριασμοί γενικής"
          className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-border bg-card shadow-fluent-8">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button"
                onClick={() => { onPick({ code: r.code, name: r.name }); setQ(''); setRows([]); setOpen(false); }}
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--cx-hover)]">
                <span className="line-clamp-1 text-[length:var(--fs-13)] font-medium text-foreground">{r.name}</span>
                <span className="font-mono text-[length:var(--fs-11)] text-muted-foreground">{r.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onMissing && FULL_ACCOUNT.test(q.trim()) && searched === q.trim() && !rows.some((r) => r.code === q.trim()) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-2.5 py-1.5 text-[length:var(--fs-12)] text-foreground">
          <span>Ο <span className="font-mono">{q.trim()}</span> δεν υπάρχει στο λογιστικό σχέδιο.</span>
          <button type="button" onClick={() => onMissing(q.trim())}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md bg-sisyphus-500 px-2.5 font-semibold text-white hover:bg-sisyphus-600">
            Άνοιγμα στο SoftOne
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * **Ο ΕΝΑΣ** inline δημιουργός εγγραφής μητρώου, για μία γραμμή παραστατικού.
 *
 * Παλιά (`create-softone-item-modal`) έφτιαχνε **πάντα** είδος ή υπηρεσία. Σε παραστατικό που
 * καταχωρείται σε `LINLINES` αυτό δεν ήταν απλώς λάθος επιλογή — ήταν αδιέξοδο: ό,τι κι αν
 * δημιουργούσε ο χρήστης, η γραμμή έμενε ακαταχώρητη. Τώρα το μητρώο το ορίζει ο **προορισμός**
 * της σειράς (`lib/ocr/resolution-plan.ts`) και ο δημιουργός ξέρει και τα τέσσερα.
 *
 * Τρία πράγματα που **δεν** κάνει ποτέ:
 *  • Δεν διαλέγει μονάδα μέτρησης μόνος του. Η παλιά φόρμα έβαζε σιωπηλά ΤΕΜΑΧΙΑ για τα πάντα —
 *    και η μονάδα μένει στην καρτέλα για πάντα. Ό,τι δεν αναγνωρίζεται (π.χ. `KWh`) το λέει.
 *  • Δεν **κληρονομεί σιωπηλά** λογαριασμό γενικής σε χρεοπίστωση: τον δείχνει, τον κρίνει με τον
 *    ίδιο έλεγχο που τρέχει πριν την καταχώριση, και αφήνει τον χρήστη να τον αλλάξει.
 *  • Δεν αντιγράφει **χαρακτηρισμό myDATA** από το πρότυπο (δες `lib/ocr/lineitem-create.ts`).
 */
export function CreateRegistryEntryModal({
  open, onOpenChange, kind, lineId, initialCode, initialName, initialVatRate, initialUnit, initialEan, initialMfrCode,
  initialQty, initialPrice, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Το μητρώο στο οποίο θα γραφτεί — το ορίζει ο προορισμός της σειράς. */
  kind: MatchKind;
  lineId?: string | null;
  initialCode?: string | null;
  initialName?: string | null;
  initialVatRate?: string | number | null;
  /** Η **τυπωμένη** μονάδα της γραμμής («KWh», «ΤΕΜ»). */
  initialUnit?: string | null;
  /** Barcode (EAN) και κωδικός κατασκευαστή της γραμμής, όπως διαβάστηκαν. */
  initialEan?: string | null;
  initialMfrCode?: string | null;
  /** Ποσότητα / τιμή μονάδας της γραμμής — για την προεπισκόπηση της μετατροπής μονάδων. */
  initialQty?: number | null;
  initialPrice?: number | null;
  onCreated?: (m: { kind: MatchKind; mtrl: number | null; expn: number | null; lin: number | null; code: string; name: string }) => void;
}) {
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [tab, setTab] = React.useState<'form' | 'object'>('form');
  const [submitting, setSubmitting] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(true);
  const [dryPayload, setDryPayload] = React.useState<unknown>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [codeOffer, setCodeOffer] = React.useState<string | null>(null);
  const [codeSource, setCodeSource] = React.useState<string | null>(null);
  const [unitNote, setUnitNote] = React.useState<string | null>(null);
  const [vatNote, setVatNote] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState<TemplateDto | null>(null);
  const [templateIssue, setTemplateIssue] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState<{ code: string; name: string | null }>({ code: '', name: null });
  const [accountVerdict, setAccountVerdict] = React.useState<AccountVerdict | null>(null);
  /** Άνοιγμα λογαριασμού που λείπει, χωρίς να φύγει ο χρήστης από τη δημιουργία. */
  const [openReq, setOpenReq] = React.useState<OpenRequest | null>(null);
  const proposed = React.useRef<string | null>(null);
  const [f, setF] = React.useState<FormState>({ code: '', name: '', vat: '', unit: '', price: '', group: '', category: '' });
  /** EAN → CODE1, κωδ. κατασκευαστή → CODE2, και ο κωδικός της γραμμής ως κωδικός ΠΡΟΜΗΘΕΥΤΗ. */
  const [code1, setCode1] = React.useState('');
  const [code2, setCode2] = React.useState('');
  const [saveSupplierCode, setSaveSupplierCode] = React.useState(true);
  /** Η «Μορφή κωδικού» του SoftOne για αυτό το μητρώο (π.χ. nnnnnnnnn). */
  const [codeRule, setCodeRule] = React.useState<string | null>(null);

  const isItem = kind === 'product' || kind === 'service';
  /** Μονάδα αγορών/πώλησης ≠ βασική: μόνο για ΕΙΔΟΣ (η υπηρεσία έχει μία μονάδα στη SoftOne). */
  const [alt, setAlt] = React.useState({ buy: '', buyRatio: '', sell: '', sellRatio: '' });
  /** Μετά από απόπειρα υποβολής δείχνουμε ΟΛΑ τα σφάλματα· πριν, μόνο όσα πεδία άφησε ο χρήστης. */
  const [triedSubmit, setTriedSubmit] = React.useState(false);
  const ratioHint = React.useMemo(() => ratioFromText(initialName), [initialName]);
  // Η μονάδα ζει στο `MTRL`, άρα αφορά ΚΑΙ τη χρεοπίστωση· το έξοδο (`EXPN`) δεν έχει μονάδα.
  const hasUnit = kind !== 'expense';
  const needsTemplate = kind === 'lineitem';

  /**
   * Η «Δοκιμή» ΑΚΟΛΟΥΘΕΙ τον διακόπτη `softone.postingEnabled` — δες το ίδιο σκεπτικό στο
   * `create-trader-dialog.tsx`. Εδώ μετράει διπλά: για ένα ΕΞΟΔΟ πρέπει να καταχωρηθεί είδος ή
   * υπηρεσία ΑΝΑ ΓΡΑΜΜΗ, οπότε ένας διάλογος που εξ ορισμού «μόνο ετοιμάζει object» σταματούσε
   * τη ροή τόσες φορές όσες και οι γραμμές του παραστατικού.
   */
  const [postingEnabled, setPostingEnabled] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    setPostingEnabled(null);
    fetch('/api/admin/ocr/posting-enabled', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean } | null) => {
        if (ignore || d == null) return;
        setPostingEnabled(d.enabled === true);
        setDryRun(d.enabled !== true);
      })
      .catch(() => { if (!ignore) setPostingEnabled(null); });
    return () => { ignore = true; };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // Ξεκινά ΑΝΟΙΧΤΗ μέχρι να απαντήσει ο διακόπτης — ποτέ δεν υποθέτουμε «στείλ' το».
    setTab('form'); setDryPayload(null); setDryRun(true);
    setCodeError(null); setCodeOffer(null); setCodeSource(null);
    setTemplate(null); setTemplateIssue(null);
    setAccount({ code: '', name: null }); setAccountVerdict(null);
    // Είδος/υπηρεσία: ο κωδικός της γραμμής είναι κωδικός ΠΡΟΜΗΘΕΥΤΗ — ο κωδικός του είδους
    // ακολουθεί τη «Μορφή κωδικού» και την αρίθμηση (έρχεται από το next-code).
    const itemKind = kind === 'product' || kind === 'service';
    setF({ code: itemKind ? '' : initialCode ?? '', name: initialName ?? '', vat: '', unit: '', price: '', group: '', category: '' });
    setCode1(lineEan(initialEan, initialCode) ?? '');
    setCode2(initialMfrCode ?? '');
    setSaveSupplierCode(true);
    setCodeRule(null);
    proposed.current = null;

    fetch('/api/admin/softone/item-meta')
      .then((r) => r.json())
      .then((m: Meta) => {
        setMeta(m);
        // ── ΦΠΑ: από τον συντελεστή της γραμμής. Χωρίς αντιστοιχία, ΔΕΝ βάζουμε 24 % «επειδή
        //    συνήθως»: το λέμε και ο χρήστης διαλέγει.
        const rate = initialVatRate != null && initialVatRate !== ''
          ? parseFloat(String(initialVatRate).replace(',', '.')) : NaN;
        const vatHit = Number.isFinite(rate) ? m.vats.find((v) => vatMatches(v, rate)) : undefined;
        setVatNote(
          !Number.isFinite(rate)
            ? 'Η γραμμή δεν έχει τυπωμένο συντελεστή ΦΠΑ — διάλεξε κατηγορία.'
            : vatHit ? null
              : m.vats.length === 0
                ? 'Το μητρώο ΦΠΑ δεν έχει συγχρονιστεί — συγχρόνισέ το πρώτα (Ρυθμίσεις → SoftOne).'
                : `Καμία κατηγορία ΦΠΑ του μητρώου δεν δηλώνει ${rate} % — διάλεξε ποια ισχύει.`,
        );
        // ── Μονάδα: μόνο αναμφισβήτητο ταίριασμα. Ποτέ σιωπηλό ΤΕΜ.
        const units = m.units.map((u) => ({ code: u.id, name: u.name }));
        const unitHit = matchUnit(initialUnit ?? '', units);
        setUnitNote(
          !initialUnit
            ? 'Η γραμμή δεν έχει τυπωμένη μονάδα.'
            : unitHit ? null
              : `Η μονάδα «${initialUnit}» δεν υπάρχει στο μητρώο μονάδων του SoftOne — διάλεξε την αντίστοιχη ή πρόσθεσέ τη στο SoftOne πρώτα. Δεν βάζουμε ΤΕΜΑΧΙΑ στην τύχη: η μονάδα μένει στην καρτέλα για πάντα.`,
        );
        // ── Συσκευασία: το τιμολόγιο γράφει «ΚΙΒ» και η περιγραφή «100 ΤΕΜ» ⇒ βασική = τεμάχια,
        //    αγορά = κιβώτιο × 100. Χωρίς σχέση στην περιγραφή, η σχέση μένει κενή και ζητείται.
        const isPack = unitHit && PACK_UNIT.test(unitHit.name);
        const pieces = units.find((u) => /^τεμ/i.test(u.name));
        if (kind === 'product' && isPack && pieces) {
          const r = ratioFromText(initialName);
          // Η τιμή χονδρικής του ΕΙΔΟΥΣ είναι ανά ΒΑΣΙΚΗ μονάδα: κιβώτιο 50 € των 100 ⇒ 0,50 €.
          setF((s) => ({ ...s, vat: vatHit?.id ?? '', unit: pieces.code, price: initialPrice != null && r ? String(Math.round((initialPrice / r) * 10000) / 10000) : '' }));
          setAlt({ buy: unitHit.code, buyRatio: r ? String(r) : '', sell: '', sellRatio: '' });
        } else {
          setF((s) => ({ ...s, vat: vatHit?.id ?? '', unit: unitHit?.code ?? '', price: initialPrice != null ? String(initialPrice) : '' }));
          setAlt({ buy: '', buyRatio: '', sell: '', sellRatio: '' });
        }
      })
      .catch(() => setMeta(EMPTY_META));
  }, [open, kind, initialCode, initialName, initialVatRate, initialUnit, initialEan, initialMfrCode, initialPrice]);

  /**
   * Προτεινόμενος κωδικός ΤΟΥ μητρώου που θα γραφτεί. Για χρεοπίστωση με επιλεγμένο λογαριασμό,
   * ο server προτείνει **τον λογαριασμό** όταν η εγκατάσταση ακολουθεί αυτή τη σύμβαση.
   */
  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    // Είδος/υπηρεσία: ΟΧΙ ο κωδικός του προμηθευτή ως κωδικός είδους — αυτός πάει στους κωδικούς προμηθευτή.
    const sc = initialCode && kind !== 'product' && kind !== 'service' ? `&supplierCode=${encodeURIComponent(initialCode)}` : '';
    const acc = kind === 'lineitem' && account.code ? `&account=${encodeURIComponent(account.code)}` : '';
    fetch(`/api/admin/ocr/new-items/next-code?kind=${kind}${sc}${acc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null; source?: string; rule?: { mask?: string | null } } | null) => {
        if (!ignore) setCodeRule(d?.rule?.mask ?? null);
        if (ignore || !d?.code) return;
        setCodeSource(d.source ?? null);
        setF((s) => (s.code === '' || s.code === proposed.current ? { ...s, code: d.code as string } : s));
        proposed.current = d.code;
      })
      .catch(() => null);
    return () => { ignore = true; };
  }, [open, kind, initialCode, account.code]);

  /**
   * ΠΡΟΤΑΣΗ ΕΝΕΡΓΟΠΟΙΗΣΗΣ. Πριν φτιαχτεί νέα χρεοπίστωση, ελέγχουμε αν υπάρχει ήδη ΑΝΕΝΕΡΓΗ στο
   * SoftOne με τον ίδιο λογαριασμό ή τον ίδιο κωδικό — στο Demo S1 υπήρχαν 222, και η δημιουργία
   * νέας είτε απορριπτόταν («ο κωδικός υπάρχει ήδη») είτε άφηνε δύο χρεοπιστώσεις για έναν λογαριασμό.
   */
  const [inactiveOffer, setInactiveOffer] = React.useState<InactiveLineItem[]>([]);
  const [activating, setActivating] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!open || kind !== 'lineitem') { setInactiveOffer([]); return; }
    const acc = account.code.trim();
    const code = f.code.trim();
    if (!acc && !code) { setInactiveOffer([]); return; }
    let ignore = false;
    const h = setTimeout(() => {
      const qs = new URLSearchParams();
      if (acc) qs.set('account', acc);
      if (code) qs.set('code', code);
      fetch(`/api/admin/softone/lineitems/inactive?${qs}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: InactiveLineItem[] }) => { if (!ignore) setInactiveOffer(d.items ?? []); })
        .catch(() => { if (!ignore) setInactiveOffer([]); });
    }, 300);
    return () => { ignore = true; clearTimeout(h); };
  }, [open, kind, account.code, f.code]);

  const activateInactive = async (it: InactiveLineItem) => {
    setActivating(it.mtrl);
    try {
      const res = await fetch(`/api/admin/softone/lineitems/${it.mtrl}/activate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Πιστωτές μόνο όταν τους χρειάζεται ο προορισμός· άγνωστος προορισμός ⇒ ναι, να χωρά παντού.
        body: JSON.stringify({ allowCreditors: (template?.requiredSodtype ?? 16) === 16 }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok && d.error !== 'nothing_to_do') { toast.error(d.message ?? 'Η ενεργοποίηση απέτυχε.'); return; }
      if (lineId) {
        const m = await fetch('/api/admin/ocr/match-line', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId, lin: it.mtrl }),
        });
        if (!m.ok) { toast.error('Ενεργοποιήθηκε, αλλά η σύνδεση με τη γραμμή απέτυχε — διάλεξέ τη από την αναζήτηση.'); return; }
      }
      toast.success(`Ενεργοποιήθηκε η υπάρχουσα ${it.code} — δεν χρειάστηκε νέα χρεοπίστωση.`);
      onCreated?.({ kind: 'lineitem', mtrl: null, expn: null, lin: it.mtrl, code: it.code, name: it.name });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου — έλεγξε στο SoftOne πριν ξαναπροσπαθήσεις.');
    } finally { setActivating(null); }
  };

  const set = (k: keyof FormState, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Ρυθμίσεις → «Αρχικοποίηση εφαρμογής»: μόνο είδη/υπηρεσίες (όχι έξοδα / είδη χρέωσης).
  const naming = useItemNaming();
  const tr = useGreekTranslation(f.name, (v) => set('name', v), lineId, open, open && isItem && !!naming?.autoTranslate);
  const namePreview = useNamePreview(f.name, tr.original, isItem && open ? naming : null, lineId);

  const body = React.useCallback((overrides: Partial<{ dryRun: boolean }> = {}) => ({
    kind,
    code: f.code.trim() || '—',
    name: f.name.trim() || '—',
    original: isItem ? tr.original : undefined,
    vat: f.vat || null,
    unit: hasUnit ? (f.unit || null) : null,
    price: isItem && f.price ? Number(f.price) : null,
    group: isItem ? (f.group || null) : null,
    category: f.category || null,
    templateMtrl: needsTemplate ? (template?.mtrl ?? null) : null,
    acnmsk: needsTemplate ? (account.code || null) : null,
    lineId: lineId ?? null,
    supplierCode: initialCode || null,
    code1: isItem ? (code1.trim() || null) : null,
    code2: isItem ? (code2.trim() || null) : null,
    saveSupplierCode: isItem ? saveSupplierCode : undefined,
    units: kind === 'product'
      ? { buy: alt.buy || null, buyRatio: ratioNum(alt.buyRatio), sell: alt.sell || null, sellRatio: ratioNum(alt.sellRatio) }
      : undefined,
    dryRun: true,
    ...overrides,
  }), [kind, f, tr.original, hasUnit, isItem, needsTemplate, template, account.code, lineId, initialCode, code1, code2, saveSupplierCode, alt]);

  /** Για χρεοπίστωση: διάβασε ζωντανά το πρότυπο και κρίνε το ΠΡΙΝ σταλεί οτιδήποτε. */
  const pickTemplate = async (p: { id: number; code: string; name: string }) => {
    setTemplateIssue(null);
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body(), templateMtrl: p.id, acnmsk: account.code || null }),
      });
      const d = await res.json().catch(() => ({}));
      const dto = (d.template ?? null) as TemplateDto | null;
      if (dto) {
        setTemplate(dto);
        setAccountVerdict(dto.account ?? null);
        if (!account.code && dto.acnmsk) setAccount({ code: dto.acnmsk, name: dto.account?.accountName ?? null });
        if (!f.vat && dto.vat) set('vat', dto.vat);
        if (!f.category && dto.mtrCategory) set('category', dto.mtrCategory);
      }
      if (!res.ok) { setTemplateIssue(d.message ?? 'Το πρότυπο δεν είναι κατάλληλο.'); return; }
    } catch {
      toast.error('Σφάλμα δικτύου');
    }
  };

  /** Αλλαγή λογαριασμού: ξανακρίνεται αμέσως, με το ίδιο dry-run που φτιάχνει το payload. */
  const revalidate = React.useCallback(async (code: string) => {
    if (!needsTemplate || !template) return;
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body(), templateMtrl: template.mtrl, acnmsk: code || null }),
      });
      const d = await res.json().catch(() => ({}));
      const dto = (d.template ?? null) as TemplateDto | null;
      if (dto) setAccountVerdict(dto.account ?? null);
      setTemplateIssue(res.ok ? null : (d.message ?? null));
    } catch { /* σιωπηλά: η κρίση ξαναγίνεται οπωσδήποτε στην υποβολή */ }
  }, [needsTemplate, template, body]);

  const submit = async () => {
    setTriedSubmit(true);
    if (!f.name.trim() || !f.code.trim()) { toast.error('Συμπλήρωσε Περιγραφή και Κωδικό.'); return; }
    if (isItem && (!f.vat || !f.unit)) { toast.error('Για είδος/υπηρεσία χρειάζονται ΦΠΑ και μονάδα.'); return; }
    if (kind === 'product') {
      const err = unitsError({ base: f.unit, buy: alt.buy || null, buyRatio: ratioNum(alt.buyRatio), sell: alt.sell || null, sellRatio: ratioNum(alt.sellRatio) });
      if (err) { toast.error(err); return; }
    }
    if (needsTemplate && !template) { toast.error('Διάλεξε υπάρχουσα χρεοπίστωση ως πρότυπο.'); return; }
    if (needsTemplate && !account.code) { toast.error('Διάλεξε λογαριασμό γενικής λογιστικής.'); return; }
    setSubmitting(true);
    setCodeError(null); setCodeOffer(null);
    try {
      const res = await fetch('/api/admin/ocr/create-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body({ dryRun }), code: f.code.trim(), name: f.name.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d?.field === 'code') { setCodeError(d.message ?? 'Ο κωδικός δεν έγινε δεκτός.'); setCodeOffer(d.suggestion ?? null); }
        if (d?.field === 'templateMtrl' || d?.field === 'acnmsk') setTemplateIssue(d.message ?? null);
        toast.error(d?.message ?? 'Αποτυχία δημιουργίας στο SoftOne');
        return;
      }
      if (d?.dryRun) {
        setDryPayload(d.payload); setTab('object');
        toast.success('Ετοιμάστηκε το object — δεν στάλθηκε τίποτα στο SoftOne.');
        return;
      }
      toast.success(`Δημιουργήθηκε: ${d.name} (${d.code})`, {
        description: d.remembered ? 'Θα συμπληρωθεί μόνη της στην ίδια περιγραφή του ίδιου εκδότη.' : undefined,
      });
      onCreated?.({ kind, mtrl: d.mtrl ?? null, expn: d.expn ?? null, lin: d.lin ?? null, code: d.code, name: d.name });
      onOpenChange(false);
    } catch {
      toast.error('Σφάλμα δικτύου');
    } finally {
      setSubmitting(false);
    }
  };

  const orderedUnits = meta
    ? unitOptions(initialUnit ?? '', meta.units.map((u) => ({ code: u.id, name: u.name }))).map((u) => ({ id: u.code, name: u.name }))
    : [];

  const lisource = parseLisourceType(template?.lisourceType);
  const needSod = template?.requiredSodtype ?? null;
  const lisourceOk = needSod == null || lisource.includes(needSod);
  const accountOk = accountVerdict?.status === 'ok';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15">{KIND_ICON[kind]}</span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Νέα εγγραφή: {LINE_KIND_LABEL[kind]}</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]" title={KIND_WHERE[kind]}>{KIND_WHERE[kind]}</DialogDescription>
          </div>
          <div role="tablist" aria-label="Προβολή" className="inline-flex shrink-0 rounded-md border border-border bg-muted/50 p-0.5">
            {([['form', 'Στοιχεία', <FiEdit3 key="a" className="size-3.5" />], ['object', 'Αντικείμενο', <FiCode key="b" className="size-3.5" />]] as const).map(([v, lbl, ic]) => (
              <button key={v} onClick={() => setTab(v)} type="button" role="tab" aria-selected={tab === v}
                className={cn('inline-flex h-7 cursor-pointer items-center gap-1 rounded px-2 text-[length:var(--fs-12)] font-medium transition-colors',
                  tab === v ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
                {ic} {lbl}
              </button>
            ))}
          </div>
        </DialogHeader>

        {inactiveOffer.length > 0 && (
          <div role="status" className="space-y-2 border-b border-amber-500/30 bg-amber-500/[0.06] px-5 py-3">
            <p className="text-[length:var(--fs-12)] font-semibold text-foreground">
              Υπάρχει ήδη στο SoftOne, ανενεργή — καλύτερα να την ενεργοποιήσεις παρά να φτιάξεις νέα:
            </p>
            <ul className="space-y-1.5">
              {inactiveOffer.slice(0, 3).map((it) => (
                <li key={it.mtrl} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-[length:var(--fs-12)] text-foreground">
                    <span className="font-mono font-semibold">{it.code}</span> · {it.name}
                    <span className="text-muted-foreground"> · λογ. {it.acnmsk ?? '—'}{it.vat ? ` · ${it.vat}` : ''}</span>
                  </span>
                  <Button size="sm" onClick={() => activateInactive(it)} disabled={activating != null}>
                    {activating === it.mtrl ? 'Ενεργοποίηση…' : lineId ? 'Ενεργοποίηση και χρήση' : 'Ενεργοποίηση'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}


        {!meta ? (
          <div className="px-5 py-12 text-center text-[length:var(--fs-13)] text-muted-foreground">Φόρτωση πινάκων…</div>
        ) : tab === 'form' ? (
          <div className="max-h-[66vh] space-y-3 overflow-auto bg-muted/20 px-4 py-3">
            {needsTemplate && (
              <section className="space-y-2 rounded-xl border border-sisyphus-200 bg-sisyphus-50/40 p-3">
                <p className="text-[length:var(--fs-11)] font-medium text-sisyphus-700">
                  Πρότυπο χρεοπίστωσης <span className="text-destructive">*</span> — από εκεί αντιγράφονται ο
                  «Τύπος» (<code>MTRTYPE</code>) και η <strong>«Κατηγορία τιμολόγησης»</strong>
                  (<code>LISOURCETYPE</code>), που ορίζει σε ποιων τύπων συναλλασσομένων τα παραστατικά
                  επιτρέπεται να μπει η χρεοπίστωση.
                </p>
                <RegistrySearch
                  kind="lineitem"
                  id="lineitem-template"
                  label="Διάλεξε συναφή χρεοπίστωση"
                  onPick={(p) => pickTemplate({ id: p.id, code: p.code, name: p.name })}
                />
                {template && (
                  <>
                    <p className="flex items-center gap-1.5 text-[length:var(--fs-11)] text-emerald-700">
                      <FiCheck className="h-3.5 w-3.5" /> Πρότυπο: <span className="font-medium">{template.code} — {template.name}</span>
                    </p>
                    <div className="rounded-lg border border-border bg-card p-2 text-[length:var(--fs-11)]">
                      <p className="font-medium">
                        Κατηγορία τιμολόγησης: <span className="font-mono">{template.lisourceType || '—'}</span>
                        {lisource.length > 0 && (
                          <span className="text-muted-foreground">
                            {' '}({lisource.map((n) => SODTYPE_NAME[n] ?? n).join(', ')})
                          </span>
                        )}
                      </p>
                      {needSod != null && (
                        lisourceOk
                          ? <Note tone="ok">Περιλαμβάνει τον τύπο {needSod} ({SODTYPE_NAME[needSod]}) που απαιτεί η σειρά.</Note>
                          : <Note tone="bad">Δεν περιλαμβάνει τον τύπο {needSod} ({SODTYPE_NAME[needSod]}) που απαιτεί η σειρά — η νέα χρεοπίστωση δεν θα μπορούσε να μπει στη γραμμή.</Note>
                      )}
                      {needSod == null && (
                        <Note>Άγνωστη σειρά παραστατικού — δεν μπορούμε να κρίνουμε αν η κατηγορία τιμολόγησης αρκεί.</Note>
                      )}
                      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {Object.entries(template.flags).map(([k, v]) => (
                          <div key={k} className="flex gap-1">
                            <dt className="font-mono text-muted-foreground">{k}</dt>
                            <dd className="font-medium">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-1.5 text-muted-foreground">
                        Ο <strong>χαρακτηρισμός myDATA</strong> δεν αντιγράφεται: θα μείνει κενός και η
                        προεπισκόπηση καταχώρισης θα σου το θυμίσει, αντί να κληρονομήσεις σιωπηλά τον
                        χαρακτηρισμό του προτύπου.
                      </p>
                    </div>
                  </>
                )}
                {templateIssue && <Note tone="bad">{templateIssue}</Note>}
              </section>
            )}

            {/* Ο λογαριασμός ΓΕΝΙΚΗΣ είναι ρητό πεδίο, όχι αόρατη κληρονομιά. */}
            {needsTemplate && (
              <section className="space-y-2">
                <p className="text-[length:var(--fs-10)] font-semibold uppercase tracking-wider text-muted-foreground">
                  Λογαριασμός γενικής λογιστικής <span className="text-destructive">*</span>
                </p>
                <p className="text-[length:var(--fs-11)] text-muted-foreground">
                  Εκεί θα χρεωθεί κάθε γραμμή αυτής της χρεοπίστωσης. Προτείνεται ο λογαριασμός του
                  προτύπου — <strong>έλεγξέ τον</strong>: λάθος λογαριασμός δεν φαίνεται πουθενά μετά.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[length:var(--fs-12)]">
                    {account.code || '— κανένας —'}
                  </span>
                  {(account.name || accountVerdict?.accountName) && (
                    <span className="text-[length:var(--fs-12)] text-foreground">{account.name ?? accountVerdict?.accountName}</span>
                  )}
                </div>
                <AccountPicker
                  id="lineitem-account" value={account.code}
                  onPick={(a) => { setAccount({ code: a.code, name: a.name }); void revalidate(a.code); }}
                  onMissing={(code) => setOpenReq({ code, name: f.name, vatRate: vatOfAccount(code) })}
                />
                <p className="text-[length:var(--fs-11)] text-muted-foreground">
                  Δεν υπάρχει ο λογαριασμός που χρειάζεσαι; Γράψε ολόκληρο τον κωδικό (π.χ. 64.00.00.0006) και άνοιξέ τον από εδώ.
                </p>
                {accountVerdict && (accountOk
                  ? <Note tone="ok">Ο λογαριασμός υπάρχει στο σχέδιο και κινείται.</Note>
                  : <Note tone={accountVerdict.status === 'unknown' ? 'warn' : 'bad'}>{accountVerdict.message ?? accountVerdict.status}</Note>
                )}
                {accountVerdict?.status === 'not_in_chart' && FULL_ACCOUNT.test(account.code) && (
                  <button type="button"
                    onClick={() => setOpenReq({ code: account.code, name: f.name, vatRate: vatOfAccount(account.code) })}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-12)] font-semibold text-white hover:bg-sisyphus-600">
                    Άνοιγμα του {account.code} στο SoftOne
                  </button>
                )}
                <OpenAccountDialog
                  req={openReq}
                  onClose={() => setOpenReq(null)}
                  onDone={(code) => {
                    const name = openReq?.name ?? null;
                    setOpenReq(null);
                    setAccount({ code, name });
                    void revalidate(code);
                  }}
                />
              </section>
            )}

            {/* ── 1. ΒΑΣΙΚΑ: περιγραφή σε όλο το πλάτος, μετά ΜΙΑ στοιχισμένη σειρά (κωδικός · ΦΠΑ · τιμή/μονάδα)
                   και οι βοήθειες ΚΑΤΩ από τη σειρά — δεν σπρώχνουν τα διπλανά πεδία. */}
            <FormSection tone="blue" icon={KIND_ICON[kind]} title="Βασικά στοιχεία">
              <Field label="Περιγραφή" required htmlFor="reg-name">
                <div className="flex min-w-0 gap-1.5">
                  <Input id="reg-name" value={f.name} onChange={(e) => set('name', e.target.value)} className={cn(fieldCls, 'min-w-0 flex-1')} />
                  {(tr.offer || tr.busy) && <TranslateButton busy={tr.busy} onClick={() => void tr.translate()} />}
                </div>
                {tr.original != null && <TranslatedFrom original={tr.original} onRestore={tr.restore} />}
                {isItem && <NamePreview typed={f.name} preview={namePreview} />}
              </Field>
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label="Κωδικός" required htmlFor="reg-code" className={isItem ? 'col-span-12 sm:col-span-5' : 'col-span-12 sm:col-span-6'}>
                  <Input id="reg-code" value={f.code} onChange={(e) => { set('code', e.target.value); setCodeError(null); }}
                    aria-invalid={codeError ? true : undefined} className={cn(fieldCls, 'font-mono')} />
                </Field>
                <Field label="Φ.Π.Α." required={isItem} className={isItem ? 'col-span-6 sm:col-span-4' : 'col-span-12 sm:col-span-6'}>
                  <FormSelect value={f.vat} onChange={(v) => set('vat', v)} opts={meta.vats} placeholder="Επίλεξε ΦΠΑ" ariaLabel="Φ.Π.Α." />
                </Field>
                {isItem && (
                  <Field label={kind === 'product' ? 'Τιμή χονδρ. / βασική' : 'Τιμή χονδρικής'} htmlFor="reg-price" className="col-span-6 sm:col-span-3">
                    <Input id="reg-price" value={f.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" placeholder="0,00" className={cn(fieldCls, 'text-right tabular-nums')} />
                  </Field>
                )}
                {hasUnit && kind !== 'product' && (
                  <Field label={`Μονάδα${isItem ? ' *' : ''}`} className="col-span-12 sm:col-span-6">
                    <FormSelect value={f.unit} onChange={(v) => set('unit', v)} opts={orderedUnits}
                      placeholder={kind === 'lineitem' ? 'Κενό = όπως το πρότυπο' : 'Επίλεξε μονάδα'} ariaLabel="Μονάδα" />
                  </Field>
                )}
              </div>
              {codeError ? (
                <RowHint tone="bad">
                  {codeError}
                  {codeOffer && (
                    <button type="button" onClick={() => { set('code', codeOffer); setCodeError(null); }}
                      className="ml-1.5 cursor-pointer font-semibold underline">Χρήση του {codeOffer}</button>
                  )}
                </RowHint>
              ) : codeRule ? (
                <RowHint>Κανόνας SoftOne για τον κωδικό: <span className="font-mono text-foreground">{codeRule}</span> — η πρόταση τον τηρεί.</RowHint>
              ) : codeSource === 'account' ? (
                <RowHint>Ο κωδικός ακολουθεί τον λογαριασμό γενικής — μία χρεοπίστωση ανά λογαριασμό σε αυτή την εγκατάσταση.</RowHint>
              ) : null}
              {vatNote && <Note>{vatNote}</Note>}
              {hasUnit && kind !== 'product' && unitNote && <Note>{unitNote}</Note>}
            </FormSection>

            {/* ── 2. ΜΟΝΑΔΕΣ (μόνο είδος): βασική / αγορών / πώλησης με τη σχέση τους. */}
            {kind === 'product' && (
                <ItemUnitsSection
                  value={{ base: f.unit, ...alt }}
                  onChange={(v) => { set('unit', v.base); setAlt({ buy: v.buy === v.base ? '' : v.buy, buyRatio: v.buyRatio, sell: v.sell === v.base ? '' : v.sell, sellRatio: v.sellRatio }); }}
                  units={orderedUnits}
                  line={{ quantity: initialQty ?? null, price: initialPrice ?? null, unitText: initialUnit ?? null }}
                  ratioSuggestion={ratioHint}
                  showErrors={triedSubmit}
                  note={unitNote ? <Note>{unitNote}</Note> : null}
                />
            )}

            {/* ── 3. ΚΩΔΙΚΟΙ ΑΓΟΡΑΣ: κάθε κωδικός στη θέση του στη SoftOne — όχι όλοι στον κωδικό του είδους. */}
            {isItem && (
              <FormSection tone="amber" icon={<FiTag />} title="Κωδικοί αγοράς">
                <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                  <Field label="Barcode / EAN" htmlFor="reg-ean" className="col-span-12 sm:col-span-6">
                    <Input id="reg-ean" value={code1} onChange={(e) => setCode1(e.target.value)} inputMode="numeric" placeholder="π.χ. 5201234567894" className={cn(fieldCls, 'font-mono')} />
                  </Field>
                  <Field label="Κωδ. κατασκευαστή (εργοστασίου)" htmlFor="reg-mfr" className="col-span-12 sm:col-span-6">
                    <Input id="reg-mfr" value={code2} onChange={(e) => setCode2(e.target.value)} placeholder="part number" className={cn(fieldCls, 'font-mono')} />
                  </Field>
                </div>
                {code1.trim() && !isValidGtin(code1) && (
                  <RowHint tone="warn">Το EAN δεν μοιάζει έγκυρο (8/13 ψηφία με σωστό ψηφίο ελέγχου) — έλεγξέ το.</RowHint>
                )}
                {initialCode && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md bg-amber-50/70 px-2.5 py-1.5 text-[length:var(--fs-12)] text-foreground dark:bg-amber-500/10">
                    <input type="checkbox" checked={saveSupplierCode} onChange={(e) => setSaveSupplierCode(e.target.checked)} className="mt-0.5 size-3.5 accent-sisyphus-600" />
                    <span>
                      Το <span className="font-mono font-semibold">{initialCode}</span> ως <strong>κωδικός του προμηθευτή</strong>
                      <span className="text-muted-foreground"> — το επόμενο τιμολόγιό του βρίσκει μόνο του το είδος.</span>
                    </span>
                  </label>
                )}
              </FormSection>
            )}

            {/* ── 4. ΤΑΞΙΝΟΜΗΣΗ: προαιρετικά, σε μία σειρά. Οι δύο κατάλογοι είναι ΔΙΑΦΟΡΕΤΙΚΟΙ πίνακες:
                   `MTRCATEGORY` (είδη) και `LINCATEGORY` (δαπάνες, SODTYPE 53). */}
            <FormSection tone="slate" icon={<FiLayers />} title="Ταξινόμηση" aside="προαιρετικά">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <Field label={kind === 'lineitem' ? 'Κατηγορία δαπάνης' : 'Κατηγορία'} className={isItem ? 'col-span-12 sm:col-span-6' : 'col-span-12'}>
                  <FormSelect value={f.category} onChange={(v) => set('category', v)} opts={kind === 'lineitem' ? meta.lineCategories : meta.categories} ariaLabel="Κατηγορία" />
                </Field>
                {isItem && (
                  <Field label="Ομάδα" className="col-span-12 sm:col-span-6">
                    <FormSelect value={f.group} onChange={(v) => set('group', v)} opts={meta.groups} ariaLabel="Ομάδα" />
                  </Field>
                )}
              </div>
            </FormSection>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-auto px-5 py-4">
            {dryPayload != null
              ? <p className="text-[length:var(--fs-11)] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              : <p className="text-[length:var(--fs-11)] text-muted-foreground">Πάτησε «Προετοιμασία object» για να δεις τι θα σταλεί.</p>}
            {dryPayload != null && (
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[length:var(--fs-11-5)] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            )}
          </div>
        )}

        {/* `mx-0 mb-0`: το DialogFooter έχει `-mx-4 -mb-4` για modal με padding· εδώ είναι `p-0`. */}
        <DialogFooter className="mx-0 mb-0 flex-col gap-2 border-t border-border bg-card px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <label className={cn('flex items-center gap-2 text-[length:var(--fs-12)] text-muted-foreground',
            postingEnabled === false ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <input
              type="checkbox" checked={dryRun} disabled={postingEnabled === false}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-3.5 w-3.5 accent-sisyphus-600 disabled:opacity-50"
            />
            {postingEnabled === false
              ? 'Η καταχώριση στο SoftOne είναι κλειστή (Ρυθμίσεις → Διασυνδέσεις) — μόνο προετοιμασία object'
              : 'Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)'}
          </label>
          <div className="flex gap-2">
            {dryPayload != null && (
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(dryPayload, null, 2)); toast.success('Αντιγράφηκε'); }}>
                <FiCopy className="mr-1.5 h-4 w-4" /> Αντιγραφή JSON
              </Button>
            )}
            <Button onClick={submit} disabled={submitting || (needsTemplate && (!lisourceOk || !account.code))}>
              {submitting ? '…' : dryRun ? 'Προετοιμασία object' : 'Δημιουργία στο SoftOne'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
