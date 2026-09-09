// lib/templates/vision.ts — SERVER. One place for "read this crop with the vision model".
// Same OpenAI-compatible call shape as app/api/admin/ocr/[id]/read-region (now delegated here).
import 'server-only';
import sharp from 'sharp';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { fetchWithRetry } from '@/lib/ocr/fetch-retry';
import { buildModelChain, tryModels } from '@/lib/ocr/model-fallback';
import type { Bbox } from './schema';

const DEFAULT_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

async function visionConfig() {
  const key = (await getSetting<string>('ai.visionApiKey')) ?? process.env.GEMINI_API_KEY ?? '';
  const url = (await getSetting<string>('ai.visionUrl')) ?? DEFAULT_VISION_URL;
  const model = (await getSetting<string>('ai.visionModel')) ?? 'gemini-2.5-flash';
  const fallbackRaw = (await getSetting<string>('ai.visionFallbackModels')) ?? '';
  const fallbacks = fallbackRaw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  if (!key) throw new Error('Δεν έχει ρυθμιστεί κλειδί vision (ai.visionApiKey)');
  return { key, url, models: buildModelChain(model, fallbacks) };
}

/** Crop a normalized bbox from a page bitmap and enhance it for reading (upscale ×2 min 400px, grayscale, normalize). */
export async function prepareCrop(pageBuf: Buffer, bbox: Bbox): Promise<Buffer> {
  const meta = await sharp(pageBuf).metadata();
  const W = meta.width ?? 0; const H = meta.height ?? 0;
  if (W < 2 || H < 2) throw new Error('unreadable page');
  const [nx, ny, nw, nh] = bbox;
  const left = Math.min(W - 1, Math.max(0, Math.round(nx * W)));
  const top = Math.min(H - 1, Math.max(0, Math.round(ny * H)));
  const width = Math.min(W - left, Math.max(1, Math.round(nw * W)));
  const height = Math.min(H - top, Math.max(1, Math.round(nh * H)));
  return sharp(pageBuf).extract({ left, top, width, height })
    .resize({ width: Math.max(width * 2, 400), withoutEnlargement: false })
    .grayscale().normalize().png().toBuffer();
}

type CallResult = { content: string; model: string; tokensUsed: number | null };

async function callVision(crop: Buffer, system: string, operation: string): Promise<CallResult> {
  const cfg = await visionConfig();
  return tryModels(cfg.models, async (model) => {
    const res = await fetchWithRetry(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model, temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${crop.toString('base64')}` } }] },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: new Error(`vision ${res.status}: ${await res.text().catch(() => '')}`) };
    const data = await res.json();
    const u = data?.usage ?? {};
    const tokensUsed = typeof u.total_tokens === 'number' ? u.total_tokens : null;
    void logAiUsage({ scope: 'OCR_VISION', provider: providerFromUrl(cfg.url), model, operation, inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: tokensUsed ?? 0 });
    return { ok: true, value: { content: String(data?.choices?.[0]?.message?.content ?? ''), model, tokensUsed } };
  });
}

const NULLISH = new Set(['', 'null', 'none', '—', '-', 'n/a', 'κενό']);

/** Read one field's value from a crop. `prompt` describes the field (label + hint). */
export async function readCropValue(input: { crop: Buffer; prompt: string; operation: string }): Promise<{ value: string; model: string; tokensUsed: number | null }> {
  const system = `${input.prompt}\nThe image is a cropped area of a Greek invoice/receipt. Respond with ONLY the raw value text as printed, no labels, no quotes, no explanation. If the area is empty respond with an empty string.`;
  const r = await callVision(input.crop, system, input.operation);
  const v = r.content.trim();
  return { value: NULLISH.has(v.toLowerCase()) ? '' : v, model: r.model, tokensUsed: r.tokensUsed };
}

/** Read a table crop into rows keyed by the template's column keys. */
export async function readCropTable(input: { crop: Buffer; columns: { key: string; label: string }[]; operation: string; hint?: string | null }): Promise<{ rows: Record<string, string>[]; model: string; tokensUsed: number | null }> {
  const cols = input.columns.map((c) => `"${c.key}" (${c.label})`).join(', ');
  const system = `Extract every row of the table in this cropped image of a Greek document.${input.hint ? ` ${input.hint}` : ''}\nReturn ONLY JSON: {"rows":[{${input.columns.map((c) => `"${c.key}":"…"`).join(',')}}]} with columns ${cols}. Values are raw strings exactly as printed; use "" when a cell is empty. No markdown.`;
  const r = await callVision(input.crop, system, input.operation);
  const rows = parseRows(r.content, input.columns.map((c) => c.key));
  return { rows, model: r.model, tokensUsed: r.tokensUsed };
}

function parseRows(content: string, keys: string[]): Record<string, string>[] {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1)) as { rows?: unknown };
    if (!Array.isArray(obj.rows)) return [];
    return obj.rows.map((row) => {
      const out: Record<string, string> = {};
      for (const k of keys) out[k] = row && typeof row === 'object' && (row as Record<string, unknown>)[k] != null ? String((row as Record<string, unknown>)[k]) : '';
      return out;
    });
  } catch { return []; }
}
