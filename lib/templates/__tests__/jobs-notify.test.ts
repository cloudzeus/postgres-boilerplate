// lib/templates/__tests__/jobs-notify.test.ts — το email ολοκλήρωσης μιας εργασίας σάρωσης (§12).
import { describe, it, expect } from 'vitest';
import { formatDuration, jobCompletionHtml, jobCompletionSubject, type JobMailInput } from '../jobs-notify';

const mail = (over: Partial<JobMailInput> = {}): JobMailInput => ({
  status: 'DONE',
  title: 'Τιμολόγια Μαΐου',
  templateName: 'Καπαλινέ',
  reference: 'ΠΑΡ-17',
  docDate: new Date('2026-05-31T00:00:00Z'),
  description: 'Ο φάκελος του λογιστή',
  total: 10, done: 9, failed: 1,
  durationMs: 133_000,
  link: 'https://app.example.gr/admin/ocr/templates/jobs/job_1',
  ...over,
});

describe('jobCompletionSubject', () => {
  it('names the job the user named', () => {
    expect(jobCompletionSubject({ status: 'DONE', title: 'Τιμολόγια Μαΐου' })).toBe('Ολοκληρώθηκε η εργασία «Τιμολόγια Μαΐου»');
    expect(jobCompletionSubject({ status: 'FAILED', title: 'X' })).toBe('Απέτυχε η εργασία «X»');
    expect(jobCompletionSubject({ status: 'CANCELLED', title: 'X' })).toBe('Ακυρώθηκε η εργασία «X»');
  });
});

describe('formatDuration', () => {
  it('reads like a human wrote it', () => {
    expect(formatDuration(12_000)).toBe('12 δ');
    expect(formatDuration(133_000)).toBe('2 λ 13 δ');
    expect(formatDuration(120_000)).toBe('2 λ');
    expect(formatDuration(3_720_000)).toBe('1 ω 2 λ');
  });
  it('says nothing when there is nothing to say', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });
});

describe('jobCompletionHtml', () => {
  it('carries the metadata the user typed, the counts and the link', () => {
    const html = jobCompletionHtml(mail());
    expect(html).toContain('Τιμολόγια Μαΐου');
    expect(html).toContain('Καπαλινέ');
    expect(html).toContain('ΠΑΡ-17');
    expect(html).toContain('31/05/2026');
    expect(html).toContain('Ο φάκελος του λογιστή');
    expect(html).toContain('9 από 10');
    expect(html).toContain('1 με σφάλμα');
    expect(html).toContain('2 λ 13 δ');
    expect(html).toContain('href="https://app.example.gr/admin/ocr/templates/jobs/job_1"');
  });

  it('omits the link entirely when APP_URL is not configured — never a broken href', () => {
    const html = jobCompletionHtml(mail({ link: '' }));
    expect(html).not.toContain('<a ');
    expect(html).toContain('Τιμολόγια Μαΐου');
  });

  it('leaves out the rows the job has nothing to say about', () => {
    const html = jobCompletionHtml(mail({ reference: null, docDate: null, description: null, durationMs: null, failed: 0 }));
    expect(html).not.toContain('Σήμανση');
    expect(html).not.toContain('Ημερομηνία');
    expect(html).not.toContain('Διάρκεια');
    expect(html).not.toContain('με σφάλμα');
  });

  it('says what actually happened for a failed or cancelled job', () => {
    expect(jobCompletionHtml(mail({ status: 'FAILED' }))).toContain('απέτυχε');
    expect(jobCompletionHtml(mail({ status: 'CANCELLED' }))).toContain('ακυρώθηκε');
  });

  it('escapes what the user typed — a title is not markup', () => {
    const html = jobCompletionHtml(mail({ title: '<script>alert(1)</script>', description: 'a & b' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
});
