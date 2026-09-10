import { describe, it, expect } from 'vitest';
import { MIN_SIZE, clampBbox, moveBbox, resizeBbox, nudgeBbox, type Handle } from '../geometry';

describe('clampBbox', () => {
  it('keeps the box inside the page and above the minimum size', () => {
    expect(clampBbox([-0.1, 0.2, 0.5, 0.3])).toEqual([0, 0.2, 0.5, 0.3]);
    expect(clampBbox([0.8, 0.9, 0.5, 0.3])).toEqual([0.5, 0.7, 0.5, 0.3]);
    expect(clampBbox([0.5, 0.5, 0.001, 0.001])).toEqual([0.5, 0.5, MIN_SIZE, MIN_SIZE]);
  });
});
describe('moveBbox', () => {
  it('translates and clamps', () => {
    expect(moveBbox([0.1, 0.1, 0.2, 0.2], 0.05, -0.2)).toEqual([0.15, 0, 0.2, 0.2]);
  });
});
describe('resizeBbox', () => {
  const b: [number, number, number, number] = [0.2, 0.2, 0.4, 0.4];
  it.each<[Handle, number, number, number[]]>([
    ['se', 0.1, 0.1, [0.2, 0.2, 0.5, 0.5]],
    ['nw', 0.1, 0.1, [0.3, 0.3, 0.3, 0.3]],
    ['e', 0.1, 0.5, [0.2, 0.2, 0.5, 0.4]],
    ['n', 0, -0.1, [0.2, 0.1, 0.4, 0.5]],
    ['w', -0.3, 0, [0, 0.2, 0.6, 0.4]],
  ])('%s handle', (h, dx, dy, expected) => { expect(resizeBbox(b, h, dx, dy).map((n) => +n.toFixed(3))).toEqual(expected); });
  it('never shrinks below MIN_SIZE (handle stops)', () => {
    const r = resizeBbox(b, 'se', -0.39, -0.39);
    expect(r[2]).toBeCloseTo(MIN_SIZE); expect(r[3]).toBeCloseTo(MIN_SIZE); expect(r[0]).toBe(0.2);
  });
});
describe('nudgeBbox', () => {
  it('moves by one step, or resizes with shift', () => {
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowRight', false)).toEqual([0.205, 0.2, 0.4, 0.4]);
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowDown', true)).toEqual([0.2, 0.2, 0.4, 0.405]);
  });
});
