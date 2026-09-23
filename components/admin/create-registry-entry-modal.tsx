'use client';

import * as React from 'react';
import {
  FiAlertTriangle, FiCheck, FiCode, FiCopy, FiDollarSign, FiEdit3, FiPackage, FiSearch, FiTag, FiTool,
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
import { matchUnit, unitOptions } from '@/lib/ocr/unit-match';
import { LINE_KIND_LABEL } from '@/lib/ocr/resolution-plan';
import { parseLisourceType } from '@/lib/ocr/lineitem-create';
import type { MatchKind } from '@/lib/ocr/line-match';

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
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder={ph} /></SelectTrigger>
        <SelectContent className="max-h-72">
          {opts.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">— κενό —</div>}
          {opts.map((o) => <SelectItem key={o.id} value={o.id} className="text-[13px]">{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function Note({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'bad' | 'ok' }) {
  const color = tone === 'bad' ? '#B91C1C' : tone === 'ok' ? '#047857' : '#B45309';
  return (
    <span className="flex items-start gap-1 text-[11px]" style={{ color }}>
      {tone !== 'ok' && <FiAlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
      {tone === 'ok' && <FiCheck aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
      {children}
    </span>
  );
}

/** Μικρό combobox πάνω στο λογιστικό σχέδιο — μόνο ΚΙΝΟΥΜΕΝΟΙ λογαριασμοί (τους φιλτράρει ο server). */
function AccountPicker({
  id, value, onPick, disabled,
}: { id: string; value: string; onPick: (a: { code: string; name: string }) => void; disabled?: boolean }) {
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<{ id: number; code: string; name: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    let ignore = false;
    const h = setTimeout(() => {
      fetch(`/api/admin/softone/search?type=accounts&q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => { if (!ignore) { setRows(d.results ?? []); setOpen(true); } })
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
          className="h-9 pl-8 text-[13px]" autoComplete="off"
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
                <span className="line-clamp-1 text-[13px] font-medium text-foreground">{r.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{r.code}</span>
              </button>
            </li>
          ))}
        </ul>
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
  open, onOpenChange, kind, lineId, initialCode, initialName, initialVatRate, initialUnit, onCreated,
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
  const proposed = React.useRef<string | null>(null);
  const [f, setF] = React.useState<FormState>({ code: '', name: '', vat: '', unit: '', price: '', group: '', category: '' });

  const isItem = kind === 'product' || kind === 'service';
  // Η μονάδα ζει στο `MTRL`, άρα αφορά ΚΑΙ τη χρεοπίστωση· το έξοδο (`EXPN`) δεν έχει μονάδα.
  const hasUnit = kind !== 'expense';
  const needsTemplate = kind === 'lineitem';

  React.useEffect(() => {
    if (!open) return;
    setTab('form'); setDryPayload(null); setDryRun(true);
    setCodeError(null); setCodeOffer(null); setCodeSource(null);
    setTemplate(null); setTemplateIssue(null);
    setAccount({ code: '', name: null }); setAccountVerdict(null);
    setF({ code: initialCode ?? '', name: initialName ?? '', vat: '', unit: '', price: '', group: '', category: '' });
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
        setF((s) => ({ ...s, vat: vatHit?.id ?? '', unit: unitHit?.code ?? '' }));
      })
      .catch(() => setMeta(EMPTY_META));
  }, [open, kind, initialCode, initialName, initialVatRate, initialUnit]);

  /**
   * Προτεινόμενος κωδικός ΤΟΥ μητρώου που θα γραφτεί. Για χρεοπίστωση με επιλεγμένο λογαριασμό,
   * ο server προτείνει **τον λογαριασμό** όταν η εγκατάσταση ακολουθεί αυτή τη σύμβαση.
   */
  React.useEffect(() => {
    if (!open) return;
    let ignore = false;
    const sc = initialCode ? `&supplierCode=${encodeURIComponent(initialCode)}` : '';
    const acc = kind === 'lineitem' && account.code ? `&account=${encodeURIComponent(account.code)}` : '';
    fetch(`/api/admin/ocr/new-items/next-code?kind=${kind}${sc}${acc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null; source?: string } | null) => {
        if (ignore || !d?.code) return;
        setCodeSource(d.source ?? null);
        setF((s) => (s.code === '' || s.code === proposed.current ? { ...s, code: d.code as string } : s));
        proposed.current = d.code;
      })
      .catch(() => null);
    return () => { ignore = true; };
  }, [open, kind, initialCode, account.code]);

  const set = (k: keyof FormState, v: string) => setF((s) => ({ ...s, [k]: v }));

  const body = React.useCallback((overrides: Partial<{ dryRun: boolean }> = {}) => ({
    kind,
    code: f.code.trim() || '—',
    name: f.name.trim() || '—',
    vat: f.vat || null,
    unit: hasUnit ? (f.unit || null) : null,
    price: isItem && f.price ? Number(f.price) : null,
    group: isItem ? (f.group || null) : null,
    category: f.category || null,
    templateMtrl: needsTemplate ? (template?.mtrl ?? null) : null,
    acnmsk: needsTemplate ? (account.code || null) : null,
    lineId: lineId ?? null,
    supplierCode: initialCode || null,
    dryRun: true,
    ...overrides,
  }), [kind, f, hasUnit, isItem, needsTemplate, template, account.code, lineId, initialCode]);

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
    if (!f.name.trim() || !f.code.trim()) { toast.error('Συμπλήρωσε Περιγραφή και Κωδικό.'); return; }
    if (isItem && (!f.vat || !f.unit)) { toast.error('Για είδος/υπηρεσία χρειάζονται ΦΠΑ και μονάδα.'); return; }
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
        <DialogHeader className="gap-1 border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2.5 text-[15px]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600">{KIND_ICON[kind]}</span>
            Νέα εγγραφή: {LINE_KIND_LABEL[kind]}
          </DialogTitle>
          <DialogDescription className="text-[12px]">{KIND_WHERE[kind]}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border bg-muted/30 px-5 py-2">
          {([['form', 'Στοιχεία', <FiEdit3 key="a" className="h-3.5 w-3.5" />], ['object', 'Αντικείμενο', <FiCode key="b" className="h-3.5 w-3.5" />]] as const).map(([v, lbl, ic]) => (
            <button key={v} onClick={() => setTab(v)} type="button"
              className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                tab === v ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              {ic} {lbl}
            </button>
          ))}
        </div>

        {!meta ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">Φόρτωση πινάκων…</div>
        ) : tab === 'form' ? (
          <div className="max-h-[60vh] space-y-5 overflow-auto px-5 py-4">
            {needsTemplate && (
              <section className="space-y-2 rounded-xl border border-sisyphus-200 bg-sisyphus-50/40 p-3">
                <p className="text-[11px] font-medium text-sisyphus-700">
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
                    <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                      <FiCheck className="h-3.5 w-3.5" /> Πρότυπο: <span className="font-medium">{template.code} — {template.name}</span>
                    </p>
                    <div className="rounded-lg border border-border bg-card p-2 text-[11px]">
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Λογαριασμός γενικής λογιστικής <span className="text-destructive">*</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Εκεί θα χρεωθεί κάθε γραμμή αυτής της χρεοπίστωσης. Προτείνεται ο λογαριασμός του
                  προτύπου — <strong>έλεγξέ τον</strong>: λάθος λογαριασμός δεν φαίνεται πουθενά μετά.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[12px]">
                    {account.code || '— κανένας —'}
                  </span>
                  {(account.name || accountVerdict?.accountName) && (
                    <span className="text-[12px] text-foreground">{account.name ?? accountVerdict?.accountName}</span>
                  )}
                </div>
                <AccountPicker
                  id="lineitem-account" value={account.code}
                  onPick={(a) => { setAccount({ code: a.code, name: a.name }); void revalidate(a.code); }}
                />
                {accountVerdict && (accountOk
                  ? <Note tone="ok">Ο λογαριασμός υπάρχει στο σχέδιο και κινείται.</Note>
                  : <Note tone={accountVerdict.status === 'unknown' ? 'warn' : 'bad'}>{accountVerdict.message ?? accountVerdict.status}</Note>
                )}
              </section>
            )}

            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Βασικά στοιχεία</p>
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Περιγραφή <span className="text-destructive">*</span></span>
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} className="h-9 text-[13px]" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Κωδικός <span className="text-destructive">*</span></span>
                  <Input value={f.code} onChange={(e) => { set('code', e.target.value); setCodeError(null); }}
                    aria-invalid={codeError ? true : undefined} className="h-9 font-mono text-[13px]" />
                  {codeError ? (
                    <span className="text-[11px]" style={{ color: '#B91C1C' }}>
                      {codeError}
                      {codeOffer && (
                        <button type="button" onClick={() => { set('code', codeOffer); setCodeError(null); }}
                          className="ml-1.5 cursor-pointer font-semibold underline">Χρήση του {codeOffer}</button>
                      )}
                    </span>
                  ) : codeSource === 'account' ? (
                    <span className="text-[11px] text-muted-foreground">
                      Ο κωδικός ακολουθεί τον λογαριασμό γενικής — έτσι είναι φτιαγμένο το μητρώο αυτής
                      της εγκατάστασης (μία χρεοπίστωση ανά λογαριασμό).
                    </span>
                  ) : null}
                </label>
                {isItem && (
                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Τιμή χονδρικής (από τη γραμμή)</span>
                    <Input value={f.price} onChange={(e) => set('price', e.target.value)} type="number" placeholder="0,00" className="h-9 text-[13px]" />
                  </label>
                )}
                <div className="grid gap-1.5">
                  <Combo label={`Φ.Π.Α.${isItem ? ' *' : ''}`} value={f.vat} onChange={(v) => set('vat', v)} opts={meta.vats} ph="Επίλεξε ΦΠΑ" />
                  {vatNote && <Note>{vatNote}</Note>}
                </div>
                {hasUnit && (
                  <div className="grid gap-1.5">
                    <Combo label={`Μονάδα${isItem ? ' *' : ''}`} value={f.unit} onChange={(v) => set('unit', v)} opts={orderedUnits}
                      ph={kind === 'lineitem' ? 'Κενό = όπως το πρότυπο' : 'Επίλεξε μονάδα'} />
                    {unitNote && <Note>{unitNote}</Note>}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ταξινόμηση (προαιρετικά)</p>
              <div className="grid grid-cols-2 gap-3">
                {/* Οι δύο κατάλογοι είναι ΔΙΑΦΟΡΕΤΙΚΟΙ πίνακες: `MTRCATEGORY` (είδη) και
                    `LINCATEGORY` (δαπάνες, SODTYPE 53). Μια χρεοπίστωση σε κατηγορία ειδών δεν
                    βρίσκεται ποτέ ξανά από το φίλτρο «κατηγορία δαπάνης» του picker. */}
                <Combo
                  label={kind === 'lineitem' ? 'Κατηγορία δαπάνης' : 'Κατηγορία'}
                  value={f.category} onChange={(v) => set('category', v)}
                  opts={kind === 'lineitem' ? meta.lineCategories : meta.categories}
                />
                {isItem && <Combo label="Ομάδα" value={f.group} onChange={(v) => set('group', v)} opts={meta.groups} />}
              </div>
            </section>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-auto px-5 py-4">
            {dryPayload != null
              ? <p className="text-[11px] font-medium text-emerald-700">Object από τον server (dry-run) — αυτό ακριβώς θα σταλεί στο SoftOne:</p>
              : <p className="text-[11px] text-muted-foreground">Πάτησε «Προετοιμασία object» για να δεις τι θα σταλεί.</p>}
            {dryPayload != null && (
              <pre className="overflow-auto rounded-xl border border-border bg-[#0E1626] p-4 font-mono text-[11.5px] leading-relaxed text-[#d6e2f5]">{JSON.stringify(dryPayload, null, 2)}</pre>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="h-3.5 w-3.5 accent-sisyphus-600" />
            Δοκιμή — μόνο προετοιμασία object (χωρίς αποστολή)
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
