import { describe, it, expect } from 'vitest';
import { MIN_SIZE, clampBbox, moveBbox, resizeBbox, nudgeBbox, type Handle } from '../geometry';
import type { Bbox } from '../schema';

describe('clampBbox', () => {
  it('keeps the box inside the page and above the minimum size', () => {
    expect(clampBbox([-0.1, 0.2, 0.5, 0.3])).toEqual([0, 0.2, 0.5, 0.3]);
    expect(clampBbox([0.8, 0.9, 0.5, 0.3])).toEqual([0.5, 0.7, 0.5, 0.3]);
    expect(clampBbox([0.5, 0.5, 0.001, 0.001])).toEqual([0.5, 0.5, MIN_SIZE, MIN_SIZE]);
  });
  it('caps a box wider or taller than the page and pulls it back to the origin', () => {
    expect(clampBbox([0.3, 0.2, 1.4, 0.3])).toEqual([0, 0.2, 1, 0.3]);
    expect(clampBbox([0.3, 0.2, 0.3, 2])).toEqual([0.3, 0, 0.3, 1]);
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
  // Dragging an edge PAST the one opposite it must stop at MIN_SIZE, never invert the box —
  // a negative width would be drawn as an empty div and read as an empty crop.
  it('stops at the opposite edge instead of inverting — w', () => {
    expect(resizeBbox(b, 'w', 0.5, 0)).toEqual([0.59, 0.2, MIN_SIZE, 0.4]);
  });
  it('stops at the opposite edge instead of inverting — n', () => {
    expect(resizeBbox(b, 'n', 0, 0.5)).toEqual([0.2, 0.59, 0.4, MIN_SIZE]);
  });
  it('stops at the opposite edge instead of inverting — e', () => {
    expect(resizeBbox(b, 'e', -0.5, 0)).toEqual([0.2, 0.2, MIN_SIZE, 0.4]);
  });
});
describe('nudgeBbox', () => {
  it('moves by one step, or resizes with shift', () => {
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowRight', false)).toEqual([0.205, 0.2, 0.4, 0.4]);
    expect(nudgeBbox([0.2, 0.2, 0.4, 0.4], 'ArrowDown', true)).toEqual([0.2, 0.2, 0.4, 0.405]);
  });
  it('is a no-op for any other key — including the names on Object.prototype', () => {
    const b: Bbox = [0.2, 0.2, 0.4, 0.4];
    for (const key of ['Enter', 'a', 'toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(nudgeBbox(b, key, false)).toBe(b);
      expect(nudgeBbox(b, key, true)).toBe(b);
    }
  });
  // The caller commits an edit only when the reference changes, so a box that cannot move must come
  // back as the very same array — not as an equal copy.
  it('hands the SAME array back when the clamp leaves the box exactly where it was', () => {
    const flush: Bbox = [0, 0, 0.4, 0.4];
    expect(nudgeBbox(flush, 'ArrowLeft', false)).toBe(flush);
    expect(nudgeBbox(flush, 'ArrowUp', false)).toBe(flush);
    // Already the whole page: Shift+↓ has nothing left to grow into.
    const full: Bbox = [0, 0, 1, 1];
    expect(nudgeBbox(full, 'ArrowDown', true)).toBe(full);
    // A nudge that DOES move still hands back a fresh array.
    expect(nudgeBbox(flush, 'ArrowRight', false)).not.toBe(flush);
  });
  it('does not drift: 100 there-and-back nudges land exactly where they started', () => {
    const start: Bbox = [0.2, 0.2, 0.4, 0.4];
    let b: Bbox = start;
    for (let i = 0; i < 100; i++) {
      b = nudgeBbox(b, 'ArrowRight', false);
      b = nudgeBbox(b, 'ArrowLeft', false);
    }
    expect(b).toEqual(start);
    for (let i = 0; i < 100; i++) {
      b = nudgeBbox(b, 'ArrowDown', true);
      b = nudgeBbox(b, 'ArrowUp', true);
    }
    expect(b).toEqual(start);
  });
});
