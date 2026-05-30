import { describe, it, expect, vi } from 'vitest';
import { isRetryableStatus, nextDelayMs, fetchWithRetry } from '../fetch-retry';

describe('isRetryableStatus', () => {
  it('treats overload/transient upstream statuses as retryable', () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
  });
  it('does not retry success or client errors', () => {
    for (const s of [200, 400, 401, 403, 404, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe('nextDelayMs', () => {
  it('grows exponentially with the attempt index', () => {
    // jitter is bounded, so compare floors across attempts
    const d0 = nextDelayMs(0, 500, () => 0);
    const d1 = nextDelayMs(1, 500, () => 0);
    const d2 = nextDelayMs(2, 500, () => 0);
    expect(d0).toBe(500);
    expect(d1).toBe(1000);
    expect(d2).toBe(2000);
  });
  it('adds bounded jitter', () => {
    const d = nextDelayMs(0, 500, () => 1); // full jitter
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThanOrEqual(500 + 250); // jitter capped at 50% of base step
  });
});

describe('fetchWithRetry', () => {
  const ok = () => new Response('ok', { status: 200 });
  const unavailable = () => new Response('busy', { status: 503 });

  it('returns immediately on a non-retryable response', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const res = await fetchWithRetry('u', {}, { attempts: 4, fetchImpl, sleep: async () => {} });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? unavailable() : ok()));
    const sleep = vi.fn(async () => {});
    const res = await fetchWithRetry('u', {}, { attempts: 4, fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after `attempts` and returns the last (still-failing) response', async () => {
    const fetchImpl = vi.fn(async () => unavailable());
    const res = await fetchWithRetry('u', {}, { attempts: 3, fetchImpl, sleep: async () => {} });
    expect(res.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries transient network errors and eventually throws if they persist', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    await expect(
      fetchWithRetry('u', {}, { attempts: 2, fetchImpl, sleep: async () => {} }),
    ).rejects.toThrow('ECONNRESET');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
