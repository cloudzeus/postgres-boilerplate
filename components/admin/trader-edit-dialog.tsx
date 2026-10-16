'use client';

// Τροποποίηση συναλλασσομένου στη SoftOne, με εξακρίβωση από ΑΑΔΕ (ελληνικό ΑΦΜ) ή VIES (ξένο).
//
// Ροή: ζωντανή ανάγνωση της καρτέλας → (προαιρετικά) σύγκριση με ΑΑΔΕ/VIES και εφαρμογή επιλεγμένων
// πεδίων στη φόρμα → «Προεπισκόπηση»: ακριβώς ποια πεδία αλλάζουν (από → σε) → «Αποθήκευση στη
// SoftOne» → νέα ανάγνωση: ό,τι δεν κράτησε η SoftOne εμφανίζεται ρητά.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiEdit3, FiGlobe, FiLoader, FiMapPin, FiPhone, FiShield, FiUser } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormSection, FormSelect, RowHint, fieldCls } from '@/components/admin/form-kit';
import { ViesCheck, type ViesCheckResult } from '@/components/admin/vies-check';
import { isValidAfm } from '@/lib/ocr/validate';
import { cn } from '@/lib/utils';

export type TraderDialogMode = 'edit' | 'aade' | 'vies';
type Key = 'name' | 'afm' | 'irsData' | 'profession' | 'address' | 'district' | 'zip' | 'city' | 'country' | 'phone' | 'phone2' | 'fax' | 'email' | 'webpage';
type Values = Partial<Record<Key, string | null>> & { kad?: number | null; kad1?: number | null };
interface Loaded {
  trdr: number; sodtype: number; code: string; values: Values; editable: boolean;
  kadLabels: { kad: string | null; kad1: string | null };
  offices: { key: string; code: string; name: string }[];
  countries: { id: string; name: string; shortcut: string }[];
}
interface Proposal { key: Key | 'kad' | 'kad1'; label: string; value: string | number | null; display: string; note?: string | null }
type Change = { key: string; label: string; from: string | null; to: string | null };

const LABEL: Record<Key, string> = {
  name: 'Επωνυμία', afm: 'Α.Φ.Μ.', irsData: 'Δ.Ο.Υ.', profession: 'Επάγγελμα', address: 'Διεύθυνση', district: 'Περιοχή',
  zip: 'Τ.Κ.', city: 'Πόλη', country: 'Χώρα', phone: 'Τηλέφωνο', phone2: 'Τηλέφωνο 2', fax: 'Fax', email: 'Email', webpage: 'Ιστοσελίδα',
};
const KEYS = Object.keys(LABEL) as Key[];
const s = (v: unknown) => String(v ?? '').trim();
const isForeign = (afm: string) => /^[A-Z]{2,3}\d/i.test(afm.replace(/[\s.-]/g, '')) && !/^(EL|GR)\d{9}$/i.test(afm.replace(/\s/g, ''));

export function TraderEditDialog({ trdr, mode, open, onOpenChange, canManage }: {
  trdr: number; mode: TraderDialogMode; open: boolean; onOpenChange: (o: boolean) => void; canManage: boolean;
}) {
  const router = useRouter();
  const [data, setData] = React.useState<Loaded | null>(null);
  const [form, setForm] = React.useState<Values>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'load' | 'aade' | 'preview' | 'save' | null>(null);
  const [proposals, setProposals] = React.useState<{ source: string; items: Proposal[]; warning?: string | null } | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<Change[] | null>(null);
  const [viesOpen, setViesOpen] = React.useState(false);
  /** Ονόματα ΚΑΔ (id → «κωδικός — περιγραφή») από την καρτέλα και την ΑΑΔΕ. */
  const [kadNames, setKadNames] = React.useState<Record<number, string>>({});

  const officeName = React.useCallback((key: string | null | undefined) => {
    const o = data?.offices.find((x) => x.key === s(key));
    return o ? `${o.name} (${o.code})` : s(key) || null;
  }, [data]);
  const countryName = React.useCallback((id: string | null | undefined) => data?.countries.find((c) => c.id === s(id))?.name ?? (s(id) || null), [data]);
  const shown = (k: Key | 'kad' | 'kad1', v: unknown): string => {
    if (v == null || v === '') return '—';
    if (k === 'irsData') return officeName(String(v)) ?? '—';
    if (k === 'country') return countryName(String(v)) ?? '—';
    if (k === 'kad' || k === 'kad1') return kadNames[Number(v)] ?? `#${v}`;
    return String(v);
  };

  const runAade = React.useCallback(async (afm: string) => {
    setBusy('aade');
    try {
      const r = await fetch('/api/admin/ocr/supplier-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ afm }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) { toast.error(r.status === 404 ? 'Ο ΑΦΜ δεν βρέθηκε στην ΑΑΔΕ.' : 'Η ΑΑΔΕ δεν απάντησε.'); return; }
      const items: Proposal[] = [];
      const add = (key: Proposal['key'], label: string, value: string | number | null | undefined, display?: string, note?: string | null) => {
        if (value == null || value === '') return;
        items.push({ key, label, value, display: display ?? String(value), note });
      };
      add('name', 'Επωνυμία', d.name);
      add('profession', 'Επάγγελμα', d.profession);
      add('address', 'Διεύθυνση', d.address);
      add('zip', 'Τ.Κ.', d.zip);
      add('city', 'Πόλη', d.city);
      if (d.softoneDoy?.office) add('irsData', 'Δ.Ο.Υ.', String(d.softoneDoy.office.key), `${d.softoneDoy.office.name} (${d.softoneDoy.office.code})`);
      else if (d.doyDescr) items.push({ key: 'irsData', label: 'Δ.Ο.Υ.', value: null, display: d.doyDescr, note: d.softoneDoy?.note ?? 'Η Δ.Ο.Υ. δεν υπάρχει στο μητρώο της SoftOne.' });
      const k1 = d.softoneKad?.primary; const k2 = d.softoneKad?.secondary;
      if (k1?.row) add('kad', 'ΚΑΔ (κύρια)', k1.row.id, `${k1.row.code} — ${k1.row.name}`, k1.note);
      if (k2?.row) add('kad1', 'ΚΑΔ (δευτερεύουσα)', k2.row.id, `${k2.row.code} — ${k2.row.name}`, k2.note);
      setKadNames((m) => ({ ...m, ...(k1?.row ? { [k1.row.id]: `${k1.row.code} — ${k1.row.name}` } : {}), ...(k2?.row ? { [k2.row.id]: `${k2.row.code} — ${k2.row.name}` } : {}) }));
      setProposals({ source: 'ΑΑΔΕ', items, warning: d.isActive === false ? 'Η ΑΑΔΕ δείχνει τον ΑΦΜ ως ΑΝΕΝΕΡΓΟ (διακοπή εργασιών).' : null });
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  }, []);

  const load = React.useCallback(async () => {
    setBusy('load'); setLoadError(null); setPreview(null); setProposals(null);
    try {
      const r = await fetch(`/api/admin/traders/${trdr}`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) { setLoadError(d?.message ?? 'Η καρτέλα δεν διαβάστηκε από τη SoftOne.'); return; }
      setData(d); setForm(d.values ?? {});
      setKadNames({
        ...(d.values?.kad && d.kadLabels?.kad ? { [d.values.kad]: d.kadLabels.kad } : {}),
        ...(d.values?.kad1 && d.kadLabels?.kad1 ? { [d.values.kad1]: d.kadLabels.kad1 } : {}),
      });
      const afm = s(d.values?.afm);
      if (mode === 'aade' && isValidAfm(afm)) void runAade(afm.replace(/\D/g, ''));
      if (mode === 'vies') setViesOpen(true);
    } catch { setLoadError('Σφάλμα δικτύου.'); } finally { setBusy((b) => (b === 'load' ? null : b)); }
  }, [trdr, mode, runAade]);
  React.useEffect(() => { if (open) void load(); }, [open, load]);

  // Οι προτάσεις που διαφέρουν από τη φόρμα προεπιλέγονται.
  React.useEffect(() => {
    if (!proposals) return;
    setPicked(new Set(proposals.items.filter((p) => p.value != null && s(p.value) !== s(form[p.key])).map((p) => p.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals]);

  const onVies = (r: ViesCheckResult) => {
    if (r.valid !== true) return;
    const items: Proposal[] = [];
    if (r.name) items.push({ key: 'name', label: 'Επωνυμία', value: r.name, display: r.name });
    if (r.address) items.push({ key: 'address', label: 'Διεύθυνση', value: r.address.slice(0, 100), display: r.address, note: 'Το μητρώο δίνει ολόκληρη τη διεύθυνση σε μία γραμμή — έλεγξε ΤΚ/πόλη χωριστά.' });
    setProposals({ source: r.source ?? 'VIES', items });
  };

  const applyPicked = () => {
    if (!proposals) return;
    setForm((f) => {
      const next = { ...f };
      for (const p of proposals.items) if (picked.has(p.key) && p.value != null) (next as Record<string, unknown>)[p.key] = p.value;
      return next;
    });
    setPreview(null);
    toast.success('Οι επιλεγμένες τιμές μπήκαν στη φόρμα — έλεγξε και πάτα «Προεπισκόπηση».');
  };

  const send = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'save');
    try {
      const values: Values = {};
      for (const k of KEYS) values[k] = form[k] ?? null;
      values.kad = form.kad ?? null; values.kad1 = form.kad1 ?? null;
      const r = await fetch(`/api/admin/traders/${trdr}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values, dryRun }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { toast.error(d?.message ?? 'Η αποθήκευση απέτυχε.'); return; }
      if (dryRun) { setPreview(d.changes ?? []); return; }
      if (!d.changes?.length) { toast.info('Καμία αλλαγή.'); return; }
      if (d.unapplied?.length || d.sideEffects?.length) {
        toast.warning(`Η SoftOne ΔΕΝ κράτησε: ${d.unapplied.map((c: Change) => c.label).join(', ')}${d.sideEffects?.length ? ` · άλλαξαν και: ${d.sideEffects.join(', ')}` : ''}`, { duration: 12000 });
      } else toast.success(`Αποθηκεύτηκε στη SoftOne (${d.changes.length} ${d.changes.length === 1 ? 'πεδίο' : 'πεδία'}).`);
      onOpenChange(false); router.refresh();
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(null); }
  };

  const set = (k: Key, v: string) => { setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const afm = s(form.afm);
  const greek = isValidAfm(afm);
  const foreign = !greek && isForeign(afm);
  const readOnly = !canManage || !data?.editable;
  const input = (k: Key, opts: { mono?: boolean; type?: string } = {}) => (
    <Field label={LABEL[k]} htmlFor={`te-${k}`}>
      <Input id={`te-${k}`} value={s(form[k])} onChange={(e) => set(k, e.target.value)} disabled={readOnly} type={opts.type ?? 'text'}
        className={cn(fieldCls, opts.mono && 'font-mono tabular-nums')} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[length:var(--fs-15)]">
            <FiEdit3 aria-hidden className="size-4 text-sisyphus-600" /> {readOnly ? 'Καρτέλα συναλλασσομένου' : 'Τροποποίηση συναλλασσομένου'}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--fs-12)]">
            {data ? <><span className="font-mono">{data.code}</span> — {s(data.values.name)} · τα στοιχεία διαβάστηκαν τώρα από τη SoftOne</> : 'Ανάγνωση από τη SoftOne…'}
          </DialogDescription>
        </DialogHeader>

        {busy === 'load' && <div className="space-y-2" role="status"><span className="sr-only">Ανάγνωση…</span>{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}</div>}
        {loadError && (
          <p role="alert" className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[length:var(--fs-12)] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {loadError}
            <button type="button" onClick={() => void load()} className="ml-auto cursor-pointer font-semibold underline">Ξανά</button>
          </p>
        )}

        {data && busy !== 'load' && (
          <div className="space-y-3">
            {!data.editable && <RowHint tone="warn">Αυτός ο τύπος συναλλασσομένου (χρηματικός λογαριασμός) δεν τροποποιείται από την εφαρμογή.</RowHint>}

            {/* Εξακρίβωση: ΑΑΔΕ για ελληνικό ΑΦΜ, VIES για ξένο. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!greek || busy != null} onClick={() => void runAade(afm.replace(/\D/g, ''))}
                title={greek ? 'Σύγκριση με τα στοιχεία της ΑΑΔΕ' : 'Χρειάζεται έγκυρος ελληνικός ΑΦΜ'}>
                {busy === 'aade' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : <FiShield aria-hidden className="mr-1.5 size-3.5" />} Εξακρίβωση ΑΑΔΕ
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!foreign} onClick={() => setViesOpen(true)}
                title={foreign ? 'Έλεγχος στο VIES / HMRC / Brønnøysund / UID' : 'Χρειάζεται ΑΦΜ με πρόθεμα ξένης χώρας'}>
                <FiGlobe aria-hidden className="mr-1.5 size-3.5" /> Εξακρίβωση VIES
              </Button>
            </div>
            {viesOpen && foreign && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <ViesCheck autoRun vat={afm} trader={{ name: s(form.name), street: s(form.address), postalCode: s(form.zip), city: s(form.city) }} onResult={onVies} />
                <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">
                  Το μητρώο δίνει: αν ο ΑΦΜ είναι ενεργός, επωνυμία, διεύθυνση (σε μία γραμμή) και αριθμό ελέγχου — όχι Δ.Ο.Υ., τηλέφωνα ή ΤΚ/πόλη χωριστά. Γερμανία και Ισπανία κρύβουν επωνυμία/διεύθυνση.
                </p>
              </div>
            )}

            {proposals && (
              <FormSection tone="emerald" icon={<FiCheckCircle />} title={`Σύγκριση με ${proposals.source}`}
                aside={<span>{proposals.items.filter((p) => p.value != null && s(p.value) !== s(form[p.key])).length} διαφορές</span>}>
                {proposals.warning && <RowHint tone="bad">{proposals.warning}</RowHint>}
                {proposals.items.length === 0 ? <RowHint>Δεν ήρθαν στοιχεία για σύγκριση.</RowHint> : (
                  <div className="-mx-3 overflow-x-auto">
                    <table className="w-full text-[length:var(--fs-12)]">
                      <thead className="bg-muted/50 text-[length:var(--fs-11)] text-muted-foreground">
                        <tr><th className="w-8 px-3 py-1.5" /><th className="px-2 py-1.5 text-left font-medium">Πεδίο</th><th className="px-2 py-1.5 text-left font-medium">Στη SoftOne</th><th className="px-3 py-1.5 text-left font-medium">{proposals.source}</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {proposals.items.map((p) => {
                          const same = p.value != null && s(p.value) === s(form[p.key]);
                          return (
                            <tr key={p.key} className={cn(same && 'text-muted-foreground')}>
                              <td className="px-3 py-1.5">
                                <input type="checkbox" aria-label={`Εφαρμογή: ${p.label}`} disabled={same || p.value == null || readOnly} checked={picked.has(p.key)}
                                  onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.key); else n.delete(p.key); return n; })}
                                  className="size-4 cursor-pointer accent-emerald-600" />
                              </td>
                              <td className="px-2 py-1.5 font-medium">{p.label}</td>
                              <td className="max-w-[14rem] px-2 py-1.5"><span className="line-clamp-2">{shown(p.key, form[p.key])}</span></td>
                              <td className="max-w-[16rem] px-3 py-1.5">
                                <span className={cn('line-clamp-2', !same && p.value != null && 'font-medium text-emerald-800 dark:text-emerald-300')}>{same ? '✓ ίδιο' : p.display}</span>
                                {p.note && <span className="block text-[length:var(--fs-11)] text-amber-700 dark:text-amber-300">{p.note}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {!readOnly && picked.size > 0 && (
                  <div className="flex justify-end"><Button type="button" size="sm" onClick={applyPicked}><FiArrowRight aria-hidden className="mr-1.5 size-3.5" /> Εφαρμογή {picked.size} στη φόρμα</Button></div>
                )}
              </FormSection>
            )}

            <FormSection tone="blue" icon={<FiUser />} title="Ταυτότητα">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="sm:col-span-2">{input('name')}</div>
                {input('afm', { mono: true })}
                <Field label="Δ.Ο.Υ.">
                  <FormSelect value={s(form.irsData)} onChange={(v) => set('irsData', v)} disabled={readOnly} ariaLabel="Δ.Ο.Υ."
                    opts={data.offices.map((o) => ({ id: o.key, name: `${o.name} (${o.code})` }))} placeholder="— Δ.Ο.Υ. —" />
                </Field>
                <div className="sm:col-span-2">{input('profession')}</div>
              </div>
              {(form.kad || form.kad1) && (
                <RowHint>ΚΑΔ: {shown('kad', form.kad)}{form.kad1 ? ` · ${shown('kad1', form.kad1)}` : ''}</RowHint>
              )}
            </FormSection>

            <FormSection tone="violet" icon={<FiMapPin />} title="Διεύθυνση">
              <div className="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                {input('address')}
                {input('district')}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {input('zip', { mono: true })}
                {input('city')}
                <Field label="Χώρα">
                  <FormSelect value={s(form.country)} onChange={(v) => set('country', v)} disabled={readOnly} ariaLabel="Χώρα"
                    opts={data.countries.map((c) => ({ id: c.id, name: c.name }))} placeholder="— Χώρα —" />
                </Field>
              </div>
            </FormSection>

            <FormSection tone="slate" icon={<FiPhone />} title="Επικοινωνία">
              <div className="grid gap-2.5 sm:grid-cols-3">
                {input('phone', { mono: true })}
                {input('phone2', { mono: true })}
                {input('fax', { mono: true })}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {input('email', { type: 'email' })}
                {input('webpage')}
              </div>
            </FormSection>

            {preview && (
              <FormSection tone="amber" icon={<FiEdit3 />} title={preview.length ? `Θα αλλάξουν ${preview.length} πεδία στη SoftOne` : 'Καμία αλλαγή'}>
                {preview.length === 0 ? <RowHint>Η φόρμα είναι ίδια με την καρτέλα της SoftOne.</RowHint> : (
                  <ul className="space-y-1 text-[length:var(--fs-12)]">
                    {preview.map((c) => (
                      <li key={c.key} className="flex flex-wrap items-baseline gap-x-1.5">
                        <strong className="font-medium">{c.label}:</strong>
                        <span className="text-muted-foreground line-through decoration-muted-foreground/50">{shown(c.key as Key, c.from)}</span>
                        <FiArrowRight aria-hidden className="size-3 self-center text-muted-foreground" />
                        <span className="font-medium text-foreground">{c.to == null ? <em className="text-destructive">κενό</em> : shown(c.key as Key, c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </FormSection>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy === 'save'}>Κλείσιμο</Button>
          {!readOnly && data && (
            preview && preview.length > 0 ? (
              <Button onClick={() => void send(false)} disabled={busy != null} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy === 'save' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : <FiCheckCircle aria-hidden className="mr-1.5 size-3.5" />}
                Αποθήκευση στη SoftOne
              </Button>
            ) : (
              <Button onClick={() => void send(true)} disabled={busy != null}>
                {busy === 'preview' ? <FiLoader aria-hidden className="mr-1.5 size-3.5 animate-spin" /> : <FiEdit3 aria-hidden className="mr-1.5 size-3.5" />}
                Προεπισκόπηση αλλαγών
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
