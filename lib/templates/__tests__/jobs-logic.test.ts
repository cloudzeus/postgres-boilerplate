// lib/templates/__tests__/jobs-logic.test.ts — τα καθαρά κομμάτια μιας εργασίας σάρωσης (spec §12, §13).
import { describe, it, expect } from 'vitest';
import {
  finalJobStatus, isActive, isStale, jobToSheetInputs, nextItemOrder, progressOf, STALE_MS,
} from '../jobs-logic';
import type { FieldDef, FieldValue } from '../schema';

const NOW = new Date('2026-09-11T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'k', label: 'K', kind: 'SINGLE', valueType: 'TEXT', color: '#0078D4',
  region: { page: 0, bbox: [0, 0, 0.1, 0.1] }, columns: null, aiHint: null, required: false, order: 0, ...over,
});
const value = (v: FieldValue['value']): FieldValue =>
  ({ raw: v == null ? null : String(v), value: v, confidence: 1, source: 'vision', page: 0, bbox: [0, 0, 0.1, 0.1], color: '#0078D4' });

describe('isStale', () => {
  it('only ever speaks about a RUNNING item', () => {
    expect(isStale({ status: 'QUEUED', startedAt: ago(STALE_MS * 5) }, NOW)).toBe(false);
    expect(isStale({ status: 'DONE', startedAt: ago(STALE_MS * 5) }, NOW)).toBe(false);
    expect(isStale({ status: 'FAILED', startedAt: null }, NOW)).toBe(false);
  });

  it('leaves a RUNNING item alone while it is plausibly still working', () => {
    expect(isStale({ status: 'RUNNING', startedAt: ago(STALE_MS - 1000) }, NOW)).toBe(false);
  });

  it('claims one that has been RUNNING longer than the window', () => {
    expect(isStale({ status: 'RUNNING', startedAt: ago(STALE_MS + 1000) }, NOW)).toBe(true);
  });

  it('claims a RUNNING item with no start time at all — a half-written row nobody will finish', () => {
    expect(isStale({ status: 'RUNNING', startedAt: null }, NOW)).toBe(true);
  });
});

describe('progressOf', () => {
  it('counts failures as processed — the bar measures what is left to wait for', () => {
    expect(progressOf({ total: 10, done: 6, failed: 2 })).toEqual({ total: 10, done: 6, failed: 2, processed: 8, pct: 80 });
  });

  it('is 0 % for an empty job instead of dividing by zero', () => {
    expect(progressOf({ total: 0, done: 0, failed: 0 })).toMatchObject({ pct: 0 });
  });

  it('never goes past 100 %, whatever the counters say', () => {
    expect(progressOf({ total: 2, done: 5, failed: 5 })).toMatchObject({ processed: 2, pct: 100 });
  });
});

describe('finalJobStatus', () => {
  it('is DONE when anything at all was read', () => {
    expect(finalJobStatus({ total: 10, done: 1, failed: 9 })).toBe('DONE');
  });
  it('is FAILED only when nothing was', () => {
    expect(finalJobStatus({ total: 3, done: 0, failed: 3 })).toBe('FAILED');
  });
  it('an empty job is DONE, not FAILED', () => {
    expect(finalJobStatus({ total: 0, done: 0, failed: 0 })).toBe('DONE');
  });
});

describe('isActive / nextItemOrder', () => {
  it('knows which statuses the UI still has to poll', () => {
    expect(['QUEUED', 'RUNNING'].every(isActive)).toBe(true);
    expect(['DONE', 'FAILED', 'CANCELLED'].some(isActive)).toBe(false);
  });
  it('continues the ordering of the items a job already has', () => {
    expect(nextItemOrder([])).toBe(0);
    expect(nextItemOrder([0, 1, 2])).toBe(3);
  });
});

describe('jobToSheetInputs', () => {
  const TOTAL = field({ key: 'total', label: 'Σύνολο', valueType: 'CURRENCY', order: 0 });
  const NUM = field({ key: 'num', label: 'Αριθμός', order: 1 });

  const build = (over: Record<string, unknown> = {}) => jobToSheetInputs({
    templateSlug: 'kapaline',
    templateName: 'Καπαλινέ',
    fields: [TOTAL, NUM],
    invoiceRows: [{ fieldKey: 'total', invoiceKey: 'totalAmount' }],
    excelRows: null,
    items: [
      { fileName: 'a.pdf', status: 'DONE', values: { total: value(229.4), num: value('17') } },
      { fileName: 'b.pdf', status: 'FAILED', values: null },
    ],
    ...over,
  });

  it('projects each DONE item onto a canonical document of its own', () => {
    const out = build();
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('a.pdf');
    expect(out[0].document.totals.total).toBe(229.4);
    // Ό,τι δεν χαρτογραφείται δεν χάνεται — πάει στο `custom`, ακριβώς όπως σε μια εκτέλεση.
    expect(out[0].document.custom.num).toBe('17');
  });

  it('leaves out the files that failed — an empty row reads as «no amounts», not as «unread»', () => {
    expect(build().map((i) => i.file)).toEqual(['a.pdf']);
  });

  it('an item whose values were never written does not throw', () => {
    const out = build({ items: [{ fileName: 'c.pdf', status: 'DONE', values: null }] });
    expect(out).toHaveLength(1);
    expect(out[0].values).toEqual({});
  });

  it('carries the EXCEL mapping through, so the job exports the same columns a folder would', () => {
    const rows = [{ fieldKey: 'total', column: 'Ποσό', order: 0 }];
    expect(build({ excelRows: rows })[0].excelRows).toEqual(rows);
  });
});
