import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { PROGRAM_SYSTEM_PROMPT } from '@/lib/programs/templates';
import { harvestKadsFromText, mergeKads } from '@/lib/programs/kad-harvester';
import { extractKadsPositional } from '@/lib/programs/kad-positional';
import { expandRegionGroups } from '@/lib/programs/regions';

export interface ProgramExtractResult {
  data: any;
  model: string;
  tokensUsed: number | null;
  durationMs: number;
  retried: boolean;
}

const REQUIRED_FIELDS = ['title', 'summary', 'submissionEnd', 'totalBudget'];
const RETRY_MISSING_THRESHOLD = 2;

// Text extraction via pdfjs + DeepSeek for structured analysis.
// DeepSeek has 128k context — large enough for full ΕΣΠΑ προσκλήσεις.
const PRIMARY_MODEL  = 'deepseek-chat';
const FALLBACK_MODEL = 'deepseek-reasoner';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
// DeepSeek context = 128k tokens. Greek averages ~3 chars/token, so ~380k chars
// is the safe ceiling. We cap at 360k to leave room for the system prompt + JSON output.
const MAX_TEXT_CHARS = 360_000;

async function parseJsonLoose(s: string): Promise<any> {
  if (!s) throw new Error('Empty LLM response');
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // 1) Try strict JSON.parse first (fast path)
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // 2) Extract first {...} block if there's prose around the JSON
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  // 3) Try jsonrepair — fixes missing commas, trailing commas, truncated arrays
  try {
    const { jsonrepair } = await import('jsonrepair');
    const repaired = jsonrepair(candidate);
    console.log('[program extract] jsonrepair fixed malformed JSON');
    return JSON.parse(repaired);
  } catch (err) {
    console.error('[program extract] jsonrepair also failed:', err);
  }
  throw new Error('LLM did not return valid JSON (after repair attempt)');
}

function countMissing(data: any): number {
  if (!data || typeof data !== 'object') return REQUIRED_FIELDS.length;
  return REQUIRED_FIELDS.reduce((n, k) => {
    const v = data[k];
    return n + (v == null || v === '' ? 1 : 0);
  }, 0);
}

/** Extract full text from a PDF via unpdf (serverless-friendly pdfjs wrapper). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  // text here is string[] (one per page). Join with markers so the LLM can navigate.
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  const labeled = pages.map((t, i) => `--- ΣΕΛΙΔΑ ${i + 1} ---\n${t}`);
  const full = labeled.join('\n\n').replace(/[ \t]+/g, ' ').trim();
  return full.length > MAX_TEXT_CHARS
    ? full.slice(0, MAX_TEXT_CHARS) + '\n\n[... truncated ...]'
    : full;
}

interface DeepSeekCfg { key: string; url: string }

async function callDeepSeek(cfg: DeepSeekCfg, model: string, text: string) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 8192,                  // DeepSeek max — needed for long ΕΣΠΑ programs
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROGRAM_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              'Ανάλυσε ΕΞΑΝΤΛΗΤΙΚΑ το παρακάτω κείμενο προσκλήσεως (έχει εξαχθεί με PDF parser, οπότε διατηρεί όλο το περιεχόμενο).',
              '',
              'Ακολούθησε τον 5-pass αλγόριθμο. Το JSON σου θα διαβαστεί από επιχειρηματίες για να αποφασίσουν αν θα κάνουν αίτηση.',
              '',
              'Πριν επιστρέψεις, βεβαιώσου:',
              '· Summary 120-180 λέξεις, marketing-grade ελληνικά (όχι νομικά).',
              '· Criteria μόνο 5-7 ΚΕΝΤΡΙΚΑ.',
              '· ΚΑΔ σε dotted form και ΟΛΑ τα παραρτήματα διαβασμένα.',
              '· Min/max σε δαπάνες όπου υπάρχουν ζεύγη.',
              '',
              '=== ΠΛΗΡΕΣ ΚΕΙΜΕΝΟ ΠΡΟΣΚΛΗΣΕΩΣ ===',
              text,
            ].join('\n'),
          },
        ],
      }),
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new Error(`DeepSeek timeout (>${REQUEST_TIMEOUT_MS / 1000}s)`);
    throw new Error(`DeepSeek network error: ${err?.cause?.code ?? err?.message ?? err}`);
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  return {
    content: data?.choices?.[0]?.message?.content as string,
    tokens: u.total_tokens ?? null,
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    model,
  };
}

export interface ProgramFileInput {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  kind?: string;  // MAIN / ANNEX / CLARIFICATION / AMENDMENT / OTHER
}

export async function extractProgram(
  input: ProgramFileInput | { files: ProgramFileInput[] },
): Promise<ProgramExtractResult> {
  const files: ProgramFileInput[] = 'files' in input ? input.files : [input];
  if (files.length === 0) throw new Error('No files provided for extraction.');

  const apiKey = (await getSetting<string>('ai.deepseekApiKey')) ?? process.env.DEEPSEEK_API_KEY ?? '';
  const apiUrl = (await getSetting<string>('ai.deepseekUrl'))    ?? 'https://api.deepseek.com/v1/chat/completions';
  if (!apiKey) throw new Error('DeepSeek API key not configured (ai.deepseekApiKey or DEEPSEEK_API_KEY).');
  const cfg = { key: apiKey, url: apiUrl };

  const started = Date.now();

  // 1) Extract text from every PDF and concatenate with file boundary markers
  //    so the model knows which content came from which document.
  const perFileText: string[] = [];
  for (const f of files) {
    try {
      const t = await extractPdfText(f.buffer);
      if (t && t.length >= 100) {
        const label = f.fileName ?? 'document.pdf';
        const kind = f.kind ?? 'MAIN';
        perFileText.push(`\n\n=============== ${kind}: ${label} ===============\n\n${t}`);
      }
    } catch (err: any) {
      console.error(`PDF text extraction failed for ${f.fileName ?? 'unknown'}`, err);
      // Continue with other files.
    }
  }
  const text = perFileText.join('\n\n').slice(0, MAX_TEXT_CHARS);
  if (!text || text.length < 200) {
    throw new Error('Δεν εντοπίστηκε αναγνώσιμο κείμενο σε κανένα από τα αρχεία (πιθανότατα σαρωμένα). Χρειάζεται OCR.');
  }

  // 2) Send to DeepSeek for structured extraction.
  const first = await callDeepSeek(cfg, PRIMARY_MODEL, text);
  void logAiUsage({
    scope: 'OCR_TEXT',
    provider: providerFromUrl(apiUrl),
    model: first.model,
    operation: 'program.extract',
    inputTokens: first.inputTokens,
    outputTokens: first.outputTokens,
    totalTokens: first.tokens ?? 0,
  });

  let data: any;
  try {
    data = await parseJsonLoose(first.content);
  } catch (err: any) {
    console.error('[program extract] parseJsonLoose failed:', err?.message);
    console.error('[program extract] LLM raw response (first 1000 chars):', String(first.content).slice(0, 1000));
    throw new Error(`LLM returned invalid JSON: ${err?.message ?? err}`);
  }
  let model = first.model;
  let tokensUsed = first.tokens;
  let retried = false;
  console.log(`[program extract] first pass OK, model=${model}, missing=${countMissing(data)}, text_chars=${text.length}`);

  // 3) Auto-retry with deepseek-reasoner if too many core fields missing.
  if (countMissing(data) >= RETRY_MISSING_THRESHOLD) {
    console.log(`[program extract] retry with ${FALLBACK_MODEL}`);
    try {
      const r = await callDeepSeek(cfg, FALLBACK_MODEL, text);
      void logAiUsage({
        scope: 'OCR_VISION_RETRY',
        provider: providerFromUrl(apiUrl),
        model: r.model,
        operation: 'program.extract.retry',
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.tokens ?? 0,
      });
      const retryData = await parseJsonLoose(r.content);
      if (countMissing(retryData) < countMissing(data)) {
        data = retryData; model = r.model;
        tokensUsed = (tokensUsed ?? 0) + (r.tokens ?? 0);
        retried = true;
      }
    } catch { /* keep first-pass */ }
  }

  // 4a) Region expansion — split grouped entries like "Λιγότερο Ανεπτυγμένες
  //     (Κρήτη, Ήπειρος, …)" into individual region rows.
  try {
    if (Array.isArray(data?.regions)) {
      data.regions = expandRegionGroups(data.regions);
    }
  } catch (err) {
    console.error('Region expansion failed', err);
  }

  // 4b) ΚΑΔ safety net — three layers:
  //   (i)   text-based harvester (sequential pattern match)
  //   (ii)  positional harvester per file (row-based table reconstruction
  //         using x/y coordinates — catches wide ΚΑΔ tables that the text
  //         harvester misses because of column-major extraction).
  //   (iii) merge with LLM output, preferring LLM descriptions where present.
  try {
    const textHarvested = harvestKadsFromText(text);
    const positional: Awaited<ReturnType<typeof extractKadsPositional>> = [];
    for (const f of files) {
      try {
        const items = await extractKadsPositional(f.buffer);
        positional.push(...items);
      } catch (err) {
        console.error('positional harvester failed for', f.fileName, err);
      }
    }
    // Combine both harvested sources (positional has richer descriptions).
    const harvestedMap = new Map<string, { code: string; codeWithoutDots: string; description: string | null }>();
    for (const h of textHarvested) harvestedMap.set(h.code, h);
    for (const h of positional) {
      const existing = harvestedMap.get(h.code);
      if (!existing || (!existing.description && h.description)) {
        harvestedMap.set(h.code, h);
      }
    }
    const harvested = Array.from(harvestedMap.values());

    const llmPotential = Array.isArray(data?.potentialKads) ? data.potentialKads.map((k: any) => ({ ...k, excluded: false })) : [];
    const llmExcluded  = Array.isArray(data?.excludedKads)  ? data.excludedKads.map((k: any) => ({ ...k, excluded: true }))   : [];
    const merged = mergeKads([...llmPotential, ...llmExcluded], harvested);
    data.potentialKads = merged.filter((k) => !k.excluded).map((k) => ({ code: k.code, description: k.description }));
    data.excludedKads  = merged.filter((k) =>  k.excluded).map((k) => ({ code: k.code, description: k.description }));
    console.log(`[ΚΑΔ extract] llm=${llmPotential.length + llmExcluded.length} text=${textHarvested.length} positional=${positional.length} merged=${merged.length} (text_chars=${text.length})`);
  } catch (err) {
    console.error('ΚΑΔ harvester failed', err);
  }

  return { data, model, tokensUsed, durationMs: Date.now() - started, retried };
}
