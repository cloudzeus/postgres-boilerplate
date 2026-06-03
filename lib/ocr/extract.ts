import sharp from 'sharp';
import { getSetting } from '@/lib/settings';
import { buildSystemPrompt, countMissingRequired, REQUIRED_FIELDS, type DocType, type SupportedLang } from '@/lib/ocr/templates';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { qualityScore, fixSwappedParties, normalizeAfmFields } from '@/lib/ocr/validate';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';
import { findSupplierTemplate, mergeFromTemplatePass } from '@/lib/ocr/templates-store';
import {
  findActiveFieldRules, buildCustomFieldsPrompt, mergeCustomFields,
  buildLineFieldsPrompt, mergeLineCustomFields, type FieldRuleLite,
} from '@/lib/ocr/field-rules';
import { fetchWithRetry } from '@/lib/ocr/fetch-retry';
import { buildModelChain, tryModels } from '@/lib/ocr/model-fallback';

export type PdfSource = 'auto' | 'digital' | 'scanned';

const DIGITAL_MIN_CHARS = 50;
const TARGET_MIN_WIDTH = 1600;

// Auto-retry policy: if more than this many *required* fields are missing in a
// vision-path response, retry the call once with an upgraded model. Avoids the
// 8× cost of always running the pro model while still catching difficult scans.
const RETRY_MISSING_THRESHOLD = 2;
const UPGRADED_VISION_MODEL = 'gemini-2.5-pro';

/**
 * Preprocess a raster image to maximize OCR signal:
 *   - upscale (Lanczos) to at least TARGET_MIN_WIDTH if smaller
 *   - convert to grayscale (vision models don't need color for receipts)
 *   - normalize (stretches dynamic range — boosts faded thermal-paper text)
 *   - sharpen (recovers detail lost to blur / compression)
 *   - re-encode as high-quality PNG (lossless, lets the VLM see edges cleanly)
 * Failures bubble up the original buffer untouched.
 */
async function enhanceForOcr(input: Buffer | Uint8Array | ArrayBuffer): Promise<{ buffer: Buffer; mimeType: string }> {
  // sharp's napi binding errors with "Value is none of these types `String`,
  // `Path`,..." if it receives anything other than a real Node Buffer. Coerce
  // aggressively and validate before touching sharp.
  let buffer: Buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (input instanceof Uint8Array) {
    buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else if (input instanceof ArrayBuffer) {
    buffer = Buffer.from(input);
  } else {
    throw new Error(`enhanceForOcr: unsupported input type ${typeof input} (${(input as any)?.constructor?.name})`);
  }
  if (buffer.length === 0) {
    throw new Error('enhanceForOcr: received an empty buffer (rasterizer likely produced no bytes).');
  }
  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width ?? 0;
    const scale = w > 0 && w < TARGET_MIN_WIDTH ? TARGET_MIN_WIDTH / w : 1;
    const targetWidth = scale > 1 ? Math.round(w * scale) : undefined;

    let pipe = sharp(buffer, { failOn: 'none' });
    if (targetWidth) pipe = pipe.resize({ width: targetWidth, kernel: 'lanczos3' });
    pipe = pipe.rotate()              // honour EXIF orientation
               .grayscale()
               .normalize()           // contrast stretch
               .sharpen({ sigma: 1.0, m1: 0.7, m2: 1.5 });
    const out = await pipe.png({ compressionLevel: 8 }).toBuffer();
    return { buffer: out, mimeType: 'image/png' };
  } catch {
    return { buffer, mimeType: 'image/png' };
  }
}

export interface ExtractInput {
  buffer: Buffer;
  mimeType: string;
  docType: DocType;
  language: SupportedLang;
  pdfSource?: PdfSource;
}

export interface ExtractResult {
  data: any;
  rawText: string | null;
  model: string;
  tokensUsed: number | null;
  durationMs: number;
  /** Number of vision passes actually run (1 normally, 2 if auto-retry fired). */
  passes?: number;
  /** True iff the upgraded model was used (auto-retry or manual override). */
  retried?: boolean;
}

interface DeepSeekCfg {
  textKey: string;
  textUrl: string;
  textModel: string;
  visionKey: string;
  visionUrl: string;
  visionModel: string;
  visionFallbackModels: string[];
}

async function resolveCfg(): Promise<DeepSeekCfg> {
  const textKey = (await getSetting<string>('ai.deepseekApiKey')) ?? process.env.DEEPSEEK_API_KEY ?? '';
  const textUrl = (await getSetting<string>('ai.deepseekUrl'))    ?? process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/v1/chat/completions';
  const textModel = (await getSetting<string>('ai.deepseekTextModel')) ?? 'deepseek-chat';
  // Vision: prefer Gemini (cheapest, OpenAI-compatible). Falls back to DeepInfra/OpenAI tokens if set.
  const visionKey = (await getSetting<string>('ai.visionApiKey'))
    ?? process.env.GEMINI_API_KEY
    ?? process.env.DEEPINFRA_TOKEN
    ?? process.env.OPENAI_API_KEY
    ?? '';
  const visionUrl = (await getSetting<string>('ai.visionUrl'))
    ?? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const visionModel = (await getSetting<string>('ai.visionModel'))
    ?? 'gemini-2.5-flash';
  // On sustained per-model overload (Gemini 503 UNAVAILABLE), fall back to a
  // different model with a separate capacity pool. Configurable via setting
  // `ai.visionFallbackModels` (comma-separated); empty string disables fallback.
  const fallbackRaw = await getSetting<string>('ai.visionFallbackModels');
  const visionFallbackModels = (fallbackRaw ?? 'gemini-2.0-flash,gemini-2.5-flash-lite')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return { textKey, textUrl, textModel, visionKey, visionUrl, visionModel, visionFallbackModels };
}

function parseJsonLoose(s: string): any {
  if (!s) throw new Error('Empty LLM response');
  // Strip code fences if model returned them anyway.
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Fallback: extract first {...} block.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('LLM did not return valid JSON');
}

async function extractDigitalPdfText(buffer: Buffer): Promise<string> {
  // Use pdfjs-dist directly — `pdf-parse` has a well-known issue where it tries
  // to read a test fixture at module load when bundled by Next.js/Turbopack,
  // and the auto-resolved worker path also breaks. pdfjs gives us full control.
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Avoid noisy console messages in dev for malformed but readable PDFs.
      verbosity: 0,
    });
    const doc = await loadingTask.promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((it: any) => ('str' in it ? it.str : ''))
        .join(' ');
      pages.push(text);
    }
    await doc.destroy();
    return pages.join('\n').replace(/[ \t]+/g, ' ').trim();
  } catch (err: any) {
    throw new Error(`PDF text extraction failed: ${err?.message ?? err}`);
  }
}

/**
 * Rasterize the first N pages of a PDF to PNG using `pdf-to-img`
 * (pdfjs-dist + sharp, no native canvas dep).
 * Returns base64 PNGs.
 */
async function rasterizePdf(buffer: Buffer, maxPages = 3, scale = 2): Promise<Buffer[]> {
  // Force-set the pdfjs worker path BEFORE pdf-to-img loads.
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = workerPath;
  } catch { /* pdf-to-img will try its own fallback */ }

  const { pdf } = await import('pdf-to-img');
  let document;
  try {
    document = await pdf(buffer, { scale });
  } catch (err: any) {
    throw new Error(`rasterizePdf (pdf-to-img init): ${err?.message ?? err}`);
  }
  const pages: Buffer[] = [];
  try {
    for await (const page of document) {
      // pdf-to-img v6 yields a Uint8Array; coerce to a real Node Buffer.
      const buf = Buffer.isBuffer(page)
        ? page
        : Buffer.from((page as Uint8Array).buffer, (page as Uint8Array).byteOffset, (page as Uint8Array).byteLength);
      pages.push(buf);
      if (pages.length >= maxPages) break;
    }
  } catch (err: any) {
    throw new Error(`rasterizePdf (page iteration): ${err?.message ?? err}`);
  }
  return pages;
}

async function callTextLLM(cfg: DeepSeekCfg, system: string, userContent: string) {
  const res = await fetchWithRetry(cfg.textUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.textKey}` },
    body: JSON.stringify({
      model: cfg.textModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek text ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({
    scope: 'OCR_TEXT',
    provider: providerFromUrl(cfg.textUrl),
    model: cfg.textModel,
    operation: 'ocr.digital_pdf',
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  });
  return {
    content: data?.choices?.[0]?.message?.content as string,
    tokens: u.total_tokens ?? null,
    model: cfg.textModel,
  };
}

/**
 * Send a PDF buffer DIRECTLY to Gemini's native API (no rasterization). Gemini
 * natively understands PDFs end-to-end — text + embedded images. We use this
 * when pdf-to-img/canvas chokes on a PDF, especially mixed PDFs with weird
 * embedded image streams.
 */
async function callGeminiPdfNative(
  cfg: DeepSeekCfg, system: string, pdfBuffer: Buffer, modelOverride?: string,
): Promise<{ content: string; tokens: number | null; model: string }> {
  if (!cfg.visionKey) throw new Error('Vision API key not configured.');
  if (!cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    throw new Error('Native PDF path requires Gemini provider.');
  }
  const primary = modelOverride ?? cfg.visionModel;
  const pdfB64 = pdfBuffer.toString('base64');
  return tryModels(buildModelChain(primary, cfg.visionFallbackModels), async (model) => {
    try {
      // Native v1beta endpoint (not OpenAI-compat) so we can pass inline_data with application/pdf.
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${cfg.visionKey}`;
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: pdfB64 } },
              { text: 'Execute JSON data extraction from this PDF.' },
            ],
          }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      }, { label: `pdf:${model}` });
      if (!res.ok) return { ok: false, error: new Error(`Gemini PDF ${res.status}: ${(await res.text()).slice(0, 300)}`) };
      const data = await res.json();
      const content = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '';
      const u = data?.usageMetadata ?? {};
      void logAiUsage({
        scope: modelOverride ? 'OCR_VISION_RETRY' : 'OCR_VISION',
        provider: 'gemini', model, operation: 'ocr.pdf_native',
        inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0,
        totalTokens: u.totalTokenCount ?? 0,
      });
      return { ok: true, value: { content, tokens: u.totalTokenCount ?? null, model } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}

async function callVisionLLM(
  cfg: DeepSeekCfg, system: string, imageBase64: string, mimeType: string,
  modelOverride?: string,
) {
  if (!cfg.visionKey) throw new Error('Vision API key is not configured (settings: ai.visionApiKey).');
  const primary = modelOverride ?? cfg.visionModel;
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  return tryModels(buildModelChain(primary, cfg.visionFallbackModels), async (model) => {
    try {
      const res = await fetchWithRetry(cfg.visionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.visionKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: 'Execute JSON data extraction from this visual canvas.' },
              ],
            },
          ],
        }),
      }, { label: `vision:${model}` });
      if (!res.ok) return { ok: false, error: new Error(`Vision OCR ${res.status}: ${(await res.text()).slice(0, 300)}`) };
      const data = await res.json();
      const u = data?.usage ?? {};
      void logAiUsage({
        scope: modelOverride ? 'OCR_VISION_RETRY' : 'OCR_VISION',
        provider: providerFromUrl(cfg.visionUrl), model, operation: 'ocr.vision',
        inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      });
      return { ok: true, value: { content: data?.choices?.[0]?.message?.content as string, tokens: u.total_tokens ?? null, model } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}

/**
 * Merge per-page LLM outputs into a single document.
 * - invoice: keep header fields from the first page that has them; concatenate `items`;
 *            sum `totalAmount` if pages disagree and the last page looks like a footer.
 * - receipt: prefer the first non-empty page.
 * - general_text: concatenate fullText, merge keywords (dedup), join summaries.
 */
/**
 * Merge two payloads (digital + vision) for hybrid PDFs (mixed selectable
 * text + scanned image regions). For each missing field on the primary
 * payload, fill from the secondary. Items arrays are union'd by code+name.
 */
function mergeHybrid(primary: any, secondary: any, docType: DocType): any {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const out = { ...primary };
  for (const k of REQUIRED_FIELDS[docType]) {
    const v = out[k];
    const missing = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (missing && secondary[k] != null && secondary[k] !== '') {
      out[k] = secondary[k];
    }
  }
  // For invoices, union the items list (de-duplicated by `code|name`).
  if (docType === 'invoice' && (Array.isArray(primary.items) || Array.isArray(secondary.items))) {
    const seen = new Set<string>();
    const union: any[] = [];
    for (const src of [primary.items, secondary.items]) {
      if (!Array.isArray(src)) continue;
      for (const it of src) {
        const key = `${it?.code ?? ''}|${(it?.name ?? '').slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        union.push(it);
      }
    }
    out.items = union;
  }
  return out;
}

function mergePages(pages: any[], docType: DocType): any {
  if (pages.length === 1) return pages[0];

  if (docType === 'invoice') {
    const merged: any = { items: [] };
    const headerKeys = [
      'companyName', 'vatNumber', 'companyAddress', 'companyDoy', 'companyProfession',
      'customerName', 'customerVatNumber', 'customerAddress', 'customerDoy', 'customerProfession',
      'invoiceNumber', 'aadeMark', 'date',
    ];
    for (const p of pages) {
      for (const k of headerKeys) {
        if (merged[k] == null && p?.[k] != null) merged[k] = p[k];
      }
      if (Array.isArray(p?.items)) merged.items.push(...p.items);
    }
    // Money totals: prefer the largest value across pages (footer usually carries final).
    for (const k of ['subtotal', 'vatAmount', 'totalAmount']) {
      const vals = pages
        .map((p) => (p?.[k] != null ? Number(p[k]) : null))
        .filter((n): n is number => n != null && !Number.isNaN(n));
      if (vals.length) merged[k] = Math.max(...vals);
    }
    return merged;
  }

  if (docType === 'receipt') {
    return pages.find((p) => p && (p.storeName || p.totalAmount)) ?? pages[0];
  }

  // general_text
  const fullText = pages.map((p) => p?.fullText ?? '').filter(Boolean).join('\n\n');
  const summaries = pages.map((p) => p?.summary).filter(Boolean);
  const keywords = Array.from(new Set(pages.flatMap((p) => (Array.isArray(p?.keywords) ? p.keywords : []))));
  return {
    title: pages.find((p) => p?.title)?.title ?? null,
    fullText,
    summary: summaries.join(' '),
    keywords,
  };
}

async function extractDocumentRaw(input: ExtractInput): Promise<ExtractResult> {
  const cfg = await resolveCfg();
  if (!cfg.textKey) throw new Error('DeepSeek API key is not configured (settings: ai.deepseekApiKey).');

  const system = buildSystemPrompt(input.docType, input.language);
  const started = Date.now();

  const isPdf = input.mimeType === 'application/pdf';
  const isImage = input.mimeType.startsWith('image/');

  // Image → vision VLM.
  if (isImage) {
    const enhanced = await enhanceForOcr(input.buffer);
    const b64 = enhanced.buffer.toString('base64');
    const out = await callVisionLLM(cfg, system, b64, enhanced.mimeType);
    let data = parseJsonLoose(out.content);
    const ownAfm = await resolveOwnAfm();
    data = fixSwappedParties(data, input.docType === 'invoice' ? ownAfm : null);
    let model = out.model;
    let tokens = out.tokens;
    let passes = 1;
    let retried = false;

    // Auto-retry once with the upgraded model if too many required fields are missing.
    if (countMissingRequired(data, input.docType) >= RETRY_MISSING_THRESHOLD
        && cfg.visionModel !== UPGRADED_VISION_MODEL) {
      try {
        const retry = await callVisionLLM(cfg, system, b64, enhanced.mimeType, UPGRADED_VISION_MODEL);
        const retryData = parseJsonLoose(retry.content);
        passes = 2;
        // Keep whichever has fewer missing required fields.
        if (qualityScore(retryData, input.docType) < qualityScore(data, input.docType)) {
          data = retryData;
          model = retry.model;
          tokens = (tokens ?? 0) + (retry.tokens ?? 0);
          retried = true;
        }
      } catch { /* ignore — keep first-pass result */ }
    }

    return {
      data,
      rawText: null,
      model,
      tokensUsed: tokens,
      durationMs: Date.now() - started,
      passes,
      retried,
    };
  }

  if (isPdf) {
    const mode: PdfSource = input.pdfSource ?? 'auto';

    // AUTO — probe for embedded text first, fall back to rasterize if not enough.
    if (mode === 'auto') {
      let probed = '';
      try { probed = await extractDigitalPdfText(input.buffer); } catch { /* treat as scanned */ }

      // Not enough selectable text → fully scanned path.
      if (probed.length < DIGITAL_MIN_CHARS) {
        return await runScannedPdf(cfg, system, input.buffer, input.docType, started);
      }

      // Selectable text exists. Try digital first (cheap, fast).
      const digital = await runDigitalPdf(cfg, system, input.buffer, input.docType, started, probed);

      // HYBRID: if digital is missing required fields, the PDF is likely mixed
      // (text + scanned image regions). Run vision on the rasterized pages and
      // merge — vision fills only what digital missed.
      const missing = countMissingRequired(digital.data, input.docType);
      if (missing >= RETRY_MISSING_THRESHOLD) {
        try {
          const visionResult = await runScannedPdf(cfg, system, input.buffer, input.docType, started);
          const merged = mergeHybrid(digital.data, visionResult.data, input.docType);
          return {
            ...digital,
            data: merged,
            model: `${digital.model} + ${visionResult.model}`,
            tokensUsed: (digital.tokensUsed ?? 0) + (visionResult.tokensUsed ?? 0),
            durationMs: Date.now() - started,
            passes: (digital.passes ?? 1) + (visionResult.passes ?? 1),
            retried: true,
          };
        } catch { /* keep digital result if vision crashes */ }
      }
      return digital;
    }

    if (mode === 'digital') return await runDigitalPdf(cfg, system, input.buffer, input.docType, started);
    if (mode === 'scanned') return await runScannedPdf(cfg, system, input.buffer, input.docType, started);
  }

  throw new Error(`Unsupported mimeType for OCR: ${input.mimeType}`);
}

async function runDigitalPdf(
  cfg: DeepSeekCfg, system: string, buffer: Buffer, docType: DocType, started: number, preExtracted?: string,
): Promise<ExtractResult> {
  const text = preExtracted ?? await extractDigitalPdfText(buffer);
  if (!text) throw new Error('No selectable text discovered in PDF. Use scanned/auto mode.');
  const out = await callTextLLM(cfg, system, `Here is the digital text payload extracted from the document:\n\n${text}`);
  let data = parseJsonLoose(out.content);
  const ownAfm = await resolveOwnAfm();
  data = fixSwappedParties(data, docType === 'invoice' ? ownAfm : null);
  return {
    data,
    rawText: text,
    model: out.model,
    tokensUsed: out.tokens,
    durationMs: Date.now() - started,
  };
}

async function runScannedPdf(
  cfg: DeepSeekCfg, system: string, buffer: Buffer, docType: DocType, started: number,
): Promise<ExtractResult> {
  // Fast path: Gemini accepts PDFs natively (text + images) — skip rasterization.
  if (cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, buffer);
    let data = parseJsonLoose(out.content);
    const ownAfm = await resolveOwnAfm();
    data = fixSwappedParties(data, docType === 'invoice' ? ownAfm : null);
    let model = out.model;
    let tokens = out.tokens;
    let passes = 1;
    let retried = false;
    if (countMissingRequired(data, docType) >= RETRY_MISSING_THRESHOLD
        && cfg.visionModel !== UPGRADED_VISION_MODEL) {
      try {
        const r = await callGeminiPdfNative(cfg, system, buffer, UPGRADED_VISION_MODEL);
        const retryData = parseJsonLoose(r.content);
        passes = 2;
        if (qualityScore(retryData, docType) < qualityScore(data, docType)) {
          data = retryData; model = r.model;
          tokens = (tokens ?? 0) + (r.tokens ?? 0);
          retried = true;
        }
      } catch { /* keep first-pass */ }
    }
    return {
      data, rawText: null, model,
      tokensUsed: tokens, durationMs: Date.now() - started,
      passes, retried,
    };
  }

  // Fallback path (non-Gemini providers): rasterize and send per page.
  const MAX_PAGES = 20;
  const pages = await rasterizePdf(buffer, MAX_PAGES);
  if (pages.length === 0) throw new Error('Could not rasterize PDF.');

  // Enhance each rasterized page (already Buffers, no base64 round-trip needed).
  const enhanced = await Promise.all(pages.map((pageBuf) => enhanceForOcr(pageBuf)));
  const perPage = await Promise.all(
    enhanced.map((p) => callVisionLLM(cfg, system, p.buffer.toString('base64'), p.mimeType)),
  );
  let parsed = perPage.map((p) => parseJsonLoose(p.content));
  let merged = mergePages(parsed, docType);
  const ownAfm = await resolveOwnAfm();
  merged = fixSwappedParties(merged, docType === 'invoice' ? ownAfm : null) as any;
  let model = perPage[0].model;
  let tokensUsed = perPage.reduce((sum, p) => sum + (p.tokens ?? 0), 0) || null;
  let passes = 1;
  let retried = false;

  // Auto-retry only the pages we actually need, with the upgraded model.
  if (countMissingRequired(merged, docType) >= RETRY_MISSING_THRESHOLD
      && cfg.visionModel !== UPGRADED_VISION_MODEL) {
    try {
      const retryPages = await Promise.all(
        enhanced.map((p) => callVisionLLM(cfg, system, p.buffer.toString('base64'), p.mimeType, UPGRADED_VISION_MODEL)),
      );
      const retryParsed = retryPages.map((p) => parseJsonLoose(p.content));
      const retryMerged = mergePages(retryParsed, docType);
      passes = 2;
      if (qualityScore(retryMerged, docType) < qualityScore(merged, docType)) {
        merged = retryMerged;
        parsed = retryParsed;
        model = retryPages[0].model;
        tokensUsed = (tokensUsed ?? 0) + (retryPages.reduce((s, p) => s + (p.tokens ?? 0), 0));
        retried = true;
      }
    } catch { /* ignore */ }
  }

  return {
    data: merged,
    rawText: null,
    model,
    tokensUsed,
    durationMs: Date.now() - started,
    passes,
    retried,
  };
}

/**
 * After a normal pass, if required fields are still missing AND we have a verified
 * template for this issuer ΑΦΜ, run ONE more pass with a few-shot prompt and merge
 * in only the fields pass 1 missed. Extra model call only for known suppliers with
 * incomplete first passes.
 */
async function applySupplierTemplate(input: ExtractInput, base: ExtractResult): Promise<ExtractResult> {
  if (countMissingRequired(base.data, input.docType) === 0) return base;
  const issuerAfm = String(base.data?.vatNumber ?? '').replace(/\D+/g, '');
  if (!/^\d{9}$/.test(issuerAfm)) return base;
  const tpl = await findSupplierTemplate(issuerAfm, input.docType);
  if (!tpl) return base;

  const cfg = await resolveCfg();
  const system = buildSystemPrompt(input.docType, input.language, tpl.example, tpl.fieldHints);
  let pass2: any = null;
  try {
    if (input.mimeType === 'application/pdf'
        && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
      const out = await callGeminiPdfNative(cfg, system, input.buffer, UPGRADED_VISION_MODEL);
      pass2 = parseJsonLoose(out.content);
    } else if (input.mimeType.startsWith('image/')) {
      const enhanced = await enhanceForOcr(input.buffer);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'),
        enhanced.mimeType, UPGRADED_VISION_MODEL);
      pass2 = parseJsonLoose(out.content);
    } else if (base.rawText) {
      const out = await callTextLLM(cfg, system,
        `Here is the digital text payload extracted from the document:\n\n${base.rawText}`);
      pass2 = parseJsonLoose(out.content);
    }
  } catch { return base; }
  if (!pass2) return base;

  const merged = mergeFromTemplatePass(base.data, pass2, input.docType);
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.supplierTemplate.update({ where: { id: tpl.id }, data: { timesUsed: { increment: 1 } } });
  } catch { /* best effort */ }
  return { ...base, data: merged, model: `${base.model} + template`, retried: true };
}

type LoadedFieldRule = { id: string; key: string; label: string; description: string | null; regionHint: unknown; scope: string; valueType: string };

function ruleToLite(r: LoadedFieldRule): FieldRuleLite {
  return {
    key: r.key, label: r.label, description: r.description, regionHint: r.regionHint,
    scope: (r.scope as 'document' | 'line') ?? 'document',
    valueType: (r.valueType as 'text' | 'list') ?? 'text',
  };
}

/** Run one targeted field pass with the given system prompt; returns parsed JSON or null. */
async function runFieldPass(
  cfg: DeepSeekCfg, input: ExtractInput, base: ExtractResult, system: string,
): Promise<any | null> {
  if (input.mimeType === 'application/pdf' && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, input.buffer);
    return parseJsonLoose(out.content);
  }
  if (input.mimeType.startsWith('image/')) {
    const enhanced = await enhanceForOcr(input.buffer);
    const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
    return parseJsonLoose(out.content);
  }
  if (base.rawText) {
    const out = await callTextLLM(cfg, system,
      `Here is the digital text payload extracted from the document:\n\n${base.rawText}`);
    return parseJsonLoose(out.content);
  }
  return null;
}

async function bumpRulesUsed(rules: { id: string }[]): Promise<void> {
  const { prisma } = await import('@/lib/db');
  await prisma.supplierFieldRule.updateMany({
    where: { id: { in: rules.map((r) => r.id) } },
    data: { timesUsed: { increment: 1 } },
  }).catch(() => null);
}

/**
 * After the ΑΦΜ is resolved, extract this supplier's active custom fields.
 * Runs up to two best-effort passes (never throws): a document pass for
 * scope="document" rules → data.customFields, and a line pass for scope="line"
 * rules → data.items[i].customFields (only when the doc has line items).
 * Uses the default vision model.
 */
async function applyCustomFieldRules(input: ExtractInput, base: ExtractResult): Promise<ExtractResult> {
  try {
    if (!base.data) return base;
    const all = await findActiveFieldRules(String(base.data.vatNumber ?? ''), input.docType) as unknown as LoadedFieldRule[];
    if (all.length === 0) return base;

    const docRules = all.filter((r) => (r.scope ?? 'document') === 'document');
    const lineRules = all.filter((r) => r.scope === 'line');

    const cfg = await resolveCfg();
    let out = base;

    if (docRules.length > 0) {
      const parsed = await runFieldPass(cfg, input, out, buildCustomFieldsPrompt(docRules.map(ruleToLite)));
      if (parsed) {
        out = { ...out, data: mergeCustomFields(out.data, parsed, docRules.map(ruleToLite)) };
        await bumpRulesUsed(docRules);
      }
    }

    if (lineRules.length > 0 && Array.isArray(out.data.items) && out.data.items.length > 0) {
      const lines = out.data.items.map((it: any, i: number) => ({
        index: i, code: it?.code ?? null, name: String(it?.name ?? ''),
      }));
      const parsed = await runFieldPass(cfg, input, out, buildLineFieldsPrompt(lineRules.map(ruleToLite), lines));
      const parsedLines = Array.isArray(parsed?.lines) ? parsed.lines : null;
      if (parsedLines) {
        out = { ...out, data: mergeLineCustomFields(out.data, parsedLines, lineRules.map(ruleToLite)) };
        await bumpRulesUsed(lineRules);
      }
    }

    return out;
  } catch {
    return base;
  }
}

export async function extractDocument(input: ExtractInput): Promise<ExtractResult> {
  const base = await extractDocumentRaw(input);
  const withTemplate = await applySupplierTemplate(input, base);
  // Strip country prefixes (EL999863881 → 999863881) so the stored ΑΦΜ is what
  // AADE / SoftOne searches expect — everything downstream reads this value.
  if (withTemplate.data) normalizeAfmFields(withTemplate.data);
  // Supplier-specific custom fields (best-effort, after ΑΦΜ is resolved+normalized).
  return applyCustomFieldRules(input, withTemplate);
}
