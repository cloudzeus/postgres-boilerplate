import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GEMINI_OPENAI_URL, OPENROUTER_URL, providerModel, providerHeaders, supportsPdfNative } from '../vision-provider';
import { getPricing } from '../pricing';

const settings: Record<string, string | undefined> = {};
vi.mock('@/lib/settings', () => ({ getSetting: async (k: string) => settings[k] }));

describe('providerModel', () => {
  it('OpenRouter: πρόθεμα google/ και ειδικά ονόματα', () => {
    expect(providerModel('gemini-2.5-flash', OPENROUTER_URL)).toBe('google/gemini-2.5-flash');
    expect(providerModel('gemini-2.5-pro', OPENROUTER_URL)).toBe('google/gemini-2.5-pro');
    expect(providerModel('gemini-2.0-flash', OPENROUTER_URL)).toBe('google/gemini-2.0-flash-001');
    expect(providerModel('google/gemini-2.5-flash', OPENROUTER_URL)).toBe('google/gemini-2.5-flash');
    expect(providerModel('openai/gpt-4o', OPENROUTER_URL)).toBe('openai/gpt-4o');
  });
  it('Google AI Studio: το πρόθεμα φεύγει', () => {
    expect(providerModel('google/gemini-2.5-pro', GEMINI_OPENAI_URL)).toBe('gemini-2.5-pro');
    expect(providerModel('gemini-2.5-flash', GEMINI_OPENAI_URL)).toBe('gemini-2.5-flash');
  });
  it('PDF ολόκληρο και headers', () => {
    expect(supportsPdfNative(OPENROUTER_URL)).toBe(true);
    expect(supportsPdfNative(GEMINI_OPENAI_URL)).toBe(true);
    expect(supportsPdfNative('https://api.deepinfra.com/v1/openai/chat/completions')).toBe(false);
    expect(providerHeaders(OPENROUTER_URL)).toHaveProperty('X-Title');
    expect(providerHeaders(GEMINI_OPENAI_URL)).toEqual({});
  });
});

describe('getPricing με ονόματα OpenRouter', () => {
  it('google/… παίρνει την τιμή του σκέτου μοντέλου', () => {
    expect(getPricing('google/gemini-2.5-flash-lite')).toEqual(getPricing('gemini-2.5-flash-lite'));
    expect(getPricing('google/gemini-2.0-flash-001')).toEqual(getPricing('gemini-2.0-flash'));
    expect(getPricing('google/gemini-2.5-pro')).toEqual(getPricing('gemini-2.5-pro'));
  });
});

describe('resolveVisionEndpoint', () => {
  beforeEach(() => {
    for (const k of Object.keys(settings)) delete settings[k];
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = 'g-key';
  });

  it('με κλειδί OpenRouter: OpenRouter, το δικό του κλειδί, μοντέλα google/…', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    const { resolveVisionEndpoint } = await import('../vision-config');
    expect(await resolveVisionEndpoint()).toEqual({
      url: OPENROUTER_URL, key: 'or-key', model: 'google/gemini-2.5-flash',
      fallbacks: ['google/gemini-2.0-flash-001', 'google/gemini-2.5-flash-lite'],
    });
  });

  it('χωρίς κλειδί OpenRouter: Google AI Studio όπως πριν', async () => {
    const { resolveVisionEndpoint } = await import('../vision-config');
    expect(await resolveVisionEndpoint()).toMatchObject({ url: GEMINI_OPENAI_URL, key: 'g-key', model: 'gemini-2.5-flash' });
  });

  it('ρητό URL υπερισχύει· ποτέ κλειδί Google προς OpenRouter', async () => {
    settings['ai.visionUrl'] = OPENROUTER_URL;
    const { resolveVisionEndpoint } = await import('../vision-config');
    expect((await resolveVisionEndpoint()).key).toBe('');
  });
});
