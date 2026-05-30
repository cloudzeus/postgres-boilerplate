// lib/ocr/__tests__/region-text.test.ts
import { describe, it, expect } from 'vitest';
import { textInBox, type TextItem } from '../region-text';

// Coordinates are normalized 0..1 with origin top-left.
const items: TextItem[] = [
  { str: 'ΑΦΜ:',       x: 0.60, y: 0.10, w: 0.08, h: 0.02 },
  { str: '094014201',  x: 0.70, y: 0.10, w: 0.12, h: 0.02 },
  { str: 'ΣΥΝΟΛΟ',     x: 0.10, y: 0.80, w: 0.10, h: 0.02 },
];

describe('textInBox', () => {
  it('joins items whose centre falls inside the box, left-to-right top-to-bottom', () => {
    expect(textInBox(items, { x: 0.58, y: 0.08, w: 0.30, h: 0.06 })).toBe('ΑΦΜ: 094014201');
  });
  it('returns only the items inside a tighter box', () => {
    expect(textInBox(items, { x: 0.69, y: 0.09, w: 0.15, h: 0.04 })).toBe('094014201');
  });
  it('returns empty string when nothing intersects', () => {
    expect(textInBox(items, { x: 0.0, y: 0.0, w: 0.05, h: 0.05 })).toBe('');
  });
});
