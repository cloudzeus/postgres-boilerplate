import { describe, it, expect } from 'vitest';
import { buildBreadcrumb } from '@/lib/regions/tree';

describe('buildBreadcrumb', () => {
  it('keys an ordered Δήμος chain into region/regionalUnit/municipality', () => {
    const chain = [
      { code: '111', nameEL: 'ΠΕΡΙΦΕΡΕΙΑ ΑΝΑΤΟΛΙΚΗΣ ΜΑΚΕΔΟΝΙΑΣ ΚΑΙ ΘΡΑΚΗΣ', level: 3 },
      { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ', level: 4 },
      { code: '1110202', nameEL: 'ΔΗΜΟΣ ΔΟΞΑΤΟΥ', level: 5 },
    ];
    const b = buildBreadcrumb(chain);
    expect(b.region?.code).toBe('111');
    expect(b.regionalUnit?.code).toBe('11102');
    expect(b.municipality?.nameEL).toBe('ΔΗΜΟΣ ΔΟΞΑΤΟΥ');
  });

  it('leaves municipality null when the chain only reaches a Π.Ε.', () => {
    const chain = [
      { code: '111', nameEL: 'ΠΕΡΙΦΕΡΕΙΑ Α.Μ.Θ.', level: 3 },
      { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ', level: 4 },
    ];
    const b = buildBreadcrumb(chain);
    expect(b.regionalUnit?.code).toBe('11102');
    expect(b.municipality).toBeNull();
  });
});
