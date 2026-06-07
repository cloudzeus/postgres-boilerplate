import {
  resolveCfg, callVisionLLM, callGeminiPdfNative, rasterizePdf, enhanceForOcr, parseJsonLoose,
} from '@/lib/ocr/extract';
import { buildCustomFieldsPrompt } from '@/lib/ocr/field-rules';
import { templateFieldsToRules, type TemplateFieldLite } from '@/lib/tax/template-prompt';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';

export type TaxExtractResult = {
  values: Record<string, string | null>; // fieldKey → raw value
  model: string;
  tokensUsed: number | null;
  durationMs: number;
};

function safeParseJsonLoose(s: string): Record<string, unknown> | null {
  try {
    return parseJsonLoose(s) ?? null;
  } catch {
    return null;
  }
}

/** Extracts named tax-form fields from a PDF/image using region hints + AI vision. */
export async function extractTaxForm(
  buffer: Buffer,
  mimeType: string,
  fields: TemplateFieldLite[],
): Promise<TaxExtractResult> {
  const cfg = await resolveCfg();
  const system = buildCustomFieldsPrompt(templateFieldsToRules(fields));
  const started = Date.now();
  let content = '';
  let model = cfg.visionModel;
  let tokens: number | null = null;

  if (mimeType === 'application/pdf' && cfg.visionUrl.includes('generativelanguage.googleapis.com')) {
    const out = await callGeminiPdfNative(cfg, system, buffer);
    content = out.content; model = out.model; tokens = out.tokens;
  } else if (mimeType === 'application/pdf') {
    const pages = await rasterizePdf(buffer, 3, 2);
    const merged: Record<string, unknown> = {};
    for (const page of pages) {
      const enhanced = await enhanceForOcr(page);
      const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
      model = out.model; tokens = (tokens ?? 0) + (out.tokens ?? 0);
      const parsed = safeParseJsonLoose(out.content) ?? {};
      for (const [k, v] of Object.entries(parsed)) if (v != null && merged[k] == null) merged[k] = v;
    }
    content = JSON.stringify(merged);
  } else {
    const enhanced = await enhanceForOcr(buffer);
    const out = await callVisionLLM(cfg, system, enhanced.buffer.toString('base64'), enhanced.mimeType);
    content = out.content; model = out.model; tokens = out.tokens;
  }

  const parsed = safeParseJsonLoose(content) ?? {};
  const values: Record<string, string | null> = {};
  for (const f of fields) {
    const v = (parsed as Record<string, unknown>)[f.fieldKey];
    values[f.fieldKey] = v == null ? null : String(v);
  }
  const durationMs = Date.now() - started;
  void logAiUsage({
    scope: 'TAX_FORM', provider: providerFromUrl(cfg.visionUrl), model,
    operation: 'tax.form_extraction', totalTokens: tokens ?? 0, durationMs, refType: 'CompanyFinancialValue',
  });
  return { values, model, tokensUsed: tokens, durationMs };
}
