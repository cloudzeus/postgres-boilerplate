// lib/ocr/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, REQUIRED_PATHS } from '../templates';

describe('το prompt ζητάει το κανονικό έγγραφο', () => {
  const prompt = buildSystemPrompt('invoice', 'el');

  it('περιγράφει τα μπλοκ του σχήματος v3', () => {
    for (const key of ['"kind"', '"issuer"', '"recipient"', '"lines"', '"totals"', '"vatBreakdown"',
      '"digital"', '"payment"', '"references"', '"handwritten"', '"custom"']) {
      expect(prompt).toContain(key);
    }
  });

  it('δεν ζητάει πια τα παλιά flat κλειδιά', () => {
    for (const legacy of ['companyName', 'customerVatNumber', 'documentTypeLabel', 'aadeMark', 'bankAccounts', 'totalAmount']) {
      expect(prompt).not.toContain(legacy);
    }
  });

  it('κρατάει τις οδηγίες που έχουν κοστίσει: απόδειξη, τύπος αυτολεξεί, IBAN, στοιχεία εκδότη', () => {
    expect(prompt).toMatch(/ΑΠΟΔΕΙΞΗ/);
    expect(prompt).toMatch(/VERBATIM/i);
    expect(prompt).toMatch(/IBAN/);
    expect(prompt).toMatch(/ΓΕΝΙΚΟ ΣΥΝΟΛΟ/);
  });

  it('η απόδειξη διαβάζεται με το ίδιο (υπερσύνολο) σχήμα', () => {
    expect(buildSystemPrompt('receipt', 'el')).toBe(prompt);
  });

  it('κάθε υποχρεωτική διαδρομή ζητιέται από το prompt', () => {
    for (const path of REQUIRED_PATHS.invoice) {
      const [head] = path.split('.');
      expect(prompt).toContain(`"${head}"`);
    }
  });
});

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
