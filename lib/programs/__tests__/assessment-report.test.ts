import { describe, it, expect } from 'vitest';
import { buildAssessmentNarrative, buildAssessmentDocx, type AssessmentForReport } from '../assessment-report';

const base: AssessmentForReport = {
  overallVerdict: 'ELIGIBLE',
  eligible: true,
  eligibilityResult: {
    eligible: true,
    criteria: [
      { key: 'kad', label: 'ΚΑΔ', required: null, actual: '62.01.11', pass: true, note: 'επιλέξιμος ΚΑΔ' },
      { key: 'legalForm', label: 'Νομική μορφή', required: 'ΙΚΕ, ΑΕ', actual: 'ΙΚΕ', pass: true },
    ],
  },
  questionnaireScore: '82.5',
  questionnaireMax: '100',
  questionnairePassed: true,
  createdAt: new Date('2026-05-29T00:00:00Z'),
  company: { name: 'ΔΟΚΙΜΗ ΙΚΕ', afm: '123456789', legalForm: 'ΙΚΕ', regionCode: '111' },
  program: { title: 'Ψηφιακός Μετασχηματισμός', referenceCode: 'ΕΣΠΑ-2026-01' },
  questionnaire: { threshold: '75', maxScore: '100', sourceNote: 'Παράρτημα III' },
};

describe('buildAssessmentNarrative', () => {
  it('explains approval with score above the minimum', () => {
    const txt = buildAssessmentNarrative(base).join(' ');
    expect(txt).toMatch(/ΠΛΗΡΟΙ/);
    expect(txt).toMatch(/82\.5/);
    expect(txt).toMatch(/75/);
  });
  it('lists failed criteria when not eligible', () => {
    const txt = buildAssessmentNarrative({
      ...base, overallVerdict: 'NOT_ELIGIBLE', eligible: false,
      eligibilityResult: { eligible: false, criteria: [{ key: 'legalForm', label: 'Νομική μορφή', required: 'ΚοινΣΕπ', actual: 'ΕΠΕ', pass: false }] },
    }).join(' ');
    expect(txt).toMatch(/ΔΕΝ πληροί/);
    expect(txt).toMatch(/Νομική μορφή/);
  });
  it('flags below-threshold score as needs-review', () => {
    const txt = buildAssessmentNarrative({ ...base, overallVerdict: 'NEEDS_REVIEW', questionnaireScore: '60', questionnairePassed: false }).join(' ');
    expect(txt).toMatch(/ΥΠΟΛΕΙΠΕΤΑΙ/);
  });
});

describe('buildAssessmentDocx', () => {
  it('produces a non-empty .docx buffer (valid zip header PK)', async () => {
    const buf = await buildAssessmentDocx(base);
    expect(buf.length).toBeGreaterThan(1000);
    // .docx is a zip — first two bytes are 'PK'
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
  it('builds for a not-eligible assessment without a questionnaire', async () => {
    const buf = await buildAssessmentDocx({ ...base, overallVerdict: 'NOT_ELIGIBLE', eligible: false, questionnaireScore: null, questionnaireMax: null, questionnairePassed: null, questionnaire: null });
    expect(buf.length).toBeGreaterThan(1000);
  });
});
