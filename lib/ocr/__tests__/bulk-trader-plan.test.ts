// Οι περιπτώσεις είναι ΤΑ ΠΡΑΓΜΑΤΙΚΑ δεδομένα της ουράς στις 2026-10-11 — όχι επινοημένα.
import { describe, it, expect } from 'vitest';
import { planRow, guessCountry, type PlanInput } from '../bulk-trader-plan';

const g = (afm: string, name: string, country: string | null, missing: PlanInput['missingKinds'] = []): PlanInput =>
  ({ afm, name, country, suggestedKind: 'supplier', missingKinds: missing });

describe('planRow — τι προεπιλέγεται στη μαζική δημιουργία', () => {
  it('έγκυρο ελληνικό ΑΦΜ ⇒ έτοιμο, με ΑΑΔΕ', () => {
    const r = planRow(g('094079101', 'ΕΥΔΑΠ Α.Ε.', 'GR'));
    expect(r).toMatchObject({ status: 'ready', selected: true, useAade: true, country: 'GR' });
  });

  it('ξένος ΜΕ πρόθεμα ⇒ έτοιμος, χώρα από το πρόθεμα', () => {
    expect(planRow(g('IE3668997OH', 'Google Cloud EMEA Limited', 'IE', ['creditor'])))
      .toMatchObject({ status: 'ready', selected: true, country: 'IE', kind: 'creditor', useAade: false });
    expect(planRow(g('ATU19208701', 'LKW WALTER Internationale Transportorganisation AG', 'AT')))
      .toMatchObject({ status: 'ready', country: 'AT' });
  });

  it.each([
    ['09401924', 'ΟΡΓΑΝΙΣΜΟΣ ΤΗΛΕΠΙΚΟΙΝΩΝΙΩΝ ΤΗΣ ΕΛΛΑΔΟΣ Α.Ε.', '8 ψηφία'],
    ['999867881', 'ENTERSOFT ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ', 'έλεγχο ψηφίου'],
    ['998825619', 'INGENIO ΣΥΣΤΗΜΑΤΑ ΠΛΗΡΟΦΟΡΙΚΗΣ Ε.Ε.', 'έλεγχο ψηφίου'],
  ])('λάθος ανάγνωσης ΑΦΜ (%s) ⇒ ΔΕΝ προεπιλέγεται', (afm, name, why) => {
    const r = planRow(g(afm, name, null));
    expect(r.status).toBe('invalid_afm');
    expect(r.selected).toBe(false);
    expect(r.reason).toContain(why);
  });

  it.each([
    ['8070036187', 'SENLİKOğlu Inoks Kimya Tesisleri San. ve Tic. A.Ş.', 'TR'],
    ['03200690968', 'Azelis Italia S.r.l.', 'IT'],
    ['144960040', 'BESSEY Tool GmbH & Co. KG', 'DE'],
    ['104498780', 'INO TRANSPORT DOO', 'RS'],
    ['11139601', 'Chemical Partners Middle East SAL', 'LB'],
    ['510001340', 'ISRAEL BARTER TRADING Co. Ltd.', 'IL'],
  ])('ξένος ΧΩΡΙΣ πρόθεμα (%s) ⇒ πρόταση χώρας, ΠΟΤΕ σιωπηλό GR, ΔΕΝ προεπιλέγεται', (afm, name, cc) => {
    const r = planRow(g(afm, name, null));
    expect(r).toMatchObject({ status: 'needs_country', country: cc, countryGuessed: true, selected: false });
  });

  it('ο τύπος που ΖΗΤΑ η σειρά προηγείται της γενικής πρότασης', () => {
    expect(planRow(g('094390140', 'ΖΙΜ ΕΛΛΑΣ Α.Ε.', 'GR', ['creditor'])).kind).toBe('creditor');
  });
});

describe('guessCountry', () => {
  it('δεν προτείνει τίποτα από διφορούμενες μορφές', () => {
    expect(guessCountry('Acme Ltd')).toBeNull();
    expect(guessCountry('Systems as a Service')).toBeNull();
  });
});
