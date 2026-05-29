import { describe, it, expect } from 'vitest';
import { normalizeGreek, coreName, nameMatchCandidate, haversineKm, nearestNode } from '@/lib/regions/match';

const NODES = [
  { code: '1110202', nameEL: 'ΔΗΜΟΣ ΔΟΞΑΤΟΥ', latitude: 41.0595867, longitude: 24.2227293 },
  { code: '0511', nameEL: 'ΔΗΜΟΣ ΑΘΗΝΑΙΩΝ', latitude: 37.9838, longitude: 23.7275 },
  { code: '9919901', nameEL: 'ΑΓΙΟ ΟΡΟΣ (Αυτοδιοίκητο)', latitude: 40.28, longitude: 24.18 },
];

// Level-4 nodes (Περιφερειακές Ενότητες / Νομοί) for ΓΕΜΗ prefecture matching
const UNITS = [
  { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ' },
];

describe('normalizeGreek', () => {
  it('uppercases, strips accents and final sigma differences', () => {
    expect(normalizeGreek('Δοξάτο')).toBe('ΔΟΞΑΤΟ');
    expect(normalizeGreek('  αθηνα ')).toBe('ΑΘΗΝΑ');
  });
});

describe('coreName', () => {
  it('drops admin prefixes (ΔΗΜΟΣ / Δ. / ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ / ΝΟΜΟΣ) and parentheticals', () => {
    expect(coreName('ΔΗΜΟΣ ΔΟΞΑΤΟΥ')).toBe('ΔΟΞΑΤΟΥ');
    expect(coreName('ΑΓΙΟ ΟΡΟΣ (Αυτοδιοίκητο)')).toBe('ΑΓΙΟ ΟΡΟΣ');
    expect(coreName('ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ')).toBe('ΔΡΑΜΑΣ');
    expect(coreName('ΝΟΜΟΣ ΔΡΑΜΑΣ')).toBe('ΔΡΑΜΑΣ');
  });
});

describe('nameMatchCandidate against level-4 (ΓΕΜΗ prefecture descr)', () => {
  it('matches a ΓΕΜΗ νομός name "ΔΡΑΜΑΣ" to the Περιφερειακή Ενότητα', () => {
    expect(nameMatchCandidate('ΔΡΑΜΑΣ', UNITS)).toBe('11102');
  });
});

describe('nameMatchCandidate', () => {
  it('matches genitive municipality names from a nominative city (Δοξάτο → ΔΟΞΑΤΟΥ)', () => {
    expect(nameMatchCandidate('Δοξάτο', NODES)).toBe('1110202');
  });
  it('matches Αθήνα → ΔΗΜΟΣ ΑΘΗΝΑΙΩΝ via shared stem', () => {
    expect(nameMatchCandidate('Αθήνα', NODES)).toBe('0511');
  });
  it('returns null for an unknown place', () => {
    expect(nameMatchCandidate('Λονδίνο', NODES)).toBeNull();
  });
  it('returns null for too-short queries', () => {
    expect(nameMatchCandidate('Αθ', NODES)).toBeNull();
  });
});

describe('haversineKm / nearestNode', () => {
  it('computes a sane distance', () => {
    const d = haversineKm({ lat: 37.9838, lng: 23.7275 }, { lat: 40.6401, lng: 22.9444 });
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(320);
  });
  it('finds the nearest node within the cap', () => {
    expect(nearestNode({ lat: 37.99, lng: 23.73 }, NODES, 50)).toBe('0511');
  });
  it('returns null when nothing is within the cap', () => {
    expect(nearestNode({ lat: 0, lng: 0 }, NODES, 50)).toBeNull();
  });
});
