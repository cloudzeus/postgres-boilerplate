import { describe, it, expect, vi } from 'vitest';
import { buildModelChain, tryModels } from '../model-fallback';

describe('buildModelChain', () => {
  it('puts the primary first, then fallbacks, de-duplicated', () => {
    expect(buildModelChain('flash', ['pro', 'flash', 'lite'])).toEqual(['flash', 'pro', 'lite']);
  });
  it('trims blanks and drops empty entries', () => {
    expect(buildModelChain('flash', ['', '  ', 'pro '])).toEqual(['flash', 'pro']);
  });
});

describe('tryModels', () => {
  const okWith = (v: any) => ({ ok: true as const, value: v });
  const fail = (m: string) => ({ ok: false as const, error: new Error(m) });

  it('returns the first model that succeeds without calling the rest', async () => {
    const attempt = vi.fn(async (model: string) => okWith({ model }));
    const out = await tryModels(['a', 'b', 'c'], attempt);
    expect(out).toEqual({ model: 'a' });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next model when one fails', async () => {
    const attempt = vi.fn(async (model: string) => (model === 'a' ? fail('a down') : okWith({ model })));
    const out = await tryModels(['a', 'b'], attempt);
    expect(out).toEqual({ model: 'b' });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('throws the FIRST (primary) error when every model fails', async () => {
    const attempt = vi.fn(async (model: string) => fail(`${model} unavailable`));
    await expect(tryModels(['a', 'b'], attempt)).rejects.toThrow('a unavailable');
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
