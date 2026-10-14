// lib/ai/vision-config.ts — SERVER. Endpoint, κλειδί και μοντέλα του vision παρόχου — ΜΙΑ πηγή.
//
// Σειρά απόφασης:
//  1. ρητό `ai.visionUrl` στις Ρυθμίσεις → αυτό·
//  2. αλλιώς, αν υπάρχει κλειδί OpenRouter (`ai.openrouterApiKey` ή `OPENROUTER_API_KEY`) → OpenRouter·
//  3. αλλιώς Google AI Studio (παλιά συμπεριφορά, `GEMINI_API_KEY`).
// Το κλειδί ακολουθεί τον πάροχο: ποτέ κλειδί Google προς το OpenRouter ή το αντίστροφο.
import 'server-only';
import { getSetting } from '@/lib/settings';
import { GEMINI_OPENAI_URL, OPENROUTER_URL, isOpenRouter, providerModel } from './vision-provider';

export interface VisionEndpoint {
  url: string;
  key: string;
  /** Κύριο μοντέλο, ήδη στο όνομα του παρόχου. */
  model: string;
  /** Εφεδρικά μοντέλα, ήδη στο όνομα του παρόχου. */
  fallbacks: string[];
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_FALLBACKS = 'gemini-2.0-flash,gemini-2.5-flash-lite';

export async function resolveVisionEndpoint(): Promise<VisionEndpoint> {
  const [urlSetting, openrouterSetting, visionKeySetting, modelSetting, fallbackSetting] = await Promise.all([
    getSetting<string>('ai.visionUrl'),
    getSetting<string>('ai.openrouterApiKey'),
    getSetting<string>('ai.visionApiKey'),
    getSetting<string>('ai.visionModel'),
    getSetting<string>('ai.visionFallbackModels'),
  ]);
  const openrouterKey = (openrouterSetting || process.env.OPENROUTER_API_KEY || '').trim();
  const url = (urlSetting || '').trim() || (openrouterKey ? OPENROUTER_URL : GEMINI_OPENAI_URL);
  const key = isOpenRouter(url)
    ? openrouterKey
    : (visionKeySetting || process.env.GEMINI_API_KEY || process.env.DEEPINFRA_TOKEN || process.env.OPENAI_API_KEY || '').trim();
  const model = providerModel((modelSetting || DEFAULT_MODEL).trim(), url);
  const fallbacks = (fallbackSetting ?? DEFAULT_FALLBACKS)
    .split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean).map((m) => providerModel(m, url));
  return { url, key, model, fallbacks };
}
