// lib/ocr/__tests__/custom-value.test.ts
// Τα ΕΙΔΙΚΑ ΠΕΔΙΑ σε οθόνη: η μόνη απαράβατη προδιαγραφή είναι ότι ΠΟΤΕ δεν βγαίνει
// «[object Object]» — μια οθόνη που δεν λέει τίποτα και δείχνει χαλασμένη.
import { describe, it, expect } from 'vitest';
import {
  formatCustomValue, formatCustomFields, customValueText, humanizeKey,
} from '../custom-value';

/** Το πραγματικό σχήμα που έσπασε: energa.pdf, «Ενδείξεις μετρητή» + «Περίοδος αυτομέτρησης». */
const METER_READINGS = [
  { register: 'Ημερήσια', previous: 12340, current: 13120 },
  { register: 'Νυχτερινή', previous: 4400, current: 4710 },
];
const SELF_READING = { from: '2026-05-01', to: '2026-06-30' };

describe('formatCustomValue', () => {
  it('σκαλάρ: string / number / boolean', () => {
    expect(formatCustomValue('PO-9')).toEqual({ kind: 'text', text: 'PO-9' });
    expect(formatCustomValue(124.5)).toEqual({ kind: 'text', text: '124.5' });
    expect(formatCustomValue(0)).toEqual({ kind: 'text', text: '0' });
    expect(formatCustomValue(true)).toEqual({ kind: 'text', text: 'Ναι' });
    expect(formatCustomValue(false)).toEqual({ kind: 'text', text: 'Όχι' });
  });

  it('κενό: null, undefined, κενό string, κενή λίστα, κενό αντικείμενο', () => {
    for (const v of [null, undefined, '', [], {}]) {
      expect(formatCustomValue(v)).toEqual({ kind: 'empty' });
    }
  });

  it('λίστα σκαλάρ → «α, β, γ»', () => {
    expect(formatCustomValue(['ΔΕΗ', 'ΔΕΔΔΗΕ', 'ΑΠΕ'])).toEqual({ kind: 'text', text: 'ΔΕΗ, ΔΕΔΔΗΕ, ΑΠΕ' });
    // Τα κενά της λίστας δεν αφήνουν κρεμασμένα κόμματα.
    expect(formatCustomValue(['Α', null, '', 'Β'])).toEqual({ kind: 'text', text: 'Α, Β' });
  });

  it('ένθετο αντικείμενο → ζεύγη κλειδί/τιμή, ποτέ [object Object]', () => {
    const r = formatCustomValue(SELF_READING);
    expect(r).toEqual({ kind: 'text', text: 'From: 2026-05-01, To: 2026-06-30' });
    expect(r.kind === 'text' && r.text).not.toContain('[object Object]');
  });

  it('λίστα αντικειμένων → οι εγγραφές διαβάζονται, χωρισμένες με «·»', () => {
    const r = formatCustomValue(METER_READINGS);
    expect(r.kind).toBe('text');
    expect(r.kind === 'text' && r.text).toBe(
      'Register: Ημερήσια, Previous: 12340, Current: 13120 · Register: Νυχτερινή, Previous: 4400, Current: 4710',
    );
  });

  it('πολύ βαθιά δομή → πτυσσόμενο με το ΠΡΑΓΜΑΤΙΚΟ JSON, με περίληψη που λέει τι είναι', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const r = formatCustomValue(deep);
    expect(r.kind).toBe('json');
    if (r.kind !== 'json') throw new Error('unreachable');
    expect(r.text).toBe('1 πεδία');
    expect(JSON.parse(r.json)).toEqual(deep);
    expect(r.json).not.toContain('[object Object]');
  });

  it('πολύ ΜΑΚΡΥ inline κείμενο πέφτει κι αυτό σε πτυσσόμενο', () => {
    const many = Array.from({ length: 60 }, (_, i) => `ΚΩΔΙΚΟΣ-${i}`);
    const r = formatCustomValue(many);
    expect(r.kind).toBe('json');
    expect(r.kind === 'json' && r.text).toBe('60 εγγραφές');
  });

  it('κυκλική δομή δεν ρίχνει τίποτα', () => {
    const a: Record<string, unknown> = { name: 'Α' };
    a.self = a;
    const r = formatCustomValue(a);
    expect(r.kind).toBe('json');
    expect(() => customValueText(a)).not.toThrow();
  });

  it('καμία είσοδος δεν παράγει ΠΟΤΕ «[object Object]»', () => {
    const inputs: unknown[] = [
      METER_READINGS, SELF_READING, { a: { b: { c: {} } } }, [[{ x: 1 }]], [{}], { k: {} },
      [null, undefined], { k: [] }, 'x', 3, true, new Date('2026-05-01T00:00:00Z'),
    ];
    for (const v of inputs) {
      expect(customValueText(v)).not.toContain('[object Object]');
      const view = formatCustomValue(v);
      if (view.kind === 'text') expect(view.text).not.toContain('[object Object]');
      if (view.kind === 'json') expect(view.json).not.toContain('[object Object]');
    }
  });
});

describe('formatCustomFields', () => {
  it('ανθρωποποιεί τα κλειδιά και κρατά τα κενά ως «—» (ο πίνακας «Ειδικά πεδία»)', () => {
    const rows = formatCustomFields({ poso_pliromis: '124,00', meter_readings: METER_READINGS, kenos: null });
    expect(rows.map((r) => r.label)).toEqual(['Poso Pliromis', 'Meter Readings', 'Kenos']);
    expect(rows[2].value).toEqual({ kind: 'empty' });
  });

  it('με `skipEmpty` (η σειρά κάτω από τη γραμμή) τα κενά φεύγουν', () => {
    const rows = formatCustomFields({ partida: 'L-9', kenos: '', lista: [] }, { skipEmpty: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'partida', label: 'Partida' });
  });

  it('τίποτα/λάθος τύπος → καμία σειρά', () => {
    expect(formatCustomFields(null)).toEqual([]);
    expect(formatCustomFields(undefined)).toEqual([]);
  });
});

describe('humanizeKey', () => {
  it('κάτω παύλες → κενά, κεφαλαίο αρχικό', () => {
    expect(humanizeKey('self_reading_period')).toBe('Self Reading Period');
    expect(humanizeKey('po')).toBe('Po');
  });
});
