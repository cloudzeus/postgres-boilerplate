// lib/ocr/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../templates';

describe('buildSystemPrompt few-shot', () => {
  it('omits the reference block when no example is given', () => {
    const p = buildSystemPrompt('invoice', 'el');
    expect(p).not.toMatch(/Αναφορά|Reference example/i);
  });
  it('includes the example JSON and a "do not copy" instruction when given', () => {
    const example = { vatNumber: '094014201', companyName: 'ΟΤΕ' };
    const p = buildSystemPrompt('invoice', 'el', example, { vatNumber: { note: 'πάνω δεξιά' } });
    expect(p).toContain('094014201');
    expect(p).toMatch(/do NOT copy|μην αντιγρ/i);
    expect(p).toContain('πάνω δεξιά');
  });
});
