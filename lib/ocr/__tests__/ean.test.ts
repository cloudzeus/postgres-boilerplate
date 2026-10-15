import { describe, it, expect } from 'vitest';
import { isValidGtin, lineEan } from '../ean';

describe('isValidGtin / lineEan', () => {
  it('έγκυρα EAN-13 / EAN-8 / UPC-A', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('5201234567894')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
  });
  it('λάθος ψηφίο ελέγχου ή μη αριθμητικό ⇒ όχι', () => {
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('M-99-41034')).toBe(false);
    expect(isValidGtin('978960598')).toBe(false); // 9 ψηφία: κωδικός, όχι barcode
  });
  it('το διαβασμένο EAN προηγείται· αλλιώς ο κωδικός της γραμμής αν είναι barcode', () => {
    expect(lineEan('4006381333931', 'M-1')).toBe('4006381333931');
    expect(lineEan(null, '4006381333931')).toBe('4006381333931');
    expect(lineEan('123', 'M-99-41034')).toBeNull();
  });
});
