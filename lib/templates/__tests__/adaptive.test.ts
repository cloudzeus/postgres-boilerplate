import { describe, it, expect } from 'vitest';
import { ADAPTIVE_CONFIDENCE, WIDEN_FACTOR, adaptiveRegion, lastGoodForRegion, searchBoxes, toLastGood, updateLastGood, widenBbox } from '../adaptive';
import type { Bbox } from '../schema';

const REGION = { page: 0, bbox: [0.4, 0.4, 0.2, 0.1] as Bbox };

describe('widenBbox', () => {
  it('grows by the factor of w/h on each side', () => {
    expect(widenBbox([0.4, 0.4, 0.2, 0.1], 0.15)).toEqual([0.37, 0.385, 0.26, 0.13]);
  });
  it('defaults to WIDEN_FACTOR', () => {
    expect(widenBbox([0.4, 0.4, 0.2, 0.1])).toEqual(widenBbox([0.4, 0.4, 0.2, 0.1], WIDEN_FACTOR));
    expect(WIDEN_FACTOR).toBe(0.15);
  });
  it('clamps to the page at the edges instead of walking off it', () => {
    const b = widenBbox([0, 0, 0.5, 0.5], 0.5);
    expect(b[0]).toBe(0);
    expect(b[1]).toBe(0);
    expect(b[0] + b[2]).toBeLessThanOrEqual(1);
    expect(b[1] + b[3]).toBeLessThanOrEqual(1);
  });
  it('never exceeds the whole page', () => {
    const b = widenBbox([0.1, 0.1, 0.8, 0.8], 0.9);
    expect(b).toEqual([0, 0, 1, 1]);
  });
  it('a non-positive factor is a no-op (still clamped/rounded)', () => {
    expect(widenBbox([0.4, 0.4, 0.2, 0.1], 0)).toEqual([0.4, 0.4, 0.2, 0.1]);
  });
});

describe('searchBoxes', () => {
  it('is the template region, then the widened template region, when nothing was learned', () => {
    expect(searchBoxes({ region: REGION, lastGood: null })).toEqual([REGION.bbox, widenBbox(REGION.bbox)]);
  });
  it('widens around lastGood when it differs from the region', () => {
    const lastGood = { page: 0, bbox: [0.42, 0.5, 0.2, 0.1] as Bbox, at: '2026-09-11T00:00:00.000Z', n: 3 };
    expect(searchBoxes({ region: REGION, lastGood })).toEqual([REGION.bbox, widenBbox(lastGood.bbox)]);
  });
  it('falls back to the region when lastGood repeats it exactly', () => {
    const lastGood = { page: 0, bbox: REGION.bbox, at: 'x', n: 2 };
    expect(searchBoxes({ region: REGION, lastGood })).toEqual([REGION.bbox, widenBbox(REGION.bbox)]);
  });
  it('has nothing to search when the field has no region', () => {
    expect(searchBoxes({ region: null, lastGood: null })).toEqual([]);
  });
});

describe('adaptiveRegion', () => {
  it('carries the page of the box it widened', () => {
    const lastGood = { page: 2, bbox: [0.42, 0.5, 0.2, 0.1] as Bbox, at: 'x', n: 3 };
    expect(adaptiveRegion({ region: REGION, lastGood })).toEqual({ page: 2, bbox: widenBbox(lastGood.bbox) });
  });
  it('uses the region page when nothing was learned', () => {
    expect(adaptiveRegion({ region: { page: 1, bbox: REGION.bbox }, lastGood: null }))
      .toEqual({ page: 1, bbox: widenBbox(REGION.bbox) });
  });
  it('is null without a region', () => {
    expect(adaptiveRegion({ region: null, lastGood: null })).toBeNull();
  });
});

describe('updateLastGood', () => {
  it('starts the average at n = 1', () => {
    expect(updateLastGood(null, 0, [0.4, 0.4, 0.2, 0.1], 'T')).toEqual({ page: 0, bbox: [0.4, 0.4, 0.2, 0.1], at: 'T', n: 1 });
  });
  it('is a moving average weighted by n, and takes the latest page', () => {
    const prev = { page: 0, bbox: [0.4, 0.4, 0.2, 0.1] as Bbox, at: 'T0', n: 1 };
    // (0.4*1 + 0.6)/2 = 0.5 on x; the rest is unchanged.
    expect(updateLastGood(prev, 1, [0.6, 0.4, 0.2, 0.1], 'T1')).toEqual({ page: 1, bbox: [0.5, 0.4, 0.2, 0.1], at: 'T1', n: 2 });
  });
  it('caps the weight and the count at 10 so the average never freezes solid', () => {
    let lg = updateLastGood(null, 0, [0.4, 0.4, 0.2, 0.1], 'T');
    for (let i = 0; i < 30; i += 1) lg = updateLastGood(lg, 0, [0.4, 0.4, 0.2, 0.1], 'T');
    expect(lg.n).toBe(10);
    // A new observation still moves the box by 1/11th of the distance.
    const moved = updateLastGood(lg, 0, [0.51, 0.4, 0.2, 0.1], 'T');
    expect(moved.bbox[0]).toBeCloseTo((0.4 * 10 + 0.51) / 11, 3);
    expect(moved.n).toBe(10);
  });
});

describe('toLastGood', () => {
  it('reads a stored row back', () => {
    expect(toLastGood({ page: 1, bbox: [0.1, 0.1, 0.2, 0.2], at: 'T', n: 4 }))
      .toEqual({ page: 1, bbox: [0.1, 0.1, 0.2, 0.2], at: 'T', n: 4 });
  });
  it('rejects anything that is not a usable box', () => {
    expect(toLastGood(null)).toBeNull();
    expect(toLastGood({})).toBeNull();
    expect(toLastGood({ page: 0, bbox: [0, 0, 0, 0], at: 'T', n: 1 })).toBeNull();
    expect(toLastGood({ page: 0, bbox: 'x', at: 'T', n: 1 })).toBeNull();
  });
  it('repairs a missing/invalid count and page', () => {
    expect(toLastGood({ bbox: [0.1, 0.1, 0.2, 0.2] })).toEqual({ page: 0, bbox: [0.1, 0.1, 0.2, 0.2], at: '', n: 1 });
  });
});

describe('constants', () => {
  it('reads in a widened radius are worth a human glance', () => {
    expect(ADAPTIVE_CONFIDENCE).toBe(0.5);
  });
});

describe('lastGoodForRegion', () => {
  const R = (page: number, bbox: Bbox) => ({ page, bbox });

  it('leaves the learned position alone when the box did not move', () => {
    expect(lastGoodForRegion(R(0, [0.1, 0.1, 0.2, 0.2]), R(0, [0.1, 0.1, 0.2, 0.2]), 'T')).toBeUndefined();
    expect(lastGoodForRegion(null, null, 'T')).toBeUndefined();
  });
  it('restarts the average on the box the user just drew', () => {
    expect(lastGoodForRegion(R(0, [0.1, 0.1, 0.2, 0.2]), R(1, [0.1, 0.1, 0.2, 0.2]), 'T'))
      .toEqual({ page: 1, bbox: [0.1, 0.1, 0.2, 0.2], at: 'T', n: 1 });
    expect(lastGoodForRegion(null, R(0, [0.3, 0.3, 0.1, 0.1]), 'T'))
      .toEqual({ page: 0, bbox: [0.3, 0.3, 0.1, 0.1], at: 'T', n: 1 });
  });
  it('clears it when the region is removed', () => {
    expect(lastGoodForRegion(R(0, [0.1, 0.1, 0.2, 0.2]), null, 'T')).toBeNull();
  });
});
