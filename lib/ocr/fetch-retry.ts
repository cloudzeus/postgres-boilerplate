// Resilient fetch for upstream LLM/vision APIs. Gemini/DeepSeek occasionally
// return transient overload statuses (esp. 503 UNAVAILABLE "high demand") or
// drop the connection. Without backoff the whole OCR job fails on a blip. This
// wrapper retries those — and only those — with exponential backoff + jitter.

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Transient upstream statuses worth retrying. Client errors (4xx) are not. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Exponential backoff for `attempt` (0-based): base * 2^attempt, plus up to 50%
 * of the base step as jitter to avoid thundering-herd retries. `rand` is
 * injectable for deterministic tests.
 */
export function nextDelayMs(attempt: number, baseMs: number, rand: () => number = Math.random): number {
  const step = baseMs * 2 ** attempt;
  const jitter = Math.floor(rand() * (baseMs / 2));
  return step + jitter;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RetryOpts {
  attempts?: number;
  baseMs?: number;
  /** Short context string for diagnostic logs (e.g. the model name). */
  label?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

/**
 * fetch() that retries transient failures. Returns the final Response (the
 * caller still inspects `res.ok`). Re-throws network errors only after the
 * last attempt. Drains the body of retried responses so sockets are freed.
 */
export async function fetchWithRetry(
  url: string, init: RequestInit, opts: RetryOpts = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 600;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms));
  const rand = opts.rand ?? Math.random;

  const tag = opts.label ? `[ocr-fetch-retry ${opts.label}]` : '[ocr-fetch-retry]';
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch (err) {
      if (isLast) { console.error(`${tag} network error on final attempt ${attempt + 1}/${attempts}:`, (err as any)?.message ?? err); throw err; }
      const delay = nextDelayMs(attempt, baseMs, rand);
      console.warn(`${tag} network error on attempt ${attempt + 1}/${attempts}, retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }
    if (!isRetryableStatus(res.status) || isLast) {
      if (isRetryableStatus(res.status)) console.error(`${tag} exhausted after ${attempts} attempts; last upstream status ${res.status}`);
      return res;
    }
    lastRes = res;
    const delay = nextDelayMs(attempt, baseMs, rand);
    console.warn(`${tag} upstream ${res.status} on attempt ${attempt + 1}/${attempts}, retrying in ${delay}ms`);
    await res.text().catch(() => {});   // free the socket before retrying
    await sleep(delay);
  }
  // Exhausted on retryable statuses: hand back the last response so the caller
  // can surface the real upstream status/body.
  return lastRes ?? new Response('retry exhausted', { status: 503 });
}
