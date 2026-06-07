import { describe, it, expect } from 'vitest';
import { templateFieldsToRules } from '../template-prompt';

describe('templateFieldsToRules', () => {
  it('maps template fields to FieldRuleLite shape', () => {
    const rules = templateFieldsToRules([
      { fieldKey: '500', label: 'Κύκλος Εργασιών', aiHint: 'Σύνολο πωλήσεων', regionHint: { page: 0, bbox: [0.1, 0.2, 0.3, 0.05] }, valueType: 'CURRENCY' },
      { fieldKey: '581', label: 'Δαπάνες Προσωπικού', aiHint: null, regionHint: null, valueType: 'CURRENCY' },
    ]);
    expect(rules).toEqual([
      { key: '500', label: 'Κύκλος Εργασιών', description: 'Σύνολο πωλήσεων', regionHint: { page: 0, bbox: [0.1, 0.2, 0.3, 0.05] }, scope: 'document', valueType: 'text' },
      { key: '581', label: 'Δαπάνες Προσωπικού', description: null, regionHint: null, scope: 'document', valueType: 'text' },
    ]);
  });
});
