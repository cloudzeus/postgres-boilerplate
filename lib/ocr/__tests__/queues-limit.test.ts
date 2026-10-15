import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ prisma: {} }));
import { mapWithLimit } from '../queues';

describe('mapWithLimit', () => {
  it('κρατά τη σειρά και δεν ξεπερνά το όριο ταυτόχρονων', async () => {
    let running = 0; let peak = 0;
    const out = await mapWithLimit([5, 1, 4, 2, 3, 0], 2, async (x) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, x));
      running--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
    expect(await mapWithLimit([], 3, async (x) => x)).toEqual([]);
  });
});
