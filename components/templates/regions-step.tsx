'use client';

import * as React from 'react';
import { FiCrosshair, FiPlus, FiSave, FiTrash2, FiZap } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RegionMarker } from '@/components/ui/region-marker';
import { COLOR_PALETTE, nextColor, type FieldDef, type Region } from '@/lib/templates/schema';
import { KIND_LABEL } from '@/lib/templates/labels';
import { useDesigner } from './designer-context';
import { FieldForm } from './field-form';
import { templatesApi, errorMessage, type TestFieldResult } from './api';

const newField = (fields: FieldDef[]): FieldDef => ({
  key: '', label: '', kind: 'SINGLE', valueType: 'TEXT', color: nextColor(fields.map((f) => f.color)),
  region: null, columns: null, aiHint: null, required: false, order: fields.length,
});

export function RegionsStep() {
  const { dto, setDto, canManage, focusKey, setFocusKey, setDirty } = useDesigner();
  const [fields, setFields] = React.useState<FieldDef[]>(dto.fields);
  const [page, setPage] = React.useState(0);
  const [marking, setMarking] = React.useState<string | null>(null);         // key of the field receiving the next drawn box
  const [tests, setTests] = React.useState<Record<string, TestFieldResult | { error: string } | 'busy'>>({});
  const [busy, setBusy] = React.useState(false);
  // Only one step is mounted at a time, so this draft is discarded on navigation —
  // syncing on `dto.fields` alone cannot clobber another step's unsaved edits.
  React.useEffect(() => setFields(dto.fields), [dto.fields]);

  // Esc cancels marking from anywhere; a focusable wrapper only worked while it held focus.
  React.useEffect(() => {
    if (marking == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMarking(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marking]);

  // The step lives inside a flex row (stepper + flow aside), so viewport-keyed
  // breakpoints lie about the available width. Measure our own box instead.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(false);
  const hasSample = !!dto.sample;
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWide(entry.contentRect.width >= 900);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSample]);

  const dirty = JSON.stringify(fields) !== JSON.stringify(dto.fields);
  React.useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);
  const selected = fields.find((f) => f.key === focusKey) ?? null;
  const update = (key: string, f: FieldDef) => {
    let next = f;
    if (f.key !== key && fields.some((x) => x.key === f.key && x.key !== key)) {
      let n = 2;
      let candidate = `${f.key}_${n}`;
      while (fields.some((x) => x.key === candidate && x.key !== key)) { n += 1; candidate = `${f.key}_${n}`; }
      next = { ...f, key: candidate };
    }
    setFields((fs) => fs.map((x) => (x.key === key ? next : x)));
    if (next.key !== key) {
      if (focusKey === key) setFocusKey(next.key);
      setMarking((mk) => (mk === key ? next.key : mk));
      setTests((t) => { if (!(key in t)) return t; const { [key]: moved, ...rest } = t; return { ...rest, [next.key]: moved }; });
    }
  };

  // One palette colour per field, and the overlay is unreadable without distinct colours.
  const atColorCap = fields.length >= COLOR_PALETTE.length;
  const add = () => {
    if (atColorCap) { toast.error(COLOR_CAP_MSG); return; }
    const f = newField(fields); setFields((fs) => [...fs, f]); setFocusKey('');
  };
  const remove = (key: string) => {
    setFields((fs) => fs.filter((f) => f.key !== key).map((f, i) => ({ ...f, order: i })));
    if (focusKey === key) setFocusKey(null);
    setMarking((mk) => (mk === key ? null : mk));
    setTests((t) => { if (!(key in t)) return t; const { [key]: dropped, ...rest } = t; return rest; });
  };

  const onRegion = (box: { x: number; y: number; w: number; h: number }, pg: number) => {
    const key = marking; setMarking(null);
    if (key == null) return;
    const target = fields.find((f) => f.key === key);
    if (!target) return;
    const region: Region = { page: pg, bbox: [round(box.x), round(box.y), round(box.w), round(box.h)] };
    update(key, { ...target, region });
  };

  /** Mapping rows / condition clauses that point at `key` (or one of its table columns). */
  const referencesTo = (key: string) => {
    const hit = (fk: string | undefined) => fk === key || !!fk?.startsWith(`${key}.`);
    return {
      mappings: dto.mappings.filter((m) => (m.rows as { fieldKey: string }[]).some((r) => hit(r.fieldKey))).map((m) => m.name),
      conditions: dto.conditions.filter((c) => c.clauses.some((cl) => hit(cl.fieldKey))
        || c.actions.some((a) => a.type === 'SET_FIELD' && hit(a.params.fieldKey))).map((c) => c.name),
    };
  };

  const save = async () => {
    if (fields.some((f) => !f.label.trim())) { toast.error('Κάθε πεδίο χρειάζεται ετικέτα'); return; }
    // Keys are the only handle mappings and conditions have on a field, so a rename
    // reads server-side as a removal — say what will be dropped before it happens.
    const kept = new Set(fields.map((f) => f.key));
    const orphaned = dto.fields.filter((f) => !kept.has(f.key)).filter((f) => { const r = referencesTo(f.key); return r.mappings.length > 0 || r.conditions.length > 0; });
    if (orphaned.length && !window.confirm(`Η αλλαγή θα αφαιρέσει αναφορές σε mappings/conditions για: ${orphaned.map((f) => f.label || f.key).join(', ')}. Συνέχεια;`)) return;
    setBusy(true);
    try {
      const res = await templatesApi.putFields(dto.id, fields);
      const { cleanup, ...next } = res;
      setDto(next);
      const maps = cleanup?.mappings.map((m) => m.name) ?? [];
      const conds = cleanup?.conditions.map((c) => c.name) ?? [];
      if (maps.length || conds.length) {
        const parts = [maps.length ? `mappings: ${maps.join(', ')}` : '', conds.length ? `conditions: ${conds.join(', ')}` : ''].filter(Boolean);
        toast.warning(`Αποθηκεύτηκε · καθαρίστηκαν αναφορές σε ${parts.join(' · ')}`);
      } else toast.success('Αποθηκεύτηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const test = async (f: FieldDef) => {
    if (!f.region) { toast.error('Σχεδίασε πρώτα περιοχή'); return; }
    if (!dto.fields.some((x) => x.key === f.key)) { toast.error('Αποθήκευσε πρώτα το πεδίο'); return; }
    setTests((t) => ({ ...t, [f.key]: 'busy' }));
    try { const r = await templatesApi.testField(dto.id, f.key, f.region); setTests((t) => ({ ...t, [f.key]: r })); }
    catch (e) { setTests((t) => ({ ...t, [f.key]: { error: errorMessage(e) } })); }
  };

  if (!dto.sample) return <p className="text-[12px] text-muted-foreground">Ανέβασε πρώτα δείγμα στο βήμα «Δείγμα».</p>;

  const saved = fields.filter((f) => f.region && f.region.page === page).map((f) => ({ bbox: f.region!.bbox, color: f.color, active: f.key === focusKey, label: f.label || f.key }));

  return (
    <div ref={rootRef} className={cn(wide ? 'grid grid-cols-[minmax(0,1fr)_360px] gap-4' : 'flex flex-col gap-4')}>
      {/* Canvas */}
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="font-semibold">Περιοχές</span>
          {marking != null && <span className="rounded-full bg-[#FFF1E6] px-2 py-0.5 text-[11px] font-medium text-[#C2410C]">Σύρε πλαίσιο πάνω στο έγγραφο για «{fields.find((f) => f.key === marking)?.label || 'νέο πεδίο'}» · Esc για ακύρωση</span>}
          <span className="ml-auto text-muted-foreground">Σελίδα {page + 1} / {dto.sample.pageCount}</span>
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
          <Button variant="ghost" size="sm" disabled={page >= dto.sample.pageCount - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
        </div>
        <div className="rounded-md border border-border bg-neutral-6 p-2">
          <RegionMarker
            pageImageUrl={(p) => templatesApi.pageImageUrl(dto.id, p, dto.version)}
            pageCount={dto.sample.pageCount} page={page} onPageChange={setPage}
            savedRegions={saved} isMarking={marking != null} onRegionComplete={onRegion} showNav={false}
            className="w-full"
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {fields.filter((f) => f.region).map((f) => (
            <li key={f.key}><button type="button" onClick={() => { setFocusKey(f.key); setPage(f.region!.page); }} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]', f.key === focusKey ? 'border-transparent text-white' : 'border-border bg-white')} style={f.key === focusKey ? { backgroundColor: f.color } : undefined}>
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: f.color }} />{f.label || f.key}<span className="opacity-60">σ.{f.region!.page + 1}</span></button></li>))}
        </ul>
      </div>

      {/* Field list + form */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold">Πεδία <span className="ml-1 rounded-full bg-sisyphus-50 px-1.5 text-[10px] text-sisyphus-700">{fields.length}</span></span>
          {canManage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={add} disabled={fields.some((f) => !f.key) || atColorCap} title={atColorCap ? COLOR_CAP_MSG : undefined}><FiPlus className="mr-1 size-3.5" /> Πεδίο</Button><Button size="sm" onClick={save} disabled={!dirty || busy}><FiSave className="mr-1 size-3.5" /> {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button></div>}
        </div>
        <ul className="max-h-[260px] divide-y divide-border overflow-auto rounded-md border border-border">
          {fields.length === 0 && <li className="p-3 text-[12px] italic text-muted-foreground">Κανένα πεδίο. Πάτησε «Πεδίο».</li>}
          {fields.map((f) => { const t = tests[f.key]; return (
            <li key={f.key || '__new'} className={cn('flex items-center gap-2 px-2 py-1.5 text-[12px]', f.key === focusKey && 'bg-sisyphus-50')}>
              <button type="button" onClick={() => setFocusKey(f.key)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: f.color }} />
                <span className="truncate font-medium">{f.label || 'Νέο πεδίο'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[f.kind]}{f.region ? '' : ' · χωρίς περιοχή'}</span>
              </button>
              {t && t !== 'busy' && ('error' in t ? <span className="max-w-[120px] truncate text-[10px] text-dg-red-600" title={t.error}>{t.error}</span> : <span className="max-w-[140px] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: f.color + '1A', color: f.color }} title={`${t.raw ?? ''} (${t.source}, ${t.model ?? ''})`}>{String(t.value ?? '∅')}</span>)}
              {canManage && <>
                <button type="button" title="Σχεδίασε περιοχή" onClick={() => { setFocusKey(f.key); setMarking(f.key); }} className={cn('grid size-7 cursor-pointer place-items-center rounded-sm hover:bg-[var(--cx-hover)]', marking === f.key ? 'text-[#C2410C]' : 'text-muted-foreground')}><FiCrosshair className="size-3.5" /></button>
                <button type="button" title="Δοκιμή ανάγνωσης" disabled={t === 'busy'} onClick={() => test(f)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] disabled:opacity-40"><FiZap className={cn('size-3.5', t === 'busy' && 'animate-pulse')} /></button>
                <button type="button" title="Διαγραφή" onClick={() => remove(f.key)} className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-[var(--cx-hover)] hover:text-dg-red-600"><FiTrash2 className="size-3.5" /></button>
              </>}
            </li>); })}
        </ul>
        {selected && (
          <div className="rounded-md border border-border p-3" style={{ borderLeft: `4px solid ${selected.color}` }}>
            <FieldForm field={selected} usedColors={fields.map((f) => f.color)} disabled={!canManage} onChange={(f) => update(selected.key, f)} />
            {selected.region && <p className="mt-2 font-mono text-[10px] text-muted-foreground">σελίδα {selected.region.page + 1} · bbox {selected.region.bbox.map((n) => n.toFixed(3)).join(', ')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const COLOR_CAP_MSG = `Μέγιστο ${COLOR_PALETTE.length} πεδία ανά πρότυπο (ένα χρώμα το καθένα)`;
