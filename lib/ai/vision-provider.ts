// lib/ai/vision-provider.ts — ΚΑΘΑΡΟ. Ποιος πάροχος vision και πώς ονομάζει τα μοντέλα του.
//
// Δύο πάροχοι για τα ίδια μοντέλα Gemini:
//  - **Google AI Studio** (OpenAI-compatible endpoint + native `generateContent` για PDF), όνομα
//    μοντέλου σκέτο: `gemini-2.5-flash`.
//  - **OpenRouter** (OpenAI-compatible, PDF ως `file` part), όνομα με πρόθεμα παρόχου:
//    `google/gemini-2.5-flash`.
// Ο κώδικας και οι ρυθμίσεις μιλούν με σκέτα ονόματα (`gemini-2.5-pro` για το «HQ»)· η μετάφραση
// γίνεται ΕΔΩ, στο σημείο της κλήσης, ώστε η αλλαγή παρόχου να είναι μόνο θέμα URL + κλειδιού.

export const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const isOpenRouter = (url: string | null | undefined): boolean => !!url && url.includes('openrouter.ai');
export const isGoogleAiStudio = (url: string | null | undefined): boolean => !!url && url.includes('generativelanguage.googleapis.com');

/** Δέχεται ο πάροχος PDF ολόκληρο (χωρίς rasterize ανά σελίδα); */
export const supportsPdfNative = (url: string | null | undefined): boolean => isGoogleAiStudio(url) || isOpenRouter(url);

/**
 * Το όνομα του μοντέλου όπως το θέλει ο πάροχος: στο OpenRouter τα Gemini παίρνουν `google/`,
 * στο Google AI Studio το πρόθεμα φεύγει. Οτιδήποτε άλλο (π.χ. `qwen/…`, `openai/gpt-4o`) μένει ως έχει.
 */
/** Ονόματα που στο OpenRouter διαφέρουν από το σκέτο `google/<όνομα>`. */
const OPENROUTER_ALIAS: Record<string, string> = {
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
  'gemini-2.0-flash-lite': 'google/gemini-2.0-flash-lite-001',
};

export function providerModel(model: string, url: string | null | undefined): string {
  const m = model.trim();
  if (isOpenRouter(url)) {
    if (m.includes('/')) return m;
    return OPENROUTER_ALIAS[m.toLowerCase()] ?? (/^gemini/i.test(m) ? `google/${m}` : m);
  }
  if (isGoogleAiStudio(url)) return m.replace(/^google\//i, '');
  return m;
}

/** Επιπλέον headers ανά πάροχο (το OpenRouter δείχνει την εφαρμογή στα στατιστικά του). */
export function providerHeaders(url: string | null | undefined): Record<string, string> {
  return isOpenRouter(url) ? { 'X-Title': 'DGEspa OCR' } : {};
}
