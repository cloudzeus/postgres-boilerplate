'use client';

import * as React from 'react';
import Link from 'next/link';
import { FiArrowLeft, FiCheckCircle, FiChevronRight, FiCpu, FiGitBranch, FiImage, FiLayers, FiUser } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import type { TemplateDto } from '@/lib/templates/serialize';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/templates/labels';
import { DesignerContext } from './designer-context';
import { SupplierStep } from './supplier-step';
import { SampleStep } from './sample-step';
import { RegionsStep } from './regions-step';
import { MappingStep } from './mapping-step';
import { ConditionsStep } from './conditions-step';
import { FlowPanel } from './flow-panel';

const STEPS = [
  { key: 'supplier', label: 'Προμηθευτής', icon: FiUser },
  { key: 'sample', label: 'Δείγμα', icon: FiImage },
  { key: 'regions', label: 'Περιοχές & πεδία', icon: FiLayers },
  { key: 'mapping', label: 'Mapping', icon: FiGitBranch },
  { key: 'conditions', label: 'Conditions & λειτουργία', icon: FiCpu },
] as const;

/** Readiness per step — drives the check marks in the stepper. */
function stepDone(dto: TemplateDto, i: number): boolean {
  switch (i) {
    case 0: return !!dto.name && /^\d{9}$/.test(dto.vatNumber);
    case 1: return !!dto.sample;
    case 2: return dto.fields.some((f) => f.region);
    case 3: return dto.mappings.length > 0;
    case 4: return dto.status === 'ACTIVE';
    default: return false;
  }
}

export function TemplateDesigner({ initial, canManage, canPost }: { initial: TemplateDto; canManage: boolean; canPost: boolean }) {
  const [dto, setDto] = React.useState(initial);
  const [step, setStep] = React.useState(() => (initial.sample ? (initial.fields.length ? 2 : 1) : 0));
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  // The regions step needs the width, so start with the flow panel collapsed when
  // we land there. Only the initial default — navigating to it later keeps it open.
  const [flowOpen, setFlowOpen] = React.useState(() => !(initial.sample && initial.fields.length));
  // The mounted step reports its unsaved state here; leaving a step drops its draft,
  // so navigation (stepper buttons and flow-node clicks alike) asks first.
  const [dirty, setDirty] = React.useState(false);

  const goToStep = React.useCallback((next: number) => {
    if (next === step) return;
    if (dirty && !window.confirm('Υπάρχουν μη αποθηκευμένες αλλαγές. Να συνεχίσεις χωρίς αποθήκευση;')) return;
    setDirty(false);
    setStep(next);
  }, [step, dirty]);

  const ctx = React.useMemo(() => ({ dto, setDto, canManage, canPost, focusKey, setFocusKey, goToStep, dirty, setDirty }), [dto, canManage, canPost, focusKey, goToStep, dirty]);
  const Current = [SupplierStep, SampleStep, RegionsStep, MappingStep, ConditionsStep][step];

  return (
    <DesignerContext.Provider value={ctx}>
      <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-3 rounded-lg bg-neutral-8 p-3 lg:flex-row lg:gap-4 lg:p-4">
        {/* Stepper */}
        <nav aria-label="Βήματα" className="shrink-0 lg:w-52">
          <Link href="/admin/ocr/templates" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><FiArrowLeft className="size-3" /> Πρότυπα</Link>
          <div className="rounded-md border border-border bg-white p-1 shadow-fluent-2">
            {STEPS.map((s, i) => {
              const active = i === step; const done = stepDone(dto, i);
              return (
                <button key={s.key} type="button" onClick={() => goToStep(i)} aria-current={active ? 'step' : undefined}
                  className={cn('flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-[13px] cx-transition',
                    active ? 'bg-sisyphus-50 font-medium text-sisyphus-700' : 'text-foreground/80 hover:bg-[var(--cx-hover)]')}>
                  <span className={cn('grid size-5 place-items-center rounded-full text-[10px] font-semibold', done ? 'bg-[#E8F7F0] text-[#047857]' : active ? 'bg-sisyphus-500 text-white' : 'bg-muted text-muted-foreground')}>
                    {done ? <FiCheckCircle className="size-3.5" /> : i + 1}
                  </span>
                  <s.icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{s.label}</span>
                  {active && dirty && <span aria-label="Μη αποθηκευμένες αλλαγές" title="Μη αποθηκευμένες αλλαγές" className="size-1.5 shrink-0 rounded-full bg-[#B45309]" />}
                  {active && <FiChevronRight className="size-3.5 opacity-60" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-md border border-border bg-white p-3 text-[11px] text-muted-foreground shadow-fluent-2">
            <div className="flex justify-between"><span>Κατάσταση</span><span className="font-medium text-foreground">{STATUS_LABEL[dto.status]}</span></div>
            <div className="mt-1 flex justify-between"><span>Λειτουργία</span><span className="font-medium text-foreground">{MODE_LABEL[dto.mode]}</span></div>
            <div className="mt-1 flex justify-between"><span>Έκδοση</span><span className="font-mono">{dto.version}</span></div>
          </div>
        </nav>

        {/* Step content */}
        <section className="min-w-0 flex-1 rounded-md border border-border bg-white p-4 shadow-fluent-2">
          <Current />
        </section>

        {/* Flow panel */}
        <aside className={cn('shrink-0 rounded-md border border-border bg-white shadow-fluent-2', flowOpen ? 'lg:w-[320px]' : 'lg:w-10')}>
          <button type="button" onClick={() => setFlowOpen((o) => !o)} aria-label="Ροή" aria-expanded={flowOpen} className="flex h-9 w-full cursor-pointer items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
            {flowOpen ? <><span>Ροή</span><span aria-hidden>›</span></> : <span aria-hidden>‹</span>}
          </button>
          {flowOpen && <div className="h-[420px] border-t border-border lg:h-[calc(100%-2.25rem)]"><FlowPanel /></div>}
        </aside>
      </div>
    </DesignerContext.Provider>
  );
}
