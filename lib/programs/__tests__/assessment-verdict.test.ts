import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../assessment-verdict';

describe('computeVerdict', () => {
  it('NOT_ELIGIBLE when basic criteria fail', () => {
    expect(computeVerdict(false, null)).toBe('NOT_ELIGIBLE');
  });
  it('ELIGIBLE when eligible and (no questionnaire OR passed)', () => {
    expect(computeVerdict(true, null)).toBe('ELIGIBLE');
    expect(computeVerdict(true, true)).toBe('ELIGIBLE');
  });
  it('NEEDS_REVIEW when eligible but questionnaire not passed', () => {
    expect(computeVerdict(true, false)).toBe('NEEDS_REVIEW');
  });
});
