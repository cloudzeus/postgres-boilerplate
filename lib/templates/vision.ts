// lib/templates/vision.ts — SERVER. One place for "read this crop with the vision model".
// Same OpenAI-compatible call shape as app/api/admin/ocr/[id]/read-region (now delegated here).
import 'server-only';
import sharp from 'sharp';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { fetchWithRetry } from '@/lib/ocr/fetch-retry';
import { buildModelChain, tryModels } from '@/lib/ocr/model-fallback';
import { extractJson, toBbox } from './detect-parse';
import { padBbox, type Bbox, type TemplateValueType } from './schema';

// The pure mapping «box inside this crop» → «box on the page» lives with the rest of the bbox maths;
// re-exported here because the adaptive read is the only thing that needs it and this is where that
// read is defined.
export { cropBoxToPage } from './geometry';

const DEFAULT_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

type VisionConfig = { key: string; url: string; models: string[] };

// Four settings lookups per call adds up fast when a template has 20 fields. The
// settings rarely change, so cache the resolved config briefly; a 60s TTL keeps an
// admin edit in the settings UI taking effect within a minute.
const VISION_CONFIG_TTL_MS = 60_000;
let cached: { at: number; cfg: VisionConfig } | null = null;

/** Drop the memoized vision config (tests, and anywhere settings change must apply now). */
export function resetVisionConfigCache(): void {
  cached = null;
}

async function visionConfig(): Promise<VisionConfig> {
  if (cached && Date.now() - cached.at < VISION_CONFIG_TTL_MS) return cached.cfg;
  const key = (await getSetting<string>('ai.visionApiKey')) ?? process.env.GEMINI_API_KEY ?? '';
  const url = (await getSetting<string>('ai.visionUrl')) ?? DEFAULT_VISION_URL;
  const model = (await getSetting<string>('ai.visionModel')) ?? 'gemini-2.5-flash';
  const fallbackRaw = (await getSetting<string>('ai.visionFallbackModels')) ?? '';
  const fallbacks = fallbackRaw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  if (!key) throw new Error('Δεν έχει ρυθμιστεί κλειδί vision (ai.visionApiKey)');
  const cfg: VisionConfig = { key, url, models: buildModelChain(model, fallbacks) };
  cached = { at: Date.now(), cfg };
  return cfg;
}

/**
 * How much air to leave around a marked region, as a fraction of the page on EACH side. Regions are
 * drawn once, on one sample; the next document from the same issuer prints a hair to the side and a
 * pixel-tight box then clips a digit off an amount. ~1.2% of an A4 width is ≈2.5mm — enough to save
 * the clipped glyph, small enough not to drag the neighbouring column into the crop.
 */
export const DEFAULT_CROP_PAD = 0.012;

/**
 * Crop a normalized bbox from a page bitmap and enhance it for reading (upscale ×2, min 400px /
 * max 2000×2600, grayscale, normalize). The bbox is padded by `opts.pad` (default `DEFAULT_CROP_PAD`)
 * before it is extracted; pass `{ pad: 0 }` for an exact crop.
 */
export async function prepareCrop(pageBuf: Buffer, bbox: Bbox, opts?: { pad?: number }): Promise<Buffer> {
  const meta = await sharp(pageBuf).metadata();
  const W = meta.width ?? 0; const H = meta.height ?? 0;
  if (W < 2 || H < 2) throw new Error('unreadable page');
  const [nx, ny, nw, nh] = padBbox(bbox, opts?.pad ?? DEFAULT_CROP_PAD);
  const left = Math.min(W - 1, Math.max(0, Math.round(nx * W)));
  const top = Math.min(H - 1, Math.max(0, Math.round(ny * H)));
  const width = Math.min(W - left, Math.max(1, Math.round(nw * W)));
  const height = Math.min(H - top, Math.max(1, Math.round(nh * H)));
  return sharp(pageBuf).extract({ left, top, width, height })
    // Upscale for legibility, but cap the pixels we ship to the model: a full-page
    // bbox on a scale-3 A4 render is ~7000px wide, which is a needlessly huge
    // base64 payload (and more input tokens) for no extra reading accuracy.
    .resize({ width: Math.min(Math.max(width * 2, 400), 2000), height: 2600, fit: 'inside', withoutEnlargement: false })
    .grayscale().normalize().png().toBuffer();
}

type CallResult = { content: string; model: string; tokensUsed: number | null };

/** Optional attribution for the AiUsage row, so spend can be traced back to a document/template. */
export type UsageRef = { refType: string; refId: string };

/**
 * `mime` is the media type of `crop` — whole-page payloads ship as JPEG, crops as PNG.
 * `modelOverride` is tried FIRST and the configured chain follows it, so a retry can ask a stronger
 * model for one hard crop without losing the fallbacks that keep the call alive under load.
 */
export async function callVision(crop: Buffer, system: string, operation: string, ref?: UsageRef, mime = 'image/png', modelOverride?: string): Promise<CallResult> {
  const cfg = await visionConfig();
  const models = modelOverride ? buildModelChain(modelOverride, cfg.models) : cfg.models;
  return tryModels(models, async (model) => {
    // NOTE: every failure path in here must RETURN `{ ok: false }` rather than
    // throw — a throw escapes tryModels and skips the remaining fallback models.
    // fetchWithRetry re-throws the transport error after its last attempt
    // (ECONNRESET / ETIMEDOUT / DNS). Left unwrapped it escaped tryModels and
    // aborted the whole chain — exactly the case the fallback exists for.
    let res: Response;
    try {
      res = await fetchWithRetry(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({
          model, temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${crop.toString('base64')}` } }] },
          ],
        }),
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
    if (!res.ok) {
      // Upstream bodies can carry request echoes / key fragments and are often huge.
      // Keep the surfaced error short (it reaches API responses); log the rest.
      const body = await res.text().catch(() => '');
      console.error('[vision]', model, res.status, body.slice(0, 2000));
      return { ok: false, error: new Error(`vision ${res.status}: ${body.slice(0, 200)}`) };
    }

    // A 200 with a non-JSON body (HTML error page from a proxy, truncated stream)
    // used to throw out of the attempt and abort the whole fallback chain.
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: new Error(`vision ${model}: bad JSON body`) };
    }

    // A provider-level error, or a response with no choices at all, is a FAILURE —
    // not an empty reading. Falling through would have produced content '' and made
    // a quota error indistinguishable from a genuinely blank region.
    const d = data as { error?: { message?: string }; choices?: unknown; usage?: Record<string, number> };
    if (d?.error || !Array.isArray(d?.choices) || d.choices.length === 0) {
      return { ok: false, error: new Error(`vision ${model}: no choices${d?.error?.message ? ` (${d.error.message})` : ''}`) };
    }

    const u = d.usage ?? {};
    const tokensUsed = typeof u.total_tokens === 'number' ? u.total_tokens : null;
    void logAiUsage({ scope: 'OCR_VISION', provider: providerFromUrl(cfg.url), model, operation, inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: tokensUsed ?? 0, refType: ref?.refType ?? null, refId: ref?.refId ?? null });
    // A well-formed choice whose content is '' stays a legitimate empty value.
    const choice = d.choices[0] as { message?: { content?: unknown } } | undefined;
    return { ok: true, value: { content: String(choice?.message?.content ?? ''), model, tokensUsed } };
  });
}

const NULLISH = new Set(['', 'null', 'none', '—', '-', 'n/a', 'κενό']);

/** Read one field's value from a crop. `prompt` describes the field (label + hint). */
export async function readCropValue(input: { crop: Buffer; prompt: string; operation: string; ref?: UsageRef; model?: string }): Promise<{ value: string; model: string; tokensUsed: number | null }> {
  const system = `${input.prompt}\nThe image is a cropped area of a scanned business document (Greek or English). Respond with ONLY the raw value text as printed, no labels, no quotes, no explanation. If the area is empty respond with an empty string.`;
  const r = await callVision(input.crop, system, input.operation, input.ref, 'image/png', input.model);
  const v = r.content.trim();
  return { value: NULLISH.has(v.toLowerCase()) ? '' : v, model: r.model, tokensUsed: r.tokensUsed };
}

/**
 * Read one field from a WIDER crop that is not tight around the value (spec §17.2): the model is
 * asked to FIND the label first and then report the value next to it, together with where it found
 * it (`box_2d`, 0–1000 relative to the crop). The position is what makes the read worth its cost —
 * it is folded into `TemplateField.lastGood` so the next document is searched in the right place.
 *
 * Asked in Greek because the documents and their labels are Greek, and the label is quoted verbatim
 * from the template: an English paraphrase of «Καθαρή αξία» is a different question.
 */
export async function readCropValueLocated(input: {
  crop: Buffer;
  label: string;
  aiHint?: string | null;
  valueType: TemplateValueType;
  operation: string;
  ref?: UsageRef;
  model?: string;
}): Promise<{ value: string; box: Bbox | null; model: string; tokensUsed: number | null }> {
  const hint = input.aiHint ? ` (ή το πεδίο: ${input.aiHint})` : '';
  const system = [
    `Η εικόνα είναι ένα κομμάτι σαρωμένου εμπορικού εγγράφου. Βρες την ετικέτα «${input.label}»${hint} μέσα στην εικόνα`,
    'και δώσε ΜΟΝΟ την τιμή που βρίσκεται δίπλα ή κάτω από αυτήν.',
    `Τύπος τιμής: ${input.valueType.toLowerCase()}. Γράψε την τιμή ΑΚΡΙΒΩΣ όπως είναι τυπωμένη, χωρίς ετικέτες και χωρίς σύμβολα νομίσματος.`,
    'Απάντησε ΜΟΝΟ με JSON: {"value": "...", "box_2d": [ymin, xmin, ymax, xmax]}',
    'όπου το box_2d είναι το πλαίσιο της ΤΙΜΗΣ σε κλίμακα 0-1000 ως προς αυτή την εικόνα.',
    'Αν η ετικέτα ή η τιμή δεν υπάρχει στην εικόνα, απάντησε {"value": null}. Χωρίς markdown, χωρίς εξηγήσεις.',
  ].join('\n');

  const r = await callVision(input.crop, system, input.operation, input.ref, 'image/png', input.model);
  const parsed = extractJson(r.content);
  // Deliberately NOT falling back to the raw content: this prompt asks for JSON, so anything else is
  // the model explaining itself — and storing an apology as an invoice number is worse than a blank.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: '', box: null, model: r.model, tokensUsed: r.tokensUsed };
  }
  const obj = parsed as Record<string, unknown>;
  const v = obj.value == null ? '' : String(obj.value).trim();
  const value = NULLISH.has(v.toLowerCase()) ? '' : v;
  return { value, box: value ? toBbox(obj) : null, model: r.model, tokensUsed: r.tokensUsed };
}

/** Read a table crop into rows keyed by the template's column keys. */
export async function readCropTable(input: { crop: Buffer; columns: { key: string; label: string }[]; operation: string; hint?: string | null; ref?: UsageRef }): Promise<{ rows: Record<string, string>[]; model: string; tokensUsed: number | null }> {
  const cols = input.columns.map((c) => `"${c.key}" (${c.label})`).join(', ');
  const system = `Extract every row of the table in this cropped image of a scanned business document.${input.hint ? ` ${input.hint}` : ''}\nReturn ONLY JSON: {"rows":[{${input.columns.map((c) => `"${c.key}":"…"`).join(',')}}]} with columns ${cols}. Values are raw strings exactly as printed; use "" when a cell is empty. No markdown.`;
  const r = await callVision(input.crop, system, input.operation, input.ref);
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
