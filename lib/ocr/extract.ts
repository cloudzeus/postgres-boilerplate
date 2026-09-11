import sharp from 'sharp';
import { getSetting } from '@/lib/settings';
import { buildSystemPrompt, type DocType, type SupportedLang } from '@/lib/ocr/templates';
import { logAiUsage, providerFromUrl, type AiScope } from '@/lib/ai/usage';
import { qualityScore } from '@/lib/ocr/validate';
import { coerceDocument, normalizeDocument, reconcileDocument, toLegacy, type DocumentJson } from '@/lib/ocr/canonical';
import {
  fixSwappedPartiesDocument, mergeDocuments, mergeHybridDocuments, missingRequired,
} from '@/lib/ocr/extract-merge';
import { resolveOwnAfm } from '@/lib/ocr/own-afm';
import { fetchWithRetry } from '@/lib/ocr/fetch-retry';
import { buildModelChain, tryModels } from '@/lib/ocr/model-fallback';

export type PdfSource = 'auto' | 'digital' | 'scanned';

const DIGITAL_MIN_CHARS = 50;
const TARGET_MIN_WIDTH = 1600;

// Auto-retry policy: if more than this many *required* fields are missing in a
// vision-path response, retry the call once with an upgraded model. Avoids the
// 8× cost of always running the pro model while still catching difficult scans.
const RETRY_MISSING_THRESHOLD = 2;
/** The stronger vision model a hard read is retried with (also used by the template reader). */
export const UPGRADED_VISION_MODEL = 'gemini-2.5-pro';

/**
 * Preprocess a raster image to maximize OCR signal:
 *   - upscale (Lanczos) to at least TARGET_MIN_WIDTH if smaller
 *   - convert to grayscale (vision models don't need color for receipts)
 *   - normalize (stretches dynamic range — boosts faded thermal-paper text)
 *   - sharpen (recovers detail lost to blur / compression)
 *   - re-encode as high-quality PNG (lossless, lets the VLM see edges cleanly)
 * Failures bubble up the original buffer untouched.
 */
export async function enhanceForOcr(input: Buffer | Uint8Array | ArrayBuffer): Promise<{ buffer: Buffer; mimeType: string }> {
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
  /** Το κανονικό έγγραφο (spec §17.1) — η ΜΙΑ αλήθεια κάθε εξαγωγής. */
  document: DocumentJson;
  /**
   * Η προβολή του εγγράφου στα παλιά flat κλειδιά (`toLegacy`). Δεν είναι δεύτερη αλήθεια: κάθε
   * consumer που δεν έχει ακόμη μεταφερθεί (λίστα, row-detail, ουρές, ταξινομητής) διαβάζει αυτήν.
   */
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

export interface DeepSeekCfg {
  textKey: string;
  textUrl: string;
  textModel: string;
  visionKey: string;
  visionUrl: string;
  visionModel: string;
  visionFallbackModels: string[];
}

export async function resolveCfg(): Promise<DeepSeekCfg> {
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

export function parseJsonLoose(s: string): any {
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
export async function rasterizePdf(buffer: Buffer, maxPages = 3, scale = 2): Promise<Buffer[]> {
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

/**
 * One JSON-mode call to the text model. `usage` lets a caller label the spend
 * (και να το δέσει σε έγγραφο) — ο ταξινομητής σειράς το χρησιμοποιεί.
 * ΠΡΟΣΟΧΗ: στέλνει `response_format: json_object`, άρα το prompt ΠΡΕΠΕΙ να ζητά JSON.
 */
export async function callTextLLM(
  cfg: DeepSeekCfg, system: string, userContent: string,
  usage?: { operation?: string; refType?: string; refId?: string },
) {
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
    operation: usage?.operation ?? 'ocr.digital_pdf',
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    refType: usage?.refType ?? null,
    refId: usage?.refId ?? null,
  });
  return {
    content: data?.choices?.[0]?.message?.content as string,
    tokens: u.total_tokens ?? null,
    model: cfg.textModel,
  };
}

/**
 * Text-only chat completion sent to the VISION endpoint (OpenAI-compatible).
 * Εφεδρεία για όταν ο πάροχος κειμένου λείπει ή απορρίπτει το κλειδί (401): το
 * vision endpoint είναι το ίδιο OpenAI-compatible API, οπότε δέχεται και σκέτο
 * κείμενο. ΔΕΝ στέλνει `response_format` (δεν το υποστηρίζουν όλα τα μοντέλα σε
 * text-only κλήση) — ο καλών πρέπει να ανέχεται απάντηση εκτός JSON.
 */
export async function callTextViaVision(
  cfg: DeepSeekCfg, system: string, userContent: string,
  usage?: { operation?: string; refType?: string; refId?: string },
): Promise<{ content: string; tokens: number | null; model: string }> {
  if (!cfg.visionKey) throw new Error('Vision API key is not configured (settings: ai.visionApiKey).');
  const res = await fetchWithRetry(cfg.visionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.visionKey}` },
    body: JSON.stringify({
      model: cfg.visionModel,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  }, { label: `text-via-vision:${cfg.visionModel}` });
  if (!res.ok) throw new Error(`Vision text ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({
    scope: 'OCR_TEXT',
    provider: providerFromUrl(cfg.visionUrl),
    model: cfg.visionModel,
    operation: usage?.operation ?? 'ocr.classify_series',
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    refType: usage?.refType ?? null,
    refId: usage?.refId ?? null,
  });
  return {
    content: data?.choices?.[0]?.message?.content as string,
    tokens: u.total_tokens ?? null,
    model: cfg.visionModel,
  };
}

/**
 * Send a PDF buffer DIRECTLY to Gemini's native API (no rasterization). Gemini
 * natively understands PDFs end-to-end — text + embedded images. We use this
 * when pdf-to-img/canvas chokes on a PDF, especially mixed PDFs with weird
 * embedded image streams.
 */
export async function callGeminiPdfNative(
  cfg: DeepSeekCfg, system: string, pdfBuffer: Buffer, modelOverride?: string,
  usageScope: AiScope = 'OCR_VISION',
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
        scope: modelOverride && usageScope === 'OCR_VISION' ? 'OCR_VISION_RETRY' : usageScope,
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

export async function callVisionLLM(
  cfg: DeepSeekCfg, system: string, imageBase64: string, mimeType: string,
  modelOverride?: string, usageScope: AiScope = 'OCR_VISION',
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
        scope: modelOverride && usageScope === 'OCR_VISION' ? 'OCR_VISION_RETRY' : usageScope,
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
 * Ό,τι γύρισε το μοντέλο → κανονικό έγγραφο, με ΤΗΝ ΙΔΙΑ σειρά σε κάθε διαδρομή του pipeline
 * (εικόνα, ψηφιακό PDF, native PDF της Gemini, ρασταροποιημένες σελίδες, εφεδρικά μοντέλα):
 *   coerce  — δέχεται και κανονικό σχήμα και παλιό flat, χωρίς ποτέ να πετάει,
 *   normalize — ΑΦΜ, ημερομηνίες, αριθμοί από κείμενο («1.234,56» → 1234.56),
 *   swap    — αν ο «εκδότης» έχει το δικό μας ΑΦΜ, οι δύο πλευρές είναι ανάποδα.
 *
 * ΧΩΡΙΣ συμφωνία συνόλων: αυτή γίνεται ΜΙΑ φορά, στο τέλος κάθε διαδρομής (`settle`). Αν γινόταν
 * εδώ, μια σελίδα-συνέχεια χωρίς τυπωμένα σύνολα θα έπαιρνε υπολογισμένα σύνολα από τις δικές της
 * γραμμές — και επειδή στη συγχώνευση κερδίζει η ΤΕΛΕΥΤΑΙΑ σελίδα που έχει σύνολα, το τυπωμένο
 * σύνολο της σελίδας 1 θα αντικαθιστούσε από ένα μερικό άθροισμα. Με τον ίδιο τρόπο, ένα ψηφιακό
 * πέρασμα με «γεμάτα» υπολογισμένα σύνολα δεν θα άφηνε ποτέ το υβριδικό πέρασμα να συμπληρώσει τα
 * σύνολα που διάβασε το vision, και το `missingRequired` θα μετρούσε λιγότερα κενά από όσα υπάρχουν
 * — δηλαδή η επανάληψη με το ισχυρό μοντέλο δεν θα ενεργοποιούνταν ποτέ.
 */
function toDocument(raw: unknown, docType: DocType, ownAfm: string | null): DocumentJson {
  return fixSwappedPartiesDocument(
    normalizeDocument(coerceDocument(raw, docType)),
    docType === 'invoice' ? ownAfm : null,
  );
}

/** Η ΜΙΑ συμφωνία συνόλων στο τέλος μιας διαδρομής (μετά από κάθε συγχώνευση και κάθε επανάληψη). */
const settle = (document: DocumentJson): DocumentJson => reconcileDocument(document).document;

/** Το αποτέλεσμα μιας διαδρομής, με τα σύνολα συμφωνημένα και την προβολή `data` ξαναχτισμένη. */
function settled(result: ExtractResult): ExtractResult {
  const document = settle(result.document);
  return { ...result, document, data: toLegacy(document) };
}

/**
 * Ποιο από δύο περάσματα κρατάμε (ΜΙΚΡΟΤΕΡΟ = καλύτερο). Το `qualityScore` ζυγίζει και τι λείπει
 * και τι είναι παρόν αλλά λάθος (άκυρο ΑΦΜ, σύνολα που δεν βγαίνουν) — κρίνει πάνω στην προβολή
 * `toLegacy`, όπου ζουν όλοι αυτοί οι έλεγχοι.
 */
const score = (document: DocumentJson, docType: DocType): number => qualityScore(toLegacy(document), docType);

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
    const ownAfm = await resolveOwnAfm();
    let document = toDocument(parseJsonLoose(out.content), input.docType, ownAfm);
    let model = out.model;
    let tokens = out.tokens;
    let passes = 1;
    let retried = false;

    // Auto-retry once with the upgraded model if too many required fields are missing.
    if (missingRequired(document, input.docType) >= RETRY_MISSING_THRESHOLD
        && cfg.visionModel !== UPGRADED_VISION_MODEL) {
      try {
        const retry = await callVisionLLM(cfg, system, b64, enhanced.mimeType, UPGRADED_VISION_MODEL);
        const retryDoc = toDocument(parseJsonLoose(retry.content), input.docType, ownAfm);
        passes = 2;
        // Keep whichever reads better — το `qualityScore` κρίνει πάνω στην προβολή των flat κλειδιών.
        if (score(retryDoc, input.docType) < score(document, input.docType)) {
          document = retryDoc;
          model = retry.model;
          tokens = (tokens ?? 0) + (retry.tokens ?? 0);
          retried = true;
        }
      } catch { /* ignore — keep first-pass result */ }
    }

    const final = settle(document);
    return {
      document: final,
      data: toLegacy(final),
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
        return settled(await runScannedPdf(cfg, system, input.buffer, input.docType, started));
      }

      // Selectable text exists. Try digital first (cheap, fast).
      const digital = await runDigitalPdf(cfg, system, input.buffer, input.docType, started, probed);

      // HYBRID: if digital is missing required fields, the PDF is likely mixed
      // (text + scanned image regions). Run vision on the rasterized pages and
      // merge — vision fills only what digital missed.
      const missing = missingRequired(digital.document, input.docType);
      if (missing >= RETRY_MISSING_THRESHOLD) {
        try {
          const visionResult = await runScannedPdf(cfg, system, input.buffer, input.docType, started);
          const merged = settle(mergeHybridDocuments(digital.document, visionResult.document));
          return {
            ...digital,
            document: merged,
            data: toLegacy(merged),
            model: `${digital.model} + ${visionResult.model}`,
            tokensUsed: (digital.tokensUsed ?? 0) + (visionResult.tokensUsed ?? 0),
            durationMs: Date.now() - started,
            passes: (digital.passes ?? 1) + (visionResult.passes ?? 1),
            retried: true,
          };
        } catch { /* keep digital result if vision crashes */ }
      }
      return settled(digital);
    }

    if (mode === 'digital') return settled(await runDigitalPdf(cfg, system, input.buffer, input.docType, started));
    if (mode === 'scanned') return settled(await runScannedPdf(cfg, system, input.buffer, input.docType, started));
  }

  throw new Error(`Unsupported mimeType for OCR: ${input.mimeType}`);
}

/**
 * ΕΣΩΤΕΡΙΚΗ διαδρομή: το έγγραφο γυρνάει ΑΣΥΜΦΩΝΗΤΟ (χωρίς `reconcileDocument`), γιατί ο καλών
 * μπορεί να θέλει να το συγχωνεύσει πρώτα (υβριδικό πέρασμα) και να μετρήσει τα πραγματικά κενά.
 * Όποιος το επιστρέφει στον χρήστη το περνάει από το `settled(...)`.
 */
async function runDigitalPdf(
  cfg: DeepSeekCfg, system: string, buffer: Buffer, docType: DocType, started: number, preExtracted?: string,
): Promise<ExtractResult> {
  const text = preExtracted ?? await extractDigitalPdfText(buffer);
  if (!text) throw new Error('No selectable text discovered in PDF. Use scanned/auto mode.');
  const out = await callTextLLM(cfg, system, `Here is the digital text payload extracted from the document:\n\n${text}`);
  const ownAfm = await resolveOwnAfm();
  const document = toDocument(parseJsonLoose(out.content), docType, ownAfm);
  return {
    document,
    data: toLegacy(document),
    rawText: text,
    model: out.model,
    tokensUsed: out.tokens,
    durationMs: Date.now() - started,
  };
}

/** ΕΣΩΤΕΡΙΚΗ διαδρομή: γυρνάει ΑΣΥΜΦΩΝΗΤΟ έγγραφο — βλ. `runDigitalPdf`. */
async function runScannedPdf(
  cfg: DeepSeekCfg, system: string, buffer: Buffer, docType: DocType, started: number,
): Promise<ExtractResult> {
  // Fast path: Gemini accepts PDFs natively (text + images) — skip rasterization.
  if (cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, buffer);
    const ownAfm = await resolveOwnAfm();
    let document = toDocument(parseJsonLoose(out.content), docType, ownAfm);
    let model = out.model;
    let tokens = out.tokens;
    let passes = 1;
    let retried = false;
    if (missingRequired(document, docType) >= RETRY_MISSING_THRESHOLD
        && cfg.visionModel !== UPGRADED_VISION_MODEL) {
      try {
        const r = await callGeminiPdfNative(cfg, system, buffer, UPGRADED_VISION_MODEL);
        const retryDoc = toDocument(parseJsonLoose(r.content), docType, ownAfm);
        passes = 2;
        if (score(retryDoc, docType) < score(document, docType)) {
          document = retryDoc; model = r.model;
          tokens = (tokens ?? 0) + (r.tokens ?? 0);
          retried = true;
        }
      } catch { /* keep first-pass */ }
    }
    return {
      document, data: toLegacy(document), rawText: null, model,
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
  const ownAfm = await resolveOwnAfm();
  let merged = mergeDocuments(perPage.map((p) => toDocument(parseJsonLoose(p.content), docType, ownAfm)));
  let model = perPage[0].model;
  let tokensUsed = perPage.reduce((sum, p) => sum + (p.tokens ?? 0), 0) || null;
  let passes = 1;
  let retried = false;

  // Auto-retry only the pages we actually need, with the upgraded model.
  if (missingRequired(merged, docType) >= RETRY_MISSING_THRESHOLD
      && cfg.visionModel !== UPGRADED_VISION_MODEL) {
    try {
      const retryPages = await Promise.all(
        enhanced.map((p) => callVisionLLM(cfg, system, p.buffer.toString('base64'), p.mimeType, UPGRADED_VISION_MODEL)),
      );
      const retryMerged = mergeDocuments(retryPages.map((p) => toDocument(parseJsonLoose(p.content), docType, ownAfm)));
      passes = 2;
      if (score(retryMerged, docType) < score(merged, docType)) {
        merged = retryMerged;
        model = retryPages[0].model;
        tokensUsed = (tokensUsed ?? 0) + (retryPages.reduce((s, p) => s + (p.tokens ?? 0), 0));
        retried = true;
      }
    } catch { /* ignore */ }
  }

  return {
    document: merged,
    data: toLegacy(merged),
    rawText: null,
    model,
    tokensUsed,
    durationMs: Date.now() - started,
    passes,
    retried,
  };
}

export async function extractDocument(input: ExtractInput): Promise<ExtractResult> {
  // Τα ΑΦΜ έχουν ήδη καθαριστεί από το `normalizeDocument` μέσα στο `toDocument` (EL999863881 →
  // 999863881), άρα και η προβολή `data` που διαβάζουν τα υπόλοιπα — SoftOne, ΑΑΔΕ και ο
  // εντοπισμός προτύπου ανά ΑΦΜ εκδότη βλέπουν τον ίδιο σκέτο αριθμό.
  return extractDocumentRaw(input);
}
