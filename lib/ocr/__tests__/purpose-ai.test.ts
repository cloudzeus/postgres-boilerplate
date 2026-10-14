import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('../extract', () => ({ callTextLLM: vi.fn(), callTextViaVision: vi.fn(), parseJsonLoose: JSON.parse, resolveCfg: vi.fn() }));

import { parsePurposeAnswer } from '../purpose-ai';

describe('parsePurposeAnswer', () => {
  const ALLOWED = ['equipment', 'vehicle', 'services', 'goods'] as const;
  it('δέχεται μόνο επιτρεπτή κατηγορία', () => {
    expect(parsePurposeAnswer({ tile: 'equipment', confidence: 0.92, reason: 'Laptop της Apple.', searchHint: 'x' }, [...ALLOWED]))
      .toEqual({ tile: 'equipment', confidence: 0.92, reason: 'Laptop της Apple.', searchHint: null });
    expect(parsePurposeAnswer({ tile: 'split', confidence: 1 }, [...ALLOWED])).toBeNull();
    expect(parsePurposeAnswer({ tile: 'πάγιο' }, [...ALLOWED])).toBeNull();
  });
  it('φράζει τη βεβαιότητα, κρατά το searchHint για έξοδα', () => {
    expect(parsePurposeAnswer({ tile: 'VEHICLE', confidence: 7, reason: '', searchHint: 'καύσιμα' }, [...ALLOWED]))
      .toEqual({ tile: 'vehicle', confidence: 1, reason: 'Πρόταση του μοντέλου.', searchHint: 'καύσιμα' });
    expect(parsePurposeAnswer({ tile: 'services', searchHint: 'null' }, [...ALLOWED])?.searchHint).toBeNull();
  });
});
