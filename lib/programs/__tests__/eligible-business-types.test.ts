import { describe, it, expect } from 'vitest';
import { eligibleBusinessTypeIds } from '../eligible-business-types';

const catalog = [
  { id: 'bt_ae', code: 'ΑΕ' },
  { id: 'bt_epe', code: 'ΕΠΕ' },
  { id: 'bt_ike', code: 'ΙΚΕ' },
];

describe('eligibleBusinessTypeIds', () => {
  it('maps scanned free-text forms to catalog ids, deduped', () => {
    const r = eligibleBusinessTypeIds(['Α.Ε.', 'Ανώνυμη Εταιρεία', 'Ι.Κ.Ε.'], catalog);
    expect([...r].sort()).toEqual(['bt_ae', 'bt_ike']);
  });
  it('ignores forms with no catalog match', () => {
    expect(eligibleBusinessTypeIds(['Σωματείο'], catalog).size).toBe(0);
  });
  it('returns empty set for empty input', () => {
    expect(eligibleBusinessTypeIds([], catalog).size).toBe(0);
  });
});
