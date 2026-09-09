// lib/templates/flow.ts — PURE. Builds the React-Flow node/edge arrays from a template (+ optional run).
// Kept free of React so the designer, the run-result view and tests share one source of truth.
import type { Action, Clause, Region, TemplateFieldKind, TemplateMode, MappingTarget } from './schema';

export type FlowTemplate = {
  id: string;
  name: string;
  /** Second line of the root node — supplier, else department, else the slug. */
  subtitle: string | null;
  mode: TemplateMode;
  samplePageCount: number | null;
  fields: { key: string; label: string; color: string; kind: TemplateFieldKind; region: Region | null }[];
  conditions: { id: string; name: string; clauses: Clause[]; actions: Action[] }[];
  mappings: { name: string; target: MappingTarget; rows: { fieldKey: string; [k: string]: unknown }[] }[];
};

export type FlowRun = {
  status: 'EXTRACTED' | 'REVIEW' | 'BLOCKED' | 'POSTED' | 'FAILED';
  values: Record<string, { value: unknown }>;
  matchedIds: string[];
  mappingName: string;
};

export type FlowNode = { id: string; type: 'sample' | 'field' | 'condition' | 'mapping' | 'output'; position: { x: number; y: number }; data: Record<string, unknown> };
export type FlowEdge = { id: string; source: string; target: string; label?: string; animated?: boolean; style?: { stroke: string } };

const COL_X = [0, 260, 540, 820, 1100];
const ROW_H = 96;

export function buildFlow(t: FlowTemplate, run?: FlowRun): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const col = (i: number, row: number) => ({ x: COL_X[i], y: row * ROW_H });

  nodes.push({ id: 'sample', type: 'sample', position: col(0, 0), data: { label: t.name, subtitle: t.subtitle, pageCount: t.samplePageCount ?? 0 } });

  t.fields.forEach((f, i) => {
    const v = run?.values[f.key]?.value;
    const status = run ? (v == null || (Array.isArray(v) && v.length === 0) ? 'missing' : 'ok') : undefined;
    nodes.push({
      id: `field:${f.key}`, type: 'field', position: col(1, i),
      data: { label: f.label, key: f.key, color: f.color, kind: f.kind, page: f.region?.page ?? null, hasRegion: !!f.region, value: v ?? null, status },
    });
    edges.push({ id: `e:sample->${f.key}`, source: 'sample', target: `field:${f.key}`, style: { stroke: f.color } });
  });

  const fieldsUsedBy = (keys: string[]) => keys.map((k) => k.split('.')[0]).filter((k) => t.fields.some((f) => f.key === k));

  t.conditions.forEach((c, i) => {
    const matched = run ? run.matchedIds.includes(c.id) : undefined;
    nodes.push({ id: `cond:${c.id}`, type: 'condition', position: col(2, i), data: { label: c.name, clauses: c.clauses.length, actions: c.actions.map((a) => a.type), matched } });
    for (const key of new Set(fieldsUsedBy(c.clauses.map((cl) => cl.fieldKey)))) {
      const color = t.fields.find((f) => f.key === key)!.color;
      edges.push({ id: `e:${key}->${c.id}`, source: `field:${key}`, target: `cond:${c.id}`, style: { stroke: color } });
    }
  });

  const defaultMapping = t.mappings[0]?.name ?? null;
  t.mappings.forEach((m, i) => {
    const active = run ? run.mappingName === m.name : undefined;
    nodes.push({ id: `map:${m.name}`, type: 'mapping', position: col(3, i), data: { label: m.target === 'EXCEL' ? `Excel: ${m.name}` : `Παραστατικό: ${m.name}`, target: m.target, rows: m.rows.length, active } });
    for (const key of new Set(fieldsUsedBy(m.rows.map((r) => r.fieldKey)))) {
      const color = t.fields.find((f) => f.key === key)!.color;
      edges.push({ id: `e:${key}->map:${m.name}`, source: `field:${key}`, target: `map:${m.name}`, style: { stroke: color } });
    }
    edges.push({ id: `e:map:${m.name}->output`, source: `map:${m.name}`, target: 'output', animated: active === true });
  });

  // Conditions feed the mapping they switch to (or the default one): true edge «ναι», false edge «όχι» to default.
  t.conditions.forEach((c) => {
    const sw = c.actions.find((a) => a.type === 'SWITCH_MAPPING') as Extract<Action, { type: 'SWITCH_MAPPING' }> | undefined;
    const target = sw?.params.mappingName ?? defaultMapping;
    // A SWITCH_MAPPING may name a mapping that was renamed or deleted — never draw a dangling edge.
    if (!target || !t.mappings.some((m) => m.name === target)) return;
    const matched = run ? run.matchedIds.includes(c.id) : undefined;
    edges.push({ id: `e:${c.id}->map:${target}:yes`, source: `cond:${c.id}`, target: `map:${target}`, label: 'ναι', animated: matched === true, style: { stroke: '#047857' } });
    if (sw && defaultMapping && defaultMapping !== target && t.mappings.some((m) => m.name === defaultMapping)) {
      edges.push({ id: `e:${c.id}->map:${defaultMapping}:no`, source: `cond:${c.id}`, target: `map:${defaultMapping}`, label: 'όχι', animated: matched === false, style: { stroke: '#8A8A8A' } });
    }
  });

  nodes.push({ id: 'output', type: 'output', position: col(4, 0), data: { label: outputLabel(t.mode), mode: t.mode, runStatus: run?.status ?? null } });
  return { nodes, edges };
}

function outputLabel(mode: TemplateMode): string {
  if (mode === 'AUTO') return 'Ανάρτηση SoftOne (αυτόματα)';
  if (mode === 'SEMI_AUTO') return 'Προς έλεγχο → SoftOne';
  return 'Μόνο εξαγωγή';
}

/** Minimal DTO shape the adapter needs — matches `TemplateDto` from serialize.ts without importing it (keeps this module isomorphic). */
export type FlowTemplateSource = {
  id: string;
  name: string;
  slug: string;
  department: string | null;
  supplierName: string | null;
  mode: TemplateMode;
  sample: { pageCount: number } | null;
  fields: { key: string; label: string; color: string; kind: TemplateFieldKind; region: Region | null }[];
  mappings: { name: string; target: MappingTarget; rows: { fieldKey: string; [k: string]: unknown }[] }[];
  conditions: { id: string; name: string; isActive: boolean; clauses: Clause[]; actions: Action[]; [k: string]: unknown }[];
};

/** Designer and run-result views both go through this, so the diagram never drifts between them. */
export function toFlowTemplate(dto: FlowTemplateSource): FlowTemplate {
  return {
    id: dto.id,
    name: dto.name,
    subtitle: dto.supplierName ?? dto.department ?? dto.slug,
    mode: dto.mode,
    samplePageCount: dto.sample?.pageCount ?? null,
    fields: dto.fields.map((f) => ({ key: f.key, label: f.label, color: f.color, kind: f.kind, region: f.region })),
    conditions: dto.conditions.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, clauses: c.clauses, actions: c.actions })),
    mappings: dto.mappings.map((m) => ({ name: m.name, target: m.target, rows: m.rows })),
  };
}

// ─── Layout ────────────────────────────────────────────────────────────────
// `buildFlow` lays the pipeline out as 5 columns left→right (`COL_X`), one row per
// item inside a column. That grid is abstract: the two places that render it want
// opposite reading directions, so the concrete pixel layout lives here (pure, tested)
// and the canvas component stays a thin renderer.
//
//  • `horizontal` — the wide document page: stages run left→right across ~1100px,
//    the items of a stage stack vertically underneath each other.
//  • `vertical` — the narrow designer side panel: the grid is transposed, so stages
//    run top→bottom and the items of a stage sit side by side, wrapping every
//    `PER_ROW` items so a template with a dozen fields stays inside ~950px.

export type FlowOrientation = 'vertical' | 'horizontal';

/** Horizontal: 5 stages × 275px = 1100px wide, rows 110px apart. */
const H_COL_W = 275;
const H_ROW_H = 110;
/** Vertical: items per line before a stage wraps (5 × 190px ≈ 950px, the widest we let the panel get). */
const PER_ROW = 5;
const V_ITEM_W = 190;
const V_STAGE_H = 120;
const V_WRAP_H = 90;

/** Nearest column index of a `buildFlow` x — the grid is fixed, so this never guesses. */
function stageOf(x: number): number {
  let best = 0;
  for (let i = 1; i < COL_X.length; i++) if (Math.abs(COL_X[i] - x) < Math.abs(COL_X[best] - x)) best = i;
  return best;
}
const itemOf = (y: number) => Math.round(y / ROW_H);

/** Places `buildFlow` nodes on screen for the given reading direction. Pure — same input, same pixels. */
export function layoutFlow(nodes: FlowNode[], orientation: FlowOrientation): FlowNode[] {
  if (orientation === 'horizontal') {
    return nodes.map((n) => ({ ...n, position: { x: stageOf(n.position.x) * H_COL_W, y: itemOf(n.position.y) * H_ROW_H } }));
  }

  const countByStage = new Map<number, number>();
  for (const n of nodes) {
    const s = stageOf(n.position.x);
    countByStage.set(s, (countByStage.get(s) ?? 0) + 1);
  }
  // Stack the stages cumulatively: a wrapped stage is taller than one line, and a
  // flat `stage * V_STAGE_H` would drop the next stage on top of its second line.
  const topByStage = new Map<number, number>();
  let top = 0;
  for (const s of [...countByStage.keys()].sort((a, b) => a - b)) {
    topByStage.set(s, top);
    top += V_STAGE_H + (Math.ceil((countByStage.get(s) ?? 1) / PER_ROW) - 1) * V_WRAP_H;
  }
  return nodes.map((n) => {
    const s = stageOf(n.position.x);
    const item = itemOf(n.position.y);
    const count = countByStage.get(s) ?? 1;
    return {
      ...n,
      position: {
        // Centre the line under the stage above it.
        x: (item % PER_ROW) * V_ITEM_W - ((Math.min(count, PER_ROW) - 1) * V_ITEM_W) / 2,
        y: (topByStage.get(s) ?? 0) + Math.floor(item / PER_ROW) * V_WRAP_H,
      },
    };
  });
}
