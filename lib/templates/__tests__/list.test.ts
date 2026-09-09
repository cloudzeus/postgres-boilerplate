import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { extractionTemplate: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/db';
import { freeSlug, toListRow } from '../list';

const findMany = prisma.extractionTemplate.findMany as unknown as ReturnType<typeof vi.fn>;

/** What the mocked query would return for `base`, honouring the route's OR filter. */
const rowsFor = (all: string[]) => {
  findMany.mockImplementationOnce(async ({ where }: { where: { OR: [{ slug: string }, { slug: { startsWith: string } }] } }) => {
    const [exact, prefix] = where.OR;
    return all
      .filter((s) => s === exact.slug || s.startsWith(prefix.slug.startsWith))
      .map((slug) => ({ slug }));
  });
};

beforeEach(() => findMany.mockReset());

describe('freeSlug', () => {
  it('returns the base when it is free', async () => {
    rowsFor([]);
    await expect(freeSlug('timologio')).resolves.toBe('timologio');
  });

  it('appends _2 when the base is taken', async () => {
    rowsFor(['timologio']);
    await expect(freeSlug('timologio')).resolves.toBe('timologio_2');
  });

  it('walks past every taken suffix', async () => {
    rowsFor(['timologio', 'timologio_2', 'timologio_3']);
    await expect(freeSlug('timologio')).resolves.toBe('timologio_4');
  });

  it('ignores prefix neighbours that are not part of the base_N family', async () => {
    // 'ironworks_2' starts with 'iron' but is a different slug family — it must not push 'iron' to _3.
    rowsFor(['iron', 'ironworks', 'ironworks_2']);
    await expect(freeSlug('iron')).resolves.toBe('iron_2');
  });

  it('queries the exact slug plus the base_ family only', async () => {
    rowsFor([]);
    await freeSlug('iron');
    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ slug: 'iron' }, { slug: { startsWith: 'iron_' } }] },
      select: { slug: true },
    });
  });
});

describe('toListRow', () => {
  const row = {
    id: 't1', name: 'Τιμολόγιο', slug: 'timologio', department: 'Λογιστήριο', vatNumber: '123456789',
    supplierName: 'ΑΦΟΙ ΠΑΠΑ', mode: 'SEMI_AUTO' as const, status: 'ACTIVE' as const, version: 3, timesUsed: 12,
    sampleStorageKey: 'ocr/samples/t1.pdf', updatedAt: new Date('2026-02-03T10:20:30.000Z'),
    _count: { fields: 5, runs: 7 },
  };

  it('flattens counts, the sample flag and the date', () => {
    expect(toListRow(row)).toEqual({
      id: 't1', name: 'Τιμολόγιο', slug: 'timologio', department: 'Λογιστήριο', vatNumber: '123456789',
      supplierName: 'ΑΦΟΙ ΠΑΠΑ', mode: 'SEMI_AUTO', status: 'ACTIVE', version: 3,
      fieldsCount: 5, runsCount: 7, timesUsed: 12, hasSample: true,
      updatedAt: '2026-02-03T10:20:30.000Z',
    });
  });

  it('reports hasSample false when no sample is stored', () => {
    expect(toListRow({ ...row, sampleStorageKey: null }).hasSample).toBe(false);
  });
});
