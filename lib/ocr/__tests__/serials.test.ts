// Πραγματικές περιγραφές γραμμών από τα παραστατικά της ουράς (2026-10-12).
import { describe, it, expect } from 'vitest';
import { extractSerials } from '../serials';

describe('extractSerials', () => {
  it.each([
    ['ΠΡΟΓΡΑΜΜΑ ΑΝΑΒΑΘΜΙΣΗΣ IRIS SN: DMV24000230-P', ['DMV24000230-P']],
    ['ΠΡΟΓΡΑΜΜΑ ΑΝΑΒΑΘΜΙΣΗΣ ΟΡΙΣΤΙΚΗ ΠΑΥΣ SN: DMV24001420-P ID', ['DMV24001420-P']],
    // Πραγματικό: το «ID: 159894» είναι άλλο πεδίο της συσκευής, ΟΧΙ δεύτερος σειριακός.
    ['ΠΡΟΓΡΑΜΜΑ ΑΝΑΒΑΘΜΙΣΗΣ IRIS SN: DMV24000230-P.ID: 159894', ['DMV24000230-P']],
    ['ΑΝΑΒΑΘΜΙΣΗ SN: DMV24000771-P ID: 159894', ['DMV24000771-P']],
    ['NB APPLE MACBOOK PRO 14-INCH/M3/1T/SBK S/N SDFJC09HM7G', ['SDFJC09HM7G']],
    ['Terminal CN51 Serial No: 21158D8219, 21158D8220', ['21158D8219', '21158D8220']],
    ['Ταμειακή Σ/Ν ΔΜΒ12345678', ['ΔΜΒ12345678']],
  ])('%s → %j', (text, want) => {
    expect(extractSerials(text)).toEqual(want);
  });

  it('ΟΧΙ ψευδοσειριακός χωρίς ψηφίο: «Soft1 OpEn Serial Numbers-Service»', () => {
    expect(extractSerials('Soft1 OpEn Serial Numbers-Service [Εκδόσεις-eServices]')).toEqual([]);
  });

  it('κενό ή χωρίς ετικέτα ⇒ τίποτα', () => {
    expect(extractSerials(null)).toEqual([]);
    expect(extractSerials('Malleable cast iron screw clamp TGRC 160/80')).toEqual([]);
  });

  it('χωρίς διπλότυπα, με τη σειρά εμφάνισης', () => {
    expect(extractSerials('SN: AB1234 · S/N AB1234 · SN: CD5678')).toEqual(['AB1234', 'CD5678']);
  });
});
