// lib/ai/vision-config.ts — SERVER. Πάροχοι vision (OpenRouter / Google AI Studio) — ΜΙΑ πηγή.
//
// Δύο πάροχοι για τα ίδια μοντέλα Gemini, με ΠΡΟΤΕΡΑΙΟΤΗΤΑ ΣΤΟ OPENROUTER και αυτόματη μετάβαση:
//  - OpenRouter πρώτο (αν έχει κλειδί), Google AI Studio δεύτερο (αν έχει κλειδί) — όταν τελειώσουν
//    τα credits του OpenRouter (402) ή αρνηθεί (401/403/429), η ανάγνωση συνεχίζει στο δωρεάν όριο
//    του Google·
//  - ρητό `ai.visionUrl`: αυτό πρώτο, και ο άλλος γνωστός πάροχος ως εφεδρεία.
// Το κλειδί ακολουθεί τον πάροχο: ποτέ κλειδί Google προς το OpenRouter ή το αντίστροφο.
import 'server-only';
import { getSetting } from '@/lib/settings';
import { GEMINI_OPENAI_URL, OPENROUTER_URL, isGoogleAiStudio, isOpenRouter, providerModel } from './vision-provider';

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

/** Όλοι οι διαθέσιμοι πάροχοι, με τη σειρά που θα δοκιμαστούν. Ποτέ κενό. */
export async function resolveVisionEndpoints(): Promise<VisionEndpoint[]> {
  const [urlSetting, openrouterSetting, visionKeySetting, modelSetting, fallbackSetting] = await Promise.all([
    getSetting<string>('ai.visionUrl'),
    getSetting<string>('ai.openrouterApiKey'),
    getSetting<string>('ai.visionApiKey'),
    getSetting<string>('ai.visionModel'),
    getSetting<string>('ai.visionFallbackModels'),
  ]);
  const openrouterKey = (openrouterSetting || process.env.OPENROUTER_API_KEY || '').trim();
  const otherKey = (visionKeySetting || process.env.GEMINI_API_KEY || process.env.DEEPINFRA_TOKEN || process.env.OPENAI_API_KEY || '').trim();
  const keyFor = (url: string) => (isOpenRouter(url) ? openrouterKey : otherKey);

  const openrouter = openrouterKey ? OPENROUTER_URL : null;
  const google = otherKey ? GEMINI_OPENAI_URL : null;
  const explicit = (urlSetting || '').trim();

  let urls: string[];
  if (explicit) {
    // Ρητό endpoint πρώτο· εφεδρεία μόνο ένας ΑΛΛΟΣ γνωστός πάροχος με δικό του κλειδί.
    const backup = isOpenRouter(explicit) ? google : isGoogleAiStudio(explicit) ? openrouter : null;
    urls = [explicit, ...(backup ? [backup] : [])];
  } else {
    urls = [openrouter, google].filter((u): u is string => !!u);
  }
  // Κανένα κλειδί: κρατάμε το παλιό default ώστε το σφάλμα να λέει «δεν έχει ρυθμιστεί κλειδί».
  if (!urls.length) urls = [GEMINI_OPENAI_URL];

  const model = (modelSetting || DEFAULT_MODEL).trim();
  const fallbacks = (fallbackSetting ?? DEFAULT_FALLBACKS).split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
  return urls.map((url) => ({
    url,
    key: keyFor(url),
    model: providerModel(model, url),
    fallbacks: fallbacks.map((m) => providerModel(m, url)),
  }));
}

/** Ο πρώτος πάροχος (συμβατότητα με όσους δεν χρειάζονται εφεδρεία). */
export async function resolveVisionEndpoint(): Promise<VisionEndpoint> {
  return (await resolveVisionEndpoints())[0];
}

// ── Πάροχος εκτός για λίγο ──────────────────────────────────────────────────────────────────
// Χωρίς credits / άρνηση λογαριασμού δεν διορθώνεται σε δευτερόλεπτα: για 10 λεπτά ο πάροχος
// παρακάμπτεται, ώστε ένα PDF 20 σελίδων να μη χτυπά 20 φορές ένα endpoint που ξέρουμε ότι αρνείται.
const COOLDOWN_MS = 10 * 60 * 1000;
const downUntil = new Map<string, number>();

export function markProviderDown(url: string, ms = COOLDOWN_MS): void {
  downUntil.set(url, Date.now() + ms);
}
export function isProviderDown(url: string): boolean {
  const t = downUntil.get(url);
  if (!t) return false;
  if (Date.now() > t) { downUntil.delete(url); return false; }
  return true;
}
/** Για tests. */
export function resetProviderDown(): void {
  downUntil.clear();
}

/**
 * Σφάλμα ΛΟΓΑΡΙΑΣΜΟΥ (όχι του εγγράφου): χωρίς credits, άκυρο/αρνημένο κλειδί, εξαντλημένο όριο.
 * Αυτά βάζουν τον πάροχο σε αναμονή· τα υπόλοιπα (503 υπερφόρτωση κ.λπ.) απλώς δοκιμάζουν τον επόμενο.
 */
export function isAccountError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return /\b(401|402|403|429)\b|insufficient|credits|quota|RESOURCE_EXHAUSTED|PERMISSION_DENIED|denied access/i.test(m);
}

/**
 * Τρέχει την κλήση στον πρώτο διαθέσιμο πάροχο και, αν αποτύχει ολόκληρος (όλα τα μοντέλα του),
 * στον επόμενο. Οι πάροχοι σε αναμονή μπαίνουν στο τέλος — αν όλοι είναι σε αναμονή, δοκιμάζονται
 * κανονικά (καλύτερα μια κλήση που ίσως πετύχει παρά σίγουρη αποτυχία).
 */
export async function acrossProviders<T>(endpoints: VisionEndpoint[], run: (e: VisionEndpoint) => Promise<T>): Promise<T> {
  const ordered = [...endpoints.filter((e) => !isProviderDown(e.url)), ...endpoints.filter((e) => isProviderDown(e.url))];
  const errors: { url: string; err: unknown }[] = [];
  for (const [i, e] of ordered.entries()) {
    try {
      const value = await run(e);
      if (i > 0) console.warn(`[vision-provider] ανάγνωση από εφεδρικό πάροχο ${e.url}`);
      return value;
    } catch (err) {
      errors.push({ url: e.url, err });
      if (isAccountError(err)) markProviderDown(e.url);
      if (i < ordered.length - 1) {
        console.warn(`[vision-provider] ${e.url} απέτυχε (${(err as Error)?.message?.slice(0, 120)}) — δοκιμή του επόμενου παρόχου`);
      }
    }
  }
  if (errors.length <= 1) throw errors[0]?.err ?? new Error('Κανένας πάροχος vision');
  // Όλοι απέτυχαν: ένα μήνυμα με την απάντηση ΚΑΘΕ παρόχου — αλλιώς φαινόταν μόνο ο πρώτος.
  const host = (u: string) => (isOpenRouter(u) ? 'OpenRouter' : isGoogleAiStudio(u) ? 'Google' : u);
  throw new Error(errors.map(({ url, err }) => `${host(url)}: ${(err as Error)?.message ?? String(err)}`).join(' · '));
}
