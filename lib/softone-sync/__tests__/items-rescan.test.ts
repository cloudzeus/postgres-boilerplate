// Επανέλεγχος ειδών: ποιο είδος παίρνει μια γραμμή χωρίς αντιστοίχιση. Συνθετικά είδη.
import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
import { buildRescanIndex, pickItemForLine, type RescanItem } from '@/lib/softone-sync/items-rescan';

const ITEMS: RescanItem[] = [
  { mtrl: 1, code: '978960700', code1: '5201234567894', code2: 'ZX-80', name: 'ΣΩΛΗΝΑΣ Φ80 4M', isService: false },
  { mtrl: 2, code: '978960701', code1: null, code2: null, name: 'ΚΑΠΑΚΙ Φ80', isService: false },
  { mtrl: 3, code: '978960702', code1: null, code2: null, name: 'ΒΙΔΑ', isService: false },
  { mtrl: 4, code: '978960703', code1: null, code2: null, name: 'ΒΙΔΑ', isService: false },
];
const idx = buildRescanIndex(ITEMS, [{ mtrl: 2, trdr: 959, code: 'SUP-123' }]);
const line = (p: Partial<{ code: string; ean: string; mfrCode: string; name: string; trdr: number }>) =>
  ({ code: null, ean: null, mfrCode: null, name: '', trdr: null, ...p });

describe('pickItemForLine', () => {
  it('κωδικός προμηθευτή του ΙΔΙΟΥ εκδότη πρώτα', () => {
    expect(pickItemForLine(line({ code: 'SUP-123', trdr: 959 }), idx)).toMatchObject({ item: { mtrl: 2 }, by: 'supcode' });
    expect(pickItemForLine(line({ code: 'SUP-123', trdr: 111 }), idx)).toBeNull();
  });
  it('EAN → CODE1, κωδ. κατασκευαστή → CODE2, κωδικός γραμμής σε οποιονδήποτε', () => {
    expect(pickItemForLine(line({ ean: '5201234567894' }), idx)).toMatchObject({ item: { mtrl: 1 }, by: 'code1' });
    expect(pickItemForLine(line({ mfrCode: 'ZX-80' }), idx)).toMatchObject({ item: { mtrl: 1 }, by: 'code2' });
    expect(pickItemForLine(line({ code: '978960701' }), idx)).toMatchObject({ item: { mtrl: 2 }, by: 'code' });
  });
  it('ίδια περιγραφή μόνο όταν είναι μοναδική', () => {
    expect(pickItemForLine(line({ name: 'Σωλήνας Φ80 4m' }), idx)?.item.mtrl).toBe(1);
    expect(pickItemForLine(line({ name: 'ΒΙΔΑ' }), idx)).toBeNull();
  });
});
