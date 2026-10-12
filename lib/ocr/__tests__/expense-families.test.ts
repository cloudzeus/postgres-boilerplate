import { describe, expect, it } from 'vitest';
import { classifyExpenseFamily, familyMemoryKeyLabel, familyMemoryKeys, FAMILY_REGISTRY_HINT } from '@/lib/ocr/expense-families';
import { normalizeGreek } from '@/lib/ocr/doc-type-classify';

describe('classifyExpenseFamily — πραγματικές γραμμές του demo', () => {
  it.each([
    ['Ναύλος (Freight)', 'freight'],
    ['RELEASE OF EMPTY', 'freight'],
    ['VGM', 'freight'],
    ['B/L FEE', 'freight'],
    ['AGENCY FEE', 'freight'],
    ['Freight', 'freight'],
    ['Stability Surcharge', 'freight'],
    ['INTERNATIONAL TRANSPORT SERVICE ON DESTINATION: MEGARA/GR/-G', 'freight'],
    ['7 - ΜΕΤΑΦΟΡΕΣ CONEX', 'freight'],
    ['ΑΜΟΛΥΒΔΗ BEST VALUE 95', 'fuel'],
    ['DIESEL EKONOMY', 'fuel'],
    ['ΚΑΥΣΙΜΟ VPOWER DIESEL', 'fuel'],
    ['Soft1 Cloud Client [Ανανέωση συνδρομής]', 'software'],
    ['Soft1 Web Services Connector [Νέο Συμβόλαιο] [Έτη: 1]', 'software'],
    ['Soft1 OpEn Business User > 10', 'software'],
    ['Google Cloud - Fee for April 2026', 'software'],
    ['Τιμολόγιο for WooCommerce', 'software'],
    ['Ανανέωση Ονόματος Χώρου GR Ανανέωση του wwa.gr για 2 χρόνια', 'hosting'],
    ['ΙΟΥΛΙΟΣ 2026 -112 ΑΤΟΜΑ ΜΙΣΘΟΔΟΣΙΑ -1 JL10 -1 ΤΗΡΗΣΗ ΑΔΕΙΩΝ-', 'fees'],
    ['Q1 2026-COMMISSION', 'commission'],
    ['Αμοιβή εκτελωνιστή', 'customs'],
  ])('%s → %s', (name, family) => {
    expect(classifyExpenseFamily(name)).toBe(family);
  });

  it.each([
    'Reactor 16m3', 'C 30/37', 'ΥΓΡΟ ΑΖΩΤΟ', 'EV 322 SP 00 ΗΛΕΚΤΡΟΒΑΛΒΙΔΑ', 'NB APPLE MACBOOK PRO 14-INCH/M3/1T/SBK',
    'Order number S0201234570 ST POWDER COATINGS SPA, Item number', 'ΚΟΛΛΑΡΑ ΜΑΚΡ.BW304L SCH10 2\'',
    'Multi-purpose shears D820-200', 'ΑΝΤΛΙΑ Κ.Μ',
  ])('είδος/πάγιο/πρώτη ύλη δεν είναι οικογένεια δαπάνης: %s', (name) => {
    expect(classifyExpenseFamily(name)).toBeNull();
  });
});

describe('κλειδιά', () => {
  it('με ΦΠΑ πρώτα, μετά χωρίς· ετικέτα', () => {
    expect(familyMemoryKeys('freight', 24)).toEqual(['@family:freight@24', '@family:freight']);
    expect(familyMemoryKeys('freight', null)).toEqual(['@family:freight']);
    expect(familyMemoryKeyLabel('@family:fuel@24')).toBe('Καύσιμα · 24%');
    expect(familyMemoryKeyLabel('@utility:water:consumption')).toBeNull();
  });
});

describe('FAMILY_REGISTRY_HINT — ποια μητρώα προτείνονται', () => {
  const hit = (f: keyof typeof FAMILY_REGISTRY_HINT, name: string) => FAMILY_REGISTRY_HINT[f].test(normalizeGreek(name));
  it('ναύλοι: μεταφορικά αγορών ναι, ενοίκια μεταφορικών μέσων όχι', () => {
    expect(hit('freight', 'Μεταφορικά (Εισαγωγών) 24%')).toBe(true);
    expect(hit('freight', 'Μεταφορικά Αγορών')).toBe(true);
    expect(hit('freight', 'Έξοδα μεταφ.υλικών-αγαθών αγορών με μέσα τρίτων με ΦΠΑ 24%')).toBe(true);
    expect(hit('freight', 'Ενοίκια μεταφορικών μέσων')).toBe(false);
  });
  it('λογισμικό: όχι συνδρομές σε περιοδικά', () => {
    expect(hit('software', 'Συνδρομές σε περιοδικά και εφημερίδες με Φ.Π.Α. 24%')).toBe(false);
    expect(hit('software', 'Άδειες χρήσης λογισμικού')).toBe(true);
  });
});
