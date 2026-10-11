import { describe, expect, it } from 'vitest';
import {
  analyzeUtility, classifyUtilityCharge, detectUtility, utilityMemoryKey, utilityMemoryKeyLabel,
  utilityInputFromDocument,
} from '@/lib/ocr/utility-bills';

const L = (name: string, amount: number, vatRate: number | null = 6) => ({ name, amount, vatRate });

// Πραγματικά παραστατικά της παρουσίασης (συντομευμένα).
const HERON = {
  issuerAfm: '099810593', issuerName: 'ΗΡΩΝ ΕΝΕΡΓΕΙΑΚΗ Α.Ε', label: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ Στοιχεία Λογαριασμού', hasPeriod: true,
  lines: [
    L('Χρεώσεις Προμήθειας Ρεύματος', 57212.91), L('Ρυθμιζόμενες Χρεώσεις', 10289.12),
    L('Συμπληρωματικές Χρεώσεις', 6381.29), L('Τέλος υπέρ ΕΡΤ', 3.06), L('Χρεώσεις Δήμου', 0),
    L('Εγγύηση', 0), L('Εργασίες ΔΕΔΔΗΕ', 0),
  ],
};

describe('detectUtility', () => {
  it('γνωστός ΑΦΜ αρκεί μόνος του', () => {
    expect(detectUtility({ issuerAfm: 'EL094079101', lines: [] })).toMatchObject({ kind: 'water', provider: 'ΕΥΔΑΠ', confidence: 1 });
  });

  it('όνομα παρόχου χρειάζεται και ένδειξη περιεχομένου ή μορφής', () => {
    expect(detectUtility({ issuerName: 'VODAFONE-PANAFON', lines: [L('Αγορά συσκευής', 500, 24)] })).toBeNull();
    expect(detectUtility({ issuerName: 'VODAFONE-PANAFON', label: 'Λογαριασμός', lines: [L('Πάγιο', 30, 24)] }))
      .toMatchObject({ kind: 'telecom', provider: 'Vodafone' });
  });

  it('χωρίς πάροχο: μορφή λογαριασμού και δύο γραμμές του ίδιου είδους', () => {
    const lines = [L('ΥΔΡΕΥΣΗ (5,00M3)', 1.75, 13), L('ΑΠΟΧΕΤΕΥΣΗ', 3, 13)];
    expect(detectUtility({ issuerName: 'ΔΗΜΟΣ ΚΑΠΟΙΟΣ', hasPeriod: true, lines })).toMatchObject({ kind: 'water', provider: null });
    expect(detectUtility({ issuerName: 'ΔΗΜΟΣ ΚΑΠΟΙΟΣ', hasPeriod: false, lines })).toBeNull();
  });

  it('συνηθισμένο τιμολόγιο δεν είναι λογαριασμός', () => {
    expect(detectUtility({ issuerName: 'BESSEY Tool GmbH', label: 'Invoice', lines: [L('Multi-purpose shears', 40, 0)] })).toBeNull();
  });

  it('LeasePlan από ΑΦΜ', () => {
    expect(detectUtility({ issuerAfm: '999599948', lines: [L('AUDI Q3 SPORTBACK', 623.51, 24)] })?.kind).toBe('vehicle_lease');
  });
});

describe('classifyUtilityCharge', () => {
  it('ΗΡΩΝ: κατανάλωση, ΕΡΤ, δήμος, εγγύηση, εργασίες', () => {
    expect(HERON.lines.map((l) => classifyUtilityCharge('electricity', l))).toEqual([
      'consumption', 'consumption', 'consumption', 'ert', 'municipal', 'deposit', 'works',
    ]);
  });

  it('Enerwave: «Δήμου & ΕΡΤ» → δήμος, «Ειδ. Τέλος 5% Ν.2093/92» → φόρος, «Χρεώσεις/Πιστώσεις» → κατανάλωση', () => {
    expect(classifyUtilityCharge('electricity', L('Χρεώσεις Δήμου & ΕΡΤ', 20.74, 0))).toBe('municipal');
    expect(classifyUtilityCharge('electricity', L('Ειδ. Τέλος 5% Ν.2093/92', 0.4, 0))).toBe('tax');
    expect(classifyUtilityCharge('electricity', L('Διάφορες Χρεώσεις/Πιστώσεις (Γ)', 0.77))).toBe('consumption');
  });

  it('ΕΥΔΑΠ: ύδρευση/πάγιο → κατανάλωση, περιβαλλοντικό → φόρος', () => {
    expect(classifyUtilityCharge('water', L('ΥΔΡΕΥΣΗ (265,00M3)', 848, 13))).toBe('consumption');
    expect(classifyUtilityCharge('water', L('ΠΑΓΙΟ ΤΕΛΟΣ', 5.5, 24))).toBe('consumption');
    expect(classifyUtilityCharge('water', L('ΠΕΡΙΒΑΛΛ. ΤΕΛΟΣ', 0.16, 0))).toBe('tax');
  });

  it('Cosmote: εκπτώσεις (αρνητικό ποσό) → έκπτωση, χωρίς ΦΠΑ ανά γραμμή', () => {
    expect(classifyUtilityCharge('telecom', L('Χρέωση παγίων', 1647.22, null))).toBe('consumption');
    expect(classifyUtilityCharge('telecom', L('Εκπτώσεις', -79.89, null))).toBe('discount');
  });

  it('LeasePlan: κάθε όχημα → μίσθωμα', () => {
    expect(classifyUtilityCharge('vehicle_lease', L('FORD TRANSIT CONNECT', 423.11, 24))).toBe('rental');
  });

  it('γραμμή χωρίς ενδείξεις και χωρίς ΦΠΑ μένει χωρίς κατάταξη', () => {
    expect(classifyUtilityCharge('gas', L('AE', 6.52, null))).toBeNull();
    expect(classifyUtilityCharge('gas', L('AE', 6.52, 6))).toBe('consumption');
  });
});

describe('κλειδιά μνήμης', () => {
  it('η έκπτωση μοιράζεται το κλειδί της κατανάλωσης', () => {
    expect(utilityMemoryKey('telecom', 'discount')).toBe('@utility:telecom:consumption');
    expect(utilityMemoryKeyLabel('@utility:electricity:municipal')).toBe('Ρεύμα · Δημοτικά τέλη');
    expect(utilityMemoryKeyLabel('ρευμα')).toBeNull();
  });
});

describe('analyzeUtility', () => {
  it('οικιακή κατανάλωση και ΦΠΑ σε τέλος ΕΡΤ', () => {
    const a = analyzeUtility({
      ...HERON,
      notes: 'για την κατανάλωση του σπιτιού σας',
    })!;
    expect(a.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['residential', 'vat_on_pass_through']));
    // Εγγύηση και εργασίες με μηδενικό ποσό δεν προειδοποιούν.
    expect(a.findings.map((f) => f.code)).not.toContain('deposit');
  });

  it('από το κανονικό JSON', () => {
    const input = utilityInputFromDocument({
      issuer: { name: 'ΗΡΩΝ ΕΝΕΡΓΕΙΑΚΗ Α.Ε', vat: '099810593' },
      type: { label: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ' },
      references: { period: { from: '2026-05-01', to: '2026-05-31' } },
      lines: [{ name: 'Εγγύηση', net: 150, vatRate: 0 }],
    })!;
    const a = analyzeUtility(input)!;
    expect(a.kind).toBe('electricity');
    expect(a.findings.map((f) => f.code)).toContain('deposit');
  });
});
