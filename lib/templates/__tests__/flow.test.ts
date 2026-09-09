import { describe, it, expect } from 'vitest';
import { buildFlow, type FlowTemplate, type FlowRun } from '../flow';

const tpl: FlowTemplate = {
  id: 't1', name: 'ACME', mode: 'SEMI_AUTO', samplePageCount: 2,
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
