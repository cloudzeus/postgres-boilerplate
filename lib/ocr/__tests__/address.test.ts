import { describe, it, expect } from 'vitest';
import { splitGluedAddress } from '../address';

describe('splitGluedAddress', () => {
  it('σπάει κολλημένες γραμμές ξένης διεύθυνσης', () => {
    expect(splitGluedAddress('VelascoClanwilliam PlaceDublin 2Ireland'))
      .toBe('Velasco, Clanwilliam Place, Dublin 2, Ireland');
  });

  it('σπάει και ελληνικά', () => {
    expect(splitGluedAddress('Λ. ΚΗΦΙΣΙΑΣ 10Μαρούσι 15125'))
      .toBe('Λ. ΚΗΦΙΣΙΑΣ 10, Μαρούσι 15125');
  });

  it('αφήνει ήσυχη μια κανονική διεύθυνση', () => {
    expect(splitGluedAddress('Mühlestrasse 40 - 74321 Bietigheim-Bissingen'))
      .toBe('Mühlestrasse 40 - 74321 Bietigheim-Bissingen');
    expect(splitGluedAddress('Friedrichstraße 1, 10117 Berlin, Deutschland'))
      .toBe('Friedrichstraße 1, 10117 Berlin, Deutschland');
    expect(splitGluedAddress('ΛΕΩΦ. ΚΗΦΙΣΙΑΣ 10, ΜΑΡΟΥΣΙ 15125'))
      .toBe('ΛΕΩΦ. ΚΗΦΙΣΙΑΣ 10, ΜΑΡΟΥΣΙ 15125');
  });

  it('δεν σπάει μέσα σε ακρωνύμια / νομικές μορφές', () => {
    expect(splitGluedAddress('Beispiel GmbH, Berlin')).toBe('Beispiel GmbH, Berlin');
    expect(splitGluedAddress('Example BV Amsterdam')).toBe('Example BV Amsterdam');
    expect(splitGluedAddress('ΠΑΡΑΔΕΙΓΜΑ ΑΕΒΕ ΑΘΗΝΑ')).toBe('ΠΑΡΑΔΕΙΓΜΑ ΑΕΒΕ ΑΘΗΝΑ');
  });

  it('μαζεύει διπλά κενά, διπλά κόμματα και νέες γραμμές', () => {
    expect(splitGluedAddress('Friedrichstr. 1\n10117 Berlin')).toBe('Friedrichstr. 1 10117 Berlin');
    expect(splitGluedAddress('Οδός 1 ,, Αθήνα')).toBe('Οδός 1, Αθήνα');
    expect(splitGluedAddress('  , Οδός 1 ,  ')).toBe('Οδός 1');
  });

  it('κενό / άκυρο → κενό string', () => {
    expect(splitGluedAddress('')).toBe('');
    expect(splitGluedAddress('   ')).toBe('');
    expect(splitGluedAddress(undefined as unknown as string)).toBe('');
  });
});
