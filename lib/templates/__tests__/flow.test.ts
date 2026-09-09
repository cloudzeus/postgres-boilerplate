import { describe, it, expect } from 'vitest';
import { buildFlow, layoutFlow, toFlowTemplate, type FlowTemplate, type FlowRun } from '../flow';

const tpl: FlowTemplate = {
  id: 't1', name: 'ACME', subtitle: 'ACME AE', mode: 'SEMI_AUTO', samplePageCount: 2,
  fields: [
    { key: 'no', label: 'Αριθμός', color: '#0078D4', kind: 'SINGLE', region: { page: 0, bbox: [0.1, 0.1, 0.2, 0.05] } },
    { key: 'lines', label: 'Γραμμές', color: '#047857', kind: 'TABLE', region: { page: 1, bbox: [0, 0.3, 1, 0.5] } },
  ],
  conditions: [{ id: 'c1', name: 'Μεγάλο ποσό', clauses: [{ fieldKey: 'no', op: 'notEmpty' }], actions: [{ type: 'FLAG_REVIEW', params: { reason: 'x' } }] }],
  mappings: [{ name: 'default', target: 'INVOICE', rows: [{ fieldKey: 'no', invoiceKey: 'invoiceNumber' }] }, { name: 'xls', target: 'EXCEL', rows: [{ fieldKey: 'no', column: 'A', order: 1 }] }],
};

describe('buildFlow', () => {
  it('creates sample, field, condition, mapping and output nodes with edges', () => {
    const { nodes, edges } = buildFlow(tpl);
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('sample');
    expect(ids).toContain('field:no');
    expect(ids).toContain('field:lines');
    expect(ids).toContain('cond:c1');
    expect(ids).toContain('map:default');
    expect(ids).toContain('map:xls');
    expect(ids).toContain('output');
    expect(edges).toContainEqual(expect.objectContaining({ source: 'sample', target: 'field:no' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'field:no', target: 'cond:c1' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'cond:c1', target: 'map:default', label: 'ναι' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'field:no', target: 'map:default' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'map:default', target: 'output' }));
  });
  it('field nodes carry their colour and type, output carries the mode', () => {
    const { nodes } = buildFlow(tpl);
    const f = nodes.find((n) => n.id === 'field:no')!;
    expect(f.type).toBe('field');
    expect(f.data).toMatchObject({ label: 'Αριθμός', color: '#0078D4', kind: 'SINGLE', page: 0 });
    expect(nodes.find((n) => n.id === 'output')!.data).toMatchObject({ mode: 'SEMI_AUTO' });
  });
  it('lays nodes out in columns left to right', () => {
    const { nodes } = buildFlow(tpl);
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(x('sample')).toBeLessThan(x('field:no'));
    expect(x('field:no')).toBeLessThan(x('cond:c1'));
    expect(x('cond:c1')).toBeLessThan(x('map:default'));
    expect(x('map:default')).toBeLessThan(x('output'));
  });
  it('overlays live run status when a run is given', () => {
    const run: FlowRun = { status: 'REVIEW', values: { no: { value: 'ΤΙΜ-1' }, lines: { value: null } }, matchedIds: ['c1'], mappingName: 'default' };
    const { nodes, edges } = buildFlow(tpl, run);
    expect(nodes.find((n) => n.id === 'field:no')!.data).toMatchObject({ value: 'ΤΙΜ-1', status: 'ok' });
    expect(nodes.find((n) => n.id === 'field:lines')!.data).toMatchObject({ status: 'missing' });
    expect(nodes.find((n) => n.id === 'cond:c1')!.data).toMatchObject({ matched: true });
    expect(nodes.find((n) => n.id === 'output')!.data).toMatchObject({ runStatus: 'REVIEW' });
    expect(edges.find((e) => e.source === 'cond:c1' && e.target === 'map:default')!.animated).toBe(true);
  });
  it('does not draw edges to a mapping that does not exist', () => {
    const t: FlowTemplate = { ...tpl, conditions: [{ id: 'c9', name: 'x', clauses: [{ fieldKey: 'no', op: 'notEmpty' }], actions: [{ type: 'SWITCH_MAPPING', params: { mappingName: 'ghost' } }] }] };
    const { edges, nodes } = buildFlow(t);
    const targets = new Set(nodes.map((n) => n.id));
    for (const e of edges) expect(targets.has(e.target)).toBe(true);
  });
});

describe('toFlowTemplate', () => {
  it('projects a TemplateDto-shaped object onto FlowTemplate, dropping extra keys', () => {
    const dto = {
      id: 't', name: 'N', slug: 'n', department: null, supplierName: 'ΠΡΟΜ ΑΕ', mode: 'AUTO' as const, sample: { mimeType: 'image/png', pageCount: 3, thumbUrl: '/x' },
      fields: [{ key: 'a', label: 'A', color: '#000000', kind: 'SINGLE' as const, valueType: 'TEXT' as const, region: null, columns: null, aiHint: null, required: false, order: 0 }],
      mappings: [{ id: 'm1', name: 'default', target: 'INVOICE' as const, isDefault: true, rows: [{ fieldKey: 'a', invoiceKey: 'invoiceNumber' }] }],
      conditions: [{ id: 'c1', name: 'C', order: 0, isActive: true, logic: 'AND' as const, clauses: [], actions: [] }],
    };
    const ft = toFlowTemplate(dto);
    expect(ft).toEqual({
      id: 't', name: 'N', subtitle: 'ΠΡΟΜ ΑΕ', mode: 'AUTO', samplePageCount: 3,
      fields: [{ key: 'a', label: 'A', color: '#000000', kind: 'SINGLE', region: null }],
      conditions: [{ id: 'c1', name: 'C', clauses: [], actions: [] }],
      mappings: [{ name: 'default', target: 'INVOICE', rows: [{ fieldKey: 'a', invoiceKey: 'invoiceNumber' }] }],
    });
  });
  it('uses null page count when there is no sample and skips inactive conditions', () => {
    const ft = toFlowTemplate({ id: 't', name: 'N', slug: 'n', department: 'Λογιστήριο', supplierName: null, mode: 'MANUAL', sample: null, fields: [], mappings: [], conditions: [{ id: 'c', name: 'off', order: 0, isActive: false, logic: 'AND', clauses: [], actions: [] }] });
    expect(ft.samplePageCount).toBeNull();
    expect(ft.conditions).toEqual([]);
    // Subtitle falls back supplier → department → slug.
    expect(ft.subtitle).toBe('Λογιστήριο');
    expect(toFlowTemplate({ id: 't', name: 'N', slug: 'n', department: null, supplierName: null, mode: 'MANUAL', sample: null, fields: [], mappings: [], conditions: [] }).subtitle).toBe('n');
  });
});

describe('layoutFlow', () => {
  const at = (id: string, orientation: 'vertical' | 'horizontal') =>
    layoutFlow(buildFlow(tpl).nodes, orientation).find((n) => n.id === id)!.position;

  it('horizontal runs the 5 stages left to right inside 1100px, items 110px apart', () => {
    expect(at('sample', 'horizontal')).toEqual({ x: 0, y: 0 });
    expect(at('field:no', 'horizontal')).toEqual({ x: 275, y: 0 });
    expect(at('field:lines', 'horizontal')).toEqual({ x: 275, y: 110 });
    expect(at('cond:c1', 'horizontal')).toEqual({ x: 550, y: 0 });
    expect(at('map:default', 'horizontal')).toEqual({ x: 825, y: 0 });
    expect(at('map:xls', 'horizontal')).toEqual({ x: 825, y: 110 });
    expect(at('output', 'horizontal')).toEqual({ x: 1100, y: 0 });
  });

  it('vertical transposes the grid: stages top to bottom, items of a stage side by side and centred', () => {
    expect(at('sample', 'vertical')).toEqual({ x: 0, y: 0 });
    expect(at('field:no', 'vertical')).toEqual({ x: -95, y: 120 });
    expect(at('field:lines', 'vertical')).toEqual({ x: 95, y: 120 });
    expect(at('cond:c1', 'vertical')).toEqual({ x: 0, y: 240 });
    expect(at('map:default', 'vertical')).toEqual({ x: -95, y: 360 });
    expect(at('map:xls', 'vertical')).toEqual({ x: 95, y: 360 });
    expect(at('output', 'vertical')).toEqual({ x: 0, y: 480 });
  });

  it('vertical wraps a stage with more than 5 items and pushes the later stages down', () => {
    const many: FlowTemplate = { ...tpl, fields: Array.from({ length: 7 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, color: '#000000', kind: 'SINGLE' as const, region: null })), conditions: [], mappings: [tpl.mappings[0]] };
    const out = layoutFlow(buildFlow(many).nodes, 'vertical');
    const pos = (id: string) => out.find((n) => n.id === id)!.position;
    // First line holds 5, the 6th starts a second line 90px lower at the same x as the first.
    expect(pos('field:f0').y).toBe(120);
    expect(pos('field:f5').y).toBe(210);
    expect(pos('field:f5').x).toBe(pos('field:f0').x);
    // The wrapped stage is two lines tall, so the stage after it clears both.
    expect(pos('map:default').y).toBe(120 + 120 + 90);
  });

  it('is pure — it never mutates the nodes it was given', () => {
    const nodes = buildFlow(tpl).nodes;
    const before = JSON.stringify(nodes);
    layoutFlow(nodes, 'horizontal');
    layoutFlow(nodes, 'vertical');
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
