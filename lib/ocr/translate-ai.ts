// lib/ocr/translate-ai.ts — SERVER. Μετάφραση περιγραφής είδους στα ΕΛΛΗΝΙΚΑ, κατά παραγγελία.
//
// Ξένα τιμολόγια γράφουν «TUBO AVV D80 4M 10/10 LSC ZX "RB" TAX Ø80mm smooth "Rollerbat"…». Για το
// μητρώο της SoftOne χρειάζεται ελληνική περιγραφή που να βρίσκεται με αναζήτηση. Η μετάφραση
// ΠΡΟΤΕΙΝΕΤΑΙ — μπαίνει στο πεδίο μόνο όταν ο χρήστης πατήσει, και η αρχική κρατιέται για επαναφορά.
import 'server-only';
import { callTextLLM, callTextViaVision, resolveCfg } from './extract';

const SYSTEM = [
  'Μεταφράζεις περιγραφές ειδών από τιμολόγια αγορών στα ΕΛΛΗΝΙΚΑ, για μητρώο ειδών ERP.',
  'Κανόνες: κράτα ΑΥΤΟΥΣΙΑ κωδικούς, διαστάσεις, αριθμούς, μονάδες (mm, M, kg), σύμβολα (Ø) και',
  'εμπορικά ονόματα/μάρκες (λέξεις σε εισαγωγικά) ΚΑΙ κάθε συντομογραφία ή άγνωστη λέξη με λατινικά',
  '(π.χ. AVV, LSC, ZX, RB) — ΠΟΤΕ μεταγραφή σε ελληνικούς χαρακτήρες. Μετάφρασε μόνο κοινές λέξεις που',
  'ξέρεις με βεβαιότητα (π.χ. TUBO → ΣΩΛΗΝΑΣ, zincato → ΓΑΛΒΑΝΙΖΕ, smooth → ΛΕΙΟΣ).',
  'Παράλειψε ό,τι δεν περιγράφει το είδος (π.χ. «Nomenclature code: 73069000», αριθμούς παραγγελίας).',
  'Έως 128 χαρακτήρες. Απάντησε ΜΟΝΟ με την περιγραφή, χωρίς εισαγωγικά ή σχόλια.',
].join('\n');

// Η μορφή της ελληνικής περιγραφής ακολουθεί τη ρύθμιση «Ονόματα ειδών» (`lib/item-naming.ts`):
// με «πεζά» η μετάφραση βγαίνει ήδη με σωστούς τόνους (τα άτονα κεφαλαία δεν ξανατονίζονται τυφλά).
const STYLE = {
  upper: 'ΚΕΦΑΛΑΙΑ γράμματα, χωρίς τόνους.',
  lower: 'Πεζά γράμματα με ΣΩΣΤΟΥΣ ελληνικούς τόνους (και τα λατινικά σε πεζά).',
} as const;
export type TranslateStyle = keyof typeof STYLE;

const cache = new Map<string, string>();

async function askOnce(system: string, src: string, usage: { operation: string; refType: string; refId?: string }): Promise<string | null> {
  const cfg = await resolveCfg();
  let content: string | null = null;
  if (cfg.textKey) {
    try { content = (await callTextLLM(cfg, system, src, usage)).content; } catch { /* δοκίμασε το vision */ }
  }
  if (content == null) {
    try { content = (await callTextViaVision(cfg, system, src, usage)).content; } catch { return null; }
  }
  const out = String(content ?? '').split('\n')[0].replace(/^["«»'\s]+|["«»'\s]+$/g, '').trim().slice(0, 128);
  return out || null;
}

/** Η ελληνική περιγραφή, ή `null` αν κανένα μοντέλο δεν απάντησε. */
export async function translateItemName(text: string, ref?: string, style: TranslateStyle = 'upper'): Promise<string | null> {
  const src = String(text ?? '').trim().slice(0, 500);
  if (!src) return null;
  const key = `${style}\u0000${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = await askOnce(`${SYSTEM}\n${STYLE[style]}`, src, { operation: 'ocr.translate_item', refType: 'OcrInvoiceItem', refId: ref });
  if (!out) return null;
  cache.set(key, out);
  return out;
}

const ACCENT_SYSTEM = [
  'Σου δίνεται περιγραφή είδους ERP σε πεζά ελληνικά ΧΩΡΙΣ τόνους.',
  'Πρόσθεσε ΜΟΝΟ τους σωστούς ελληνικούς τόνους (και διαλυτικά όπου χρειάζονται).',
  'ΜΗΝ αλλάξεις, προσθέσεις, αφαιρέσεις ή διορθώσεις κανένα γράμμα, αριθμό, κωδικό ή σημείο στίξης.',
  'Λέξεις που δεν ξέρεις, συντομογραφίες και λατινικά μένουν όπως είναι. Απάντησε ΜΟΝΟ με το κείμενο.',
].join('\n');

/**
 * Τονισμός πεζών (από ΚΕΦΑΛΑΙΑ τιμολογίου). Επιστρέφει την απάντηση του μοντέλου ΧΩΡΙΣ έλεγχο —
 * ο έλεγχος «άλλαξαν μόνο τόνοι» (`acceptAccented`) γίνεται από τον καλούντα.
 */
export async function accentGreekLower(text: string, ref?: string): Promise<string | null> {
  const src = String(text ?? '').trim().slice(0, 300);
  if (!src) return null;
  const key = `accent\u0000${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = await askOnce(ACCENT_SYSTEM, src, { operation: 'ocr.accent_item', refType: 'OcrInvoiceItem', refId: ref });
  if (!out) return null;
  cache.set(key, out);
  return out;
}
