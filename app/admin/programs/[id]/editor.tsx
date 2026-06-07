'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  FiSave, FiTrash2, FiPlus, FiX, FiGlobe, FiCalendar, FiDollarSign, FiPercent,
  FiClock, FiAlertCircle, FiHash, FiTag,
} from 'react-icons/fi';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QuestionnaireTab, type QuestionnaireData } from './questionnaire-tab';
import { PhasesTab } from './phases-tab';
import { OikonomikaPediaTab } from './oikonomika-pedia-tab';
import { ComputedCriteriaBuilder } from '@/components/admin/computed-criteria-builder';
import { AssessmentRunner } from '@/components/admin/assessment-runner';

interface Kad { id?: string; code: string; description?: string | null; excluded?: boolean }
interface Cat {
  id?: string; name: string;
  minAmount: number | null; minPercentage: number | null;
  maxAmount: number | null; maxPercentage: number | null;
  mandatory?: boolean;
  notes?: string | null;
}
interface Region { id?: string; name: string; fundingRate: number | null; notes?: string | null }
interface Criterion { id?: string; text: string }
interface Deadline { id?: string; deadline: string; description?: string | null }
interface LegalForm { id?: string; name: string; notes?: string | null }
interface Bonus {
  id?: string; kind?: string;
  name: string; condition: string;
  bonusRate: number | null; bonusAmount: number | null;
}
interface ProgFile {
  id: string; fileName: string; kind: string; label: string | null;
  mimeType: string; size: number; uploadedAt: string;
}

interface ProgramData {
  id: string; title: string; summary: string | null;
  publicationDate: string | null; submissionStart: string | null; submissionEnd: string | null;
  totalBudget: number | null; fundingRate: number | null; durationMonths: number | null;
  referenceCode: string | null; status: string; notes: string | null;
  kadRule: string; kadRuleNote: string | null;
  minEmployeesFte: number | null; minOperationalYears: number | null;
  eligibilityNote: string | null;
  extractStatus: string; errorMessage: string | null; model: string | null;
  kads: Kad[]; expenseCats: Cat[]; regions: Region[]; criteria: Criterion[]; deadlines: Deadline[];
  legalForms: LegalForm[]; bonuses: Bonus[]; files: ProgFile[];
  questionnaire?: any;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Πρόχειρο', REVIEWING: 'Σε επεξεργασία', PUBLISHED: 'Δημοσιευμένο', ARCHIVED: 'Αρχείο',
};

export function ProgramEditor({ program, canUpdate, canDelete, docTypes }: { program: ProgramData; canUpdate: boolean; canDelete: boolean; docTypes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [p, setP] = React.useState<ProgramData>(program);
  const [saving, setSaving] = React.useState(false);

  const set = (patch: Partial<ProgramData>) => setP((prev) => ({ ...prev, ...patch }));
  const dis = !canUpdate;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/programs/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: p.title, summary: p.summary,
          publicationDate: p.publicationDate, submissionStart: p.submissionStart, submissionEnd: p.submissionEnd,
          totalBudget: p.totalBudget, fundingRate: p.fundingRate, durationMonths: p.durationMonths,
          referenceCode: p.referenceCode, status: p.status,
          kadRule: p.kadRule as any, kadRuleNote: p.kadRuleNote,
          minEmployeesFte: p.minEmployeesFte, minOperationalYears: p.minOperationalYears,
          eligibilityNote: p.eligibilityNote,
          notes: p.notes,
          kads: p.kads.map((k) => ({ code: k.code, description: k.description, excluded: !!k.excluded })),
          expenseCats: p.expenseCats.map((c) => ({
            name: c.name,
            minAmount: c.minAmount, minPercentage: c.minPercentage,
            maxAmount: c.maxAmount, maxPercentage: c.maxPercentage,
            mandatory: !!c.mandatory,
            notes: c.notes,
          })),
          bonuses: p.bonuses.map((b) => ({
            kind: b.kind ?? 'OTHER',
            name: b.name, condition: b.condition,
            bonusRate: b.bonusRate, bonusAmount: b.bonusAmount,
          })),
          regions: p.regions.map((r) => ({ name: r.name, fundingRate: r.fundingRate, notes: r.notes })),
          criteria: p.criteria.map((c) => ({ text: c.text })),
          deadlines: p.deadlines.map((d) => ({ deadline: d.deadline, description: d.description })),
          legalForms: p.legalForms.map((lf) => ({ name: lf.name, notes: lf.notes })),
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε');
      router.refresh();
    } catch (err: any) { toast.error(`Σφάλμα: ${err?.message ?? err}`); }
    finally { setSaving(false); }
  }

  async function del() {
    if (!confirm('Διαγραφή προγράμματος και του PDF;')) return;
    const res = await fetch(`/api/admin/programs/${p.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Αποτυχία διαγραφής'); return; }
    toast.success('Διαγράφηκε');
    router.push('/admin/programs');
  }

  // Deadline countdown for hero badge.
  const deadlineLabel = (() => {
    if (!p.submissionEnd) return null;
    const days = Math.ceil((new Date(p.submissionEnd).getTime() - Date.now()) / (24 * 3600 * 1000));
    if (days < 0)  return { txt: `Έληξε πριν ${-days} ημέρες`,  tone: 'red'   as const };
    if (days <= 7) return { txt: `${days} ημέρες μέχρι λήξης`,  tone: 'red'   as const };
    if (days <= 30) return { txt: `${days} ημέρες μέχρι λήξης`, tone: 'amber' as const };
    return { txt: `${days} ημέρες μέχρι λήξης`, tone: 'green' as const };
  })();
  const toneClasses = {
    red:    'bg-dg-red-500/15 text-dg-red-700 border-dg-red-500/30',
    amber:  'bg-amber-500/15 text-amber-700 border-amber-500/30',
    green:  'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  };

  return (
    <div className="space-y-5 pb-24">
      {/* HERO HEADER */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-sisyphus-50 via-card to-card shadow-fluent-2">
        <div className="absolute right-0 top-0 size-40 -translate-y-20 translate-x-20 rounded-full bg-sisyphus-500/10 blur-3xl" />
        <div className="relative p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
                <FiGlobe className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <input
                  type="text" value={p.title} disabled={dis}
                  onChange={(e) => set({ title: e.target.value })}
                  className="w-full border-b-2 border-transparent bg-transparent text-title-2 font-bold tracking-tight outline-none focus:border-sisyphus-500 disabled:opacity-100"
                />
                <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                  {p.referenceCode && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-card px-1.5 py-0.5 font-mono text-[11px] border border-border">
                      <FiHash className="size-3" />{p.referenceCode}
                    </span>
                  )}
                  {p.model && <span className="font-mono text-[11px]">extracted by {p.model}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant={p.extractStatus === 'COMPLETED' ? 'default' : p.extractStatus === 'FAILED' ? 'destructive' : 'secondary'}>
                {p.extractStatus}
              </Badge>
              {deadlineLabel && (
                <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${toneClasses[deadlineLabel.tone]}`}>
                  <FiClock className="size-3" /> {deadlineLabel.txt}
                </span>
              )}
            </div>
          </div>

          {p.errorMessage && (
            <div className="flex items-start gap-2 rounded-md border border-dg-red-500/40 bg-dg-red-500/5 p-3 text-xs">
              <FiAlertCircle className="mt-0.5 size-3.5 shrink-0 text-dg-red-600" />
              <pre className="whitespace-pre-wrap break-words font-mono text-dg-red-700">{p.errorMessage}</pre>
            </div>
          )}

          {/* KPI strip — at-a-glance vitals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KpiCell icon={<FiDollarSign className="size-3.5" />} label="Π/Υ έργου" value={p.totalBudget != null ? new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(p.totalBudget) : '—'} />
            <KpiCell icon={<FiPercent className="size-3.5" />}    label="Επιχορήγηση" value={p.fundingRate != null ? `${Number(p.fundingRate).toFixed(0)}%` : '—'} />
            <KpiCell icon={<FiCalendar className="size-3.5" />}   label="Διάρκεια" value={p.durationMonths != null ? `${p.durationMonths} μήνες` : '—'} />
            <KpiCell icon={<FiTag className="size-3.5" />}        label="Min ΕΜΕ" value={p.minEmployeesFte != null ? String(p.minEmployeesFte) : '—'} />
            <KpiCell icon={<FiClock className="size-3.5" />}      label="Min έτη" value={p.minOperationalYears != null ? String(p.minOperationalYears) : '—'} />
            <KpiCell icon={<FiHash className="size-3.5" />}       label="Νομ. μορφές" value={String(p.legalForms.length)} />
          </div>
        </div>
      </section>

      {/* SUMMARY */}
      <section className="rounded-xl border border-border bg-card shadow-fluent-2">
        <header className="border-b border-border px-5 py-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Περίληψη προγράμματος</h3>
          <p className="text-[11px] text-muted-foreground">Στόχος, ωφελούμενοι, βασική φιλοσοφία</p>
        </header>
        <div className="p-5">
          <textarea
            value={p.summary ?? ''} disabled={dis} rows={5}
            placeholder="Δεν έχει εξαχθεί περίληψη — μπορείτε να γράψετε εδώ."
            onChange={(e) => set({ summary: e.target.value })}
            className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-relaxed focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
          />
        </div>
      </section>

      {/* TWO-COLUMN: Στοιχεία πρόσκλησης + Π/Υ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="Στοιχεία πρόσκλησης" subtitle="Κωδικός, ημερομηνίες, κατάσταση" icon={<FiCalendar className="size-4" />}>
          <Field label="Κωδικός αναφοράς"><Input value={p.referenceCode ?? ''} disabled={dis} onChange={(v) => set({ referenceCode: v })} /></Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Δημοσίευση"><Input type="date" value={p.publicationDate ?? ''} disabled={dis} onChange={(v) => set({ publicationDate: v || null })} /></Field>
            <Field label="Έναρξη υποβολής"><Input type="date" value={p.submissionStart ?? ''} disabled={dis} onChange={(v) => set({ submissionStart: v || null })} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Λήξη υποβολής"><Input type="date" value={p.submissionEnd ?? ''} disabled={dis} onChange={(v) => set({ submissionEnd: v || null })} /></Field>
            <Field label="Κατάσταση">
              <select disabled={dis} value={p.status} onChange={(e) => set({ status: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20">
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Προϋπολογισμός & επιχορήγηση" subtitle="Χρηματοδότηση & διάρκεια έργου" icon={<FiDollarSign className="size-4" />}>
          <Field label="Συνολικός προϋπολογισμός (€)"><Input type="number" value={p.totalBudget ?? ''} disabled={dis} onChange={(v) => set({ totalBudget: v === '' ? null : Number(v) })} /></Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Ποσοστό επιχορήγησης (%)"><Input type="number" value={p.fundingRate ?? ''} disabled={dis} onChange={(v) => set({ fundingRate: v === '' ? null : Number(v) })} /></Field>
            <Field label="Διάρκεια (μήνες)"><Input type="number" value={p.durationMonths ?? ''} disabled={dis} onChange={(v) => set({ durationMonths: v === '' ? null : Number(v) })} /></Field>
          </div>
          <Field label="Εσωτερικές σημειώσεις" full>
            <textarea value={p.notes ?? ''} disabled={dis} rows={3}
              placeholder="Σχόλια ομάδας, παρατηρήσεις…"
              onChange={(e) => set({ notes: e.target.value })}
              className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
            />
          </Field>
        </SectionCard>
      </div>

      {/* Eligibility prerequisites */}
      <SectionCard
        title="Προϋποθέσεις δικαιούχου"
        subtitle="Ελάχιστες απαιτήσεις για συμμετοχή"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Ελάχιστες ΕΜΕ (Ετήσιες Μονάδες Εργασίας)">
            <Input
              type="number" value={p.minEmployeesFte ?? ''} disabled={dis}
              onChange={(v) => set({ minEmployeesFte: v === '' ? null : Number(v) })}
            />
          </Field>
          <Field label="Ελάχιστες διαχειριστικές χρήσεις (έτη)">
            <Input
              type="number" value={p.minOperationalYears ?? ''} disabled={dis}
              onChange={(v) => set({ minOperationalYears: v === '' ? null : Number(v) })}
            />
          </Field>
        </div>
        <Field label="Σύνοψη προϋποθέσεων (από PDF)" full>
          <textarea
            value={p.eligibilityNote ?? ''} disabled={dis} rows={2}
            placeholder="π.χ. Επιχειρήσεις με τουλάχιστον μία πλήρη διαχειριστική χρήση και ελάχιστο μέσο όρο ΕΜΕ 0,5"
            onChange={(e) => set({ eligibilityNote: e.target.value })}
            className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
          />
        </Field>
      </SectionCard>

      {/* TABS for nested arrays */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
        <header className="border-b border-border px-5 py-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Λεπτομέρειες προγράμματος</h3>
          <p className="text-[11px] text-muted-foreground">Επιλέξιμοι ΚΑΔ, νομικές μορφές, κατηγορίες δαπανών, περιφέρειες, κριτήρια, προθεσμίες</p>
        </header>
        <Tabs defaultValue="kads" className="flex w-full !flex-col">
          <div className="border-b border-border px-3 pt-3">
            <TabsList className="flex h-auto flex-wrap gap-1 self-start">
              <TabsTrigger value="kads">ΚΑΔ <Badge variant="outline">{p.kads.length}</Badge></TabsTrigger>
              <TabsTrigger value="legalForms">Νομικές μορφές <Badge variant="outline">{p.legalForms.length}</Badge></TabsTrigger>
              <TabsTrigger value="expenses">Δαπάνες <Badge variant="outline">{p.expenseCats.length}</Badge></TabsTrigger>
              <TabsTrigger value="bonuses">Bonuses <Badge variant="outline">{p.bonuses.length}</Badge></TabsTrigger>
              <TabsTrigger value="regions">Περιφέρειες <Badge variant="outline">{p.regions.length}</Badge></TabsTrigger>
              <TabsTrigger value="criteria">Κριτήρια <Badge variant="outline">{p.criteria.length}</Badge></TabsTrigger>
              <TabsTrigger value="deadlines">Προθεσμίες <Badge variant="outline">{p.deadlines.length}</Badge></TabsTrigger>
              <TabsTrigger value="files">Αρχεία <Badge variant="outline">{p.files.length}</Badge></TabsTrigger>
              <TabsTrigger value="questionnaire">Αυτοαξιολόγηση{program.questionnaire ? <Badge variant="outline">{program.questionnaire.questions.length}</Badge> : null}</TabsTrigger>
              <TabsTrigger value="oikonomika-pedia">Οικονομικά πεδία</TabsTrigger>
              <TabsTrigger value="computed-criteria">Αξιολόγηση (Υπολογισμός)</TabsTrigger>
              <TabsTrigger value="assess">Εκτέλεση Αξιολόγησης</TabsTrigger>
              <TabsTrigger value="phases">Φάσεις & Δικαιολογητικά</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="kads" className="w-full space-y-3 p-4">
            <div className="rounded-md border border-sisyphus-500/30 bg-sisyphus-500/5 p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Κανόνας ΚΑΔ</span>
                  <select
                    disabled={dis}
                    value={p.kadRule}
                    onChange={(e) => set({ kadRule: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="UNSPECIFIED">Δεν διευκρινίζεται</option>
                    <option value="ALL_EXCEPT_LISTED">Όλοι ΕΚΤΟΣ από τους εξαιρούμενους</option>
                    <option value="ONLY_LISTED">Μόνο οι ρητά αναφερόμενοι (allow-list)</option>
                    <option value="MIXED">Συνδυασμός (allow + deny)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Σχόλιο διατύπωσης (από PDF)</span>
                  <input
                    type="text" disabled={dis} value={p.kadRuleNote ?? ''}
                    onChange={(e) => set({ kadRuleNote: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                </label>
              </div>
              {p.kadRule === 'ALL_EXCEPT_LISTED' && (
                <p className="text-[12px] text-foreground">
                  ✓ <strong>Όλοι οι ΚΑΔ είναι επιλέξιμοι</strong> εκτός από όσους έχουν flag "Εξαιρ." παρακάτω.
                </p>
              )}
              {p.kadRule === 'ONLY_LISTED' && (
                <p className="text-[12px] text-foreground">
                  ✓ <strong>Επιλέξιμοι μόνο</strong> οι ρητά αναφερόμενοι ΚΑΔ παρακάτω (χωρίς το flag "Εξαιρ.").
                </p>
              )}
            </div>
            <ListEditor
              items={p.kads} disabled={dis}
              onChange={(items) => set({ kads: items })}
              empty={{ code: '', description: '', excluded: false }}
              columns={[
                { key: 'code', label: 'Κωδικός', width: '140px' },
                { key: 'description', label: 'Περιγραφή' },
                { key: 'excluded', label: 'Εξαιρ.', width: '70px', type: 'boolean' },
              ]}
            />
          </TabsContent>

          <TabsContent value="legalForms" className="w-full p-4">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Νομικές μορφές δικαιούχων (π.χ. <strong>ΙΚΕ, ΕΠΕ, ΑΕ, ΟΕ, ΕΕ, Ατομική, ΚοινΣΕπ</strong>).
              Πρόσθεσε όσες δέχεται η πρόσκληση.
            </p>
            <ListEditor
              items={p.legalForms} disabled={dis}
              onChange={(items) => set({ legalForms: items })}
              empty={{ name: '', notes: '' }}
              columns={[
                { key: 'name', label: 'Νομική μορφή', width: '200px' },
                { key: 'notes', label: 'Σημείωση' },
              ]}
            />
          </TabsContent>

          <TabsContent value="expenses" className="w-full p-4">
            <ListEditor
              items={p.expenseCats} disabled={dis}
              onChange={(items) => set({ expenseCats: items })}
              empty={{ name: '', minAmount: null, minPercentage: null, maxAmount: null, maxPercentage: null, mandatory: false, notes: '' }}
              columns={[
                { key: 'name',          label: 'Κατηγορία' },
                { key: 'mandatory',     label: 'Υποχρ.', width: '70px',  type: 'boolean' },
                { key: 'minAmount',     label: 'Min €',  width: '100px', type: 'number' },
                { key: 'minPercentage', label: 'Min %',  width: '80px',  type: 'number' },
                { key: 'maxAmount',     label: 'Max €',  width: '100px', type: 'number' },
                { key: 'maxPercentage', label: 'Max %',  width: '80px',  type: 'number' },
                { key: 'notes',         label: 'Σημείωση' },
              ]}
            />
          </TabsContent>

          <TabsContent value="bonuses" className="w-full p-4">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Επιπλέον ποσοστά επιχορήγησης ή ποσά που χορηγούνται όταν πληρούνται ειδικές προϋποθέσεις (π.χ. <strong>γρήγορη ολοκλήρωση</strong>, νέες θέσεις εργασίας, καινοτομία).
            </p>
            <ListEditor
              items={p.bonuses} disabled={dis}
              onChange={(items) => set({ bonuses: items })}
              empty={{ kind: 'OTHER', name: '', condition: '', bonusRate: null, bonusAmount: null }}
              columns={[
                { key: 'kind',        label: 'Τύπος', width: '160px', type: 'select',
                  options: [
                    { value: 'TIME_BASED',     label: 'Γρήγορη ολοκλήρωση' },
                    { value: 'EMPLOYMENT',     label: 'Απασχόληση' },
                    { value: 'SUSTAINABILITY', label: 'Πράσινες δαπάνες' },
                    { value: 'WOMEN_LED',      label: 'Γυναικεία επιχ.' },
                    { value: 'YOUTH',          label: 'Νεανική επιχ.' },
                    { value: 'R_AND_D',        label: 'Έρευνα & ανάπτυξη' },
                    { value: 'OTHER',          label: 'Άλλο' },
                  ],
                },
                { key: 'name',        label: 'Ονομασία', width: '180px' },
                { key: 'condition',   label: 'Συνθήκη' },
                { key: 'bonusRate',   label: 'Bonus %', width: '90px', type: 'number' },
                { key: 'bonusAmount', label: 'Bonus €', width: '110px', type: 'number' },
              ]}
            />
          </TabsContent>

          <TabsContent value="files" className="w-full p-4 space-y-3">
            <ProgramFileManager programId={p.id} files={p.files} disabled={dis} />
          </TabsContent>

          <TabsContent value="regions" className="w-full p-4">
            <ListEditor
              items={p.regions} disabled={dis}
              onChange={(items) => set({ regions: items })}
              empty={{ name: '', fundingRate: null, notes: '' }}
              columns={[
                { key: 'name', label: 'Περιφέρεια' },
                { key: 'fundingRate', label: 'Επιχ. %', width: '120px', type: 'number' },
                { key: 'notes', label: 'Σημείωση' },
              ]}
            />
          </TabsContent>

          <TabsContent value="criteria" className="w-full p-4">
            <ListEditor
              items={p.criteria} disabled={dis}
              onChange={(items) => set({ criteria: items })}
              empty={{ text: '' }}
              columns={[{ key: 'text', label: 'Κριτήριο' }]}
            />
          </TabsContent>

          <TabsContent value="deadlines" className="w-full p-4">
            <ListEditor
              items={p.deadlines} disabled={dis}
              onChange={(items) => set({ deadlines: items })}
              empty={{ deadline: '', description: '' }}
              columns={[
                { key: 'deadline', label: 'Ημερομηνία', width: '160px', type: 'date' },
                { key: 'description', label: 'Περιγραφή' },
              ]}
            />
          </TabsContent>

          <TabsContent value="questionnaire" className="w-full p-4">
            <QuestionnaireTab
              programId={p.id}
              initial={program.questionnaire ? {
                scoringModel: program.questionnaire.scoringModel,
                threshold: program.questionnaire.threshold == null ? null : Number(program.questionnaire.threshold),
                maxScore: program.questionnaire.maxScore == null ? null : Number(program.questionnaire.maxScore),
                sourceNote: program.questionnaire.sourceNote ?? null,
                questions: program.questionnaire.questions.map((qq: any) => ({
                  code: qq.code ?? null, text: qq.text, criterionRef: qq.criterionRef ?? null, helpText: qq.helpText ?? null,
                  answerType: qq.answerType, weight: qq.weight == null ? null : Number(qq.weight),
                  maxPoints: qq.maxPoints == null ? null : Number(qq.maxPoints), companyField: qq.companyField ?? null,
                  options: (qq.options ?? []).map((o: any) => ({ label: o.label, points: Number(o.points) })),
                })),
              } : null}
            />
          </TabsContent>

          <TabsContent value="oikonomika-pedia" className="w-full p-4">
            <OikonomikaPediaTab programId={p.id} />
          </TabsContent>

          <TabsContent value="computed-criteria" className="w-full p-4">
            <ComputedCriteriaBuilder programId={p.id} />
          </TabsContent>

          <TabsContent value="assess" className="w-full p-4">
            <AssessmentRunner programId={p.id} />
          </TabsContent>

          <TabsContent value="phases" className="w-full p-4">
            <PhasesTab programId={p.id} docTypes={docTypes} canManage={canUpdate} />
          </TabsContent>
        </Tabs>
      </section>

      {/* FOOTER ACTIONS */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-fluent-16 backdrop-blur">
        <span className="text-[11px] text-muted-foreground">
          {canUpdate ? 'Οι αλλαγές αποθηκεύονται μόνο μετά το κουμπί.' : 'Read-only — δεν έχετε δικαίωμα επεξεργασίας.'}
        </span>
        <div className="flex gap-2">
        {canDelete && (
          <button type="button" onClick={del}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dg-red-500/40 bg-dg-red-500/5 px-3 text-sm font-medium text-dg-red-700 transition hover:bg-dg-red-500/10">
            <FiTrash2 className="size-4" /> Διαγραφή
          </button>
        )}
        {canUpdate && (
          <button type="button" disabled={saving} onClick={save}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sisyphus-500 px-4 text-sm font-semibold text-white shadow-fluent-2 transition hover:bg-sisyphus-600 active:bg-sisyphus-700 disabled:opacity-60">
            <FiSave className="size-4" /> {saving ? 'Αποθήκευση…' : 'Αποθήκευση αλλαγών'}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

function KpiCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="text-sisyphus-600">{icon}</span>
        {label}
      </div>
      <p className="mt-0.5 truncate text-[15px] font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function SectionCard({
  title, subtitle, icon, children,
}: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
      <header className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        {icon && (
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-sisyphus-500/10 text-sisyphus-600">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={full ? 'block' : 'flex flex-col gap-1'}>
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Input({ value, disabled, type, onChange }: { value: any; disabled?: boolean; type?: string; onChange: (v: string) => void }) {
  return (
    <input
      type={type ?? 'text'}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
    />
  );
}

interface Column {
  key: string; label: string; width?: string;
  type?: 'text' | 'number' | 'date' | 'boolean' | 'select';
  options?: Array<{ value: string; label: string }>;
}

function ListEditor<T extends Record<string, any>>({
  items, disabled, onChange, empty, columns,
}: {
  items: T[];
  disabled?: boolean;
  onChange: (items: T[]) => void;
  empty: T;
  columns: Column[];
}) {
  const addRow = () => onChange([...items, { ...empty }]);
  const updateRow = (idx: number, key: string, raw: string | boolean) => {
    const col = columns.find((c) => c.key === key);
    let value: any = raw;
    if (col?.type === 'number') value = raw === '' ? null : Number(raw);
    if (col?.type === 'date')    value = raw || null;
    if (col?.type === 'boolean') value = !!raw;
    const next = items.map((it, i) => (i === idx ? { ...it, [key]: value } : it));
    onChange(next);
  };
  const removeRow = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-input bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          Δεν υπάρχουν εγγραφές. Πρόσθεσε με το κουμπί παρακάτω.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-neutral-6/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {columns.map((c) => <th key={c.key} className="px-2 py-1.5" style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
                <th className="w-10 px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it, idx) => (
                <tr key={idx}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {c.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={!!it[c.key]}
                          disabled={disabled}
                          onChange={(e) => updateRow(idx, c.key, e.target.checked)}
                          className="size-4 accent-sisyphus-500"
                        />
                      ) : c.type === 'select' ? (
                        <select
                          value={it[c.key] ?? ''}
                          disabled={disabled}
                          onChange={(e) => updateRow(idx, c.key, e.target.value)}
                          className="h-8 w-full rounded-sm border border-transparent bg-transparent px-1 text-[13px] hover:border-input focus:border-sisyphus-500 focus:outline-none"
                        >
                          {c.options?.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={c.type ?? 'text'}
                          value={it[c.key] ?? ''}
                          disabled={disabled}
                          onChange={(e) => updateRow(idx, c.key, e.target.value)}
                          className="h-8 w-full rounded-sm border border-transparent bg-transparent px-1.5 text-[13px] hover:border-input focus:border-sisyphus-500 focus:outline-none"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    {!disabled && (
                      <button type="button" onClick={() => removeRow(idx)}
                        className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Αφαίρεση">
                        <FiX className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!disabled && (
        <button type="button" onClick={addRow}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-3 text-xs font-medium text-foreground hover:border-sisyphus-500 hover:bg-sisyphus-500/5">
          <FiPlus className="size-3.5" /> Νέα εγγραφή
        </button>
      )}
    </div>
  );
}


function ProgramFileManager({
  programId, files, disabled,
}: { programId: string; files: ProgFile[]; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [kind, setKind] = React.useState<'ANNEX' | 'CLARIFICATION' | 'AMENDMENT' | 'OTHER'>('ANNEX');
  const [label, setLabel] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('kind', kind);
      if (label.trim()) fd.set('label', label.trim());
      const res = await fetch(`/api/admin/programs/${programId}/files`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('Το αρχείο προστέθηκε');
      setLabel('');
      router.refresh();
    } catch (err: any) { toast.error(`Σφάλμα: ${err?.message ?? err}`); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function remove(fileId: string, fileName: string) {
    if (!confirm(`Διαγραφή του αρχείου "${fileName}";`)) return;
    const res = await fetch(`/api/admin/programs/${programId}/files/${fileId}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Αποτυχία διαγραφής'); return; }
    toast.success('Διαγράφηκε');
    router.refresh();
  }

  const kindLabel: Record<string, string> = {
    MAIN: 'Κύριος οδηγός', ANNEX: 'Παράρτημα', CLARIFICATION: 'Διευκρινίσεις', AMENDMENT: 'Τροποποίηση', OTHER: 'Άλλο',
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground">
        Πρόσθεσε επιπλέον PDF (παραρτήματα, διευκρινίσεις, τροποποιήσεις). Στο επόμενο <strong>επανανάλυση</strong>, η AI θα διαβάσει ΟΛΑ τα αρχεία μαζί.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-neutral-6/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Αρχείο</th>
              <th className="px-3 py-2 w-32">Τύπος</th>
              <th className="px-3 py-2 w-24 text-right">Μέγεθος</th>
              <th className="px-3 py-2 w-32">Ανέβηκε</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {files.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[12px] text-muted-foreground">Δεν υπάρχουν αρχεία ακόμη.</td></tr>
            ) : files.map((f) => (
              <tr key={f.id} className="hover:bg-neutral-6/40">
                <td className="px-3 py-2">
                  <a href={`/api/admin/programs/${programId}/files/${f.id}`} target="_blank" rel="noreferrer" className="font-medium text-sisyphus-600 hover:underline">{f.fileName}</a>
                  {f.label && <div className="text-[11px] text-muted-foreground">{f.label}</div>}
                </td>
                <td className="px-3 py-2"><Badge variant={f.kind === 'MAIN' ? 'default' : 'outline'}>{kindLabel[f.kind] ?? f.kind}</Badge></td>
                <td className="px-3 py-2 text-right tabular-nums text-[11px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums">{new Date(f.uploadedAt).toLocaleDateString('el-GR')}</td>
                <td className="px-3 py-2 text-right">
                  {!disabled && f.kind !== 'MAIN' && (
                    <button type="button" onClick={() => remove(f.id, f.fileName)}
                      className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-dg-red-500/10 hover:text-dg-red-600" title="Διαγραφή">
                      <FiX className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div className="rounded-md border border-dashed border-input bg-neutral-6/30 p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Προσθήκη νέου αρχείου</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Τύπος</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as any)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="ANNEX">Παράρτημα</option>
                <option value="CLARIFICATION">Διευκρινίσεις</option>
                <option value="AMENDMENT">Τροποποίηση</option>
                <option value="OTHER">Άλλο</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 min-w-[180px]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ετικέτα (προαιρετικό)</span>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="π.χ. Παράρτημα IV — ΚΑΔ εξαιρέσεις"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:border-sisyphus-500 focus:outline-none" />
            </label>
            <label className={`inline-flex h-9 items-center gap-1.5 rounded-md ${busy ? 'bg-sisyphus-500/30 text-sisyphus-600' : 'bg-sisyphus-500 text-white hover:bg-sisyphus-600'} px-3 text-sm font-semibold transition cursor-pointer`}>
              <FiPlus className="size-4" /> {busy ? 'Ανέβασμα…' : 'Προσθήκη'}
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
                className="absolute opacity-0 size-0" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

