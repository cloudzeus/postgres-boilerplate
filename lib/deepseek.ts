import { getSetting } from '@/lib/settings';

const DEFAULT_URL = 'https://api.deepseek.com/v1/chat/completions';

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface DeepSeekOptions {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/** Low-level chat completion call. */
export async function deepseekChat(messages: ChatMessage[], opts: DeepSeekOptions = {}): Promise<string> {
  const apiKey = opts.apiKey
    ?? (await getSetting<string>('ai.deepseekApiKey'))
    ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('Missing DeepSeek API key (settings: ai.deepseekApiKey or env DEEPSEEK_API_KEY)');

  const apiUrl = opts.apiUrl
    ?? (await getSetting<string>('ai.deepseekUrl'))
    ?? process.env.DEEPSEEK_API_URL
    ?? DEFAULT_URL;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model ?? 'deepseek-chat',
      temperature: opts.temperature ?? 0.2,
      messages,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Translate text between languages. Targets are ISO codes ("el", "en", "de", "fr", "it", "es"...).
 * Preserves punctuation, placeholders ({{name}}, {0}), HTML tags.
 */
export async function translateText(
  text: string,
  to: string,
  from: string = 'auto',
  opts: DeepSeekOptions = {},
): Promise<string> {
  if (!text.trim()) return text;
  const system = [
    'You are a precise translator for a Greek-first business application.',
    `Translate from ${from} to ${to}.`,
    'Rules:',
    '- Preserve placeholders like {{name}}, {0}, <strong>, <a href="...">.',
    '- Preserve numbers, dates, emails, URLs as-is.',
    '- Keep the same tone (professional, concise).',
    '- Return ONLY the translation, no quotes, no commentary.',
  ].join('\n');
  return deepseekChat(
    [{ role: 'system', content: system }, { role: 'user', content: text }],
    opts,
  );
}

/** Batch translate — keeps order and returns same-length array. */
export async function translateBatch(
  items: string[],
  to: string,
  from: string = 'auto',
  opts: DeepSeekOptions = {},
): Promise<string[]> {
  const numbered = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const system = [
    `You are a translator. Translate each numbered line from ${from} to ${to}.`,
    'Return EXACTLY one line per item, prefixed with the same number and dot.',
    'Preserve placeholders and HTML.',
  ].join('\n');
  const out = await deepseekChat(
    [{ role: 'system', content: system }, { role: 'user', content: numbered }],
    opts,
  );
  const lines = out.split('\n').map((l) => l.replace(/^\d+\.\s*/, '').trim());
  if (lines.length !== items.length) {
    // Fallback: translate one-by-one
    return Promise.all(items.map((s) => translateText(s, to, from, opts)));
  }
  return lines;
}
