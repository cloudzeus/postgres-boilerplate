import { describe, it, expect } from 'vitest';
import { requirementApplies, filterRequirements } from '../requirement-scope';

const reqAll = { id: 'r1', appliesToAll: true, businessTypeIds: [] };
const reqAE = { id: 'r2', appliesToAll: false, businessTypeIds: ['bt_ae'] };
const reqNone = { id: 'r3', appliesToAll: false, businessTypeIds: [] };

describe('requirementApplies', () => {
  it('appliesToAll is always required', () => {
    expect(requirementApplies(reqAll, 'bt_ike')).toBe(true);
    expect(requirementApplies(reqAll, null)).toBe(true);
  });
  it('matches when company type is in the list', () => {
    expect(requirementApplies(reqAE, 'bt_ae')).toBe(true);
    expect(requirementApplies(reqAE, 'bt_ike')).toBe(false);
  });
  it('empty list + not all => required by nobody', () => {
    expect(requirementApplies(reqNone, 'bt_ae')).toBe(false);
  });
  it('null company type only matches appliesToAll', () => {
    expect(requirementApplies(reqAE, null)).toBe(false);
  });
});

describe('filterRequirements', () => {
  it('returns only applicable requirements', () => {
    expect(filterRequirements([reqAll, reqAE, reqNone], 'bt_ae').map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});
