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
  'ΚΕΦΑΛΑΙΑ γράμματα, χωρίς τόνους, έως 128 χαρακτήρες. Απάντησε ΜΟΝΟ με την περιγραφή, χωρίς εισαγωγικά ή σχόλια.',
].join('\n');

const cache = new Map<string, string>();

/** Η ελληνική περιγραφή, ή `null` αν κανένα μοντέλο δεν απάντησε. */
export async function translateItemName(text: string, ref?: string): Promise<string | null> {
  const src = String(text ?? '').trim().slice(0, 500);
  if (!src) return null;
  const hit = cache.get(src);
  if (hit) return hit;
  const usage = { operation: 'ocr.translate_item', refType: 'OcrInvoiceItem', refId: ref };
  const cfg = await resolveCfg();
  let content: string | null = null;
  if (cfg.textKey) {
    try { content = (await callTextLLM(cfg, SYSTEM, src, usage)).content; } catch { /* δοκίμασε το vision */ }
  }
  if (content == null) {
    try { content = (await callTextViaVision(cfg, SYSTEM, src, usage)).content; } catch { return null; }
  }
  const out = String(content ?? '').split('\n')[0].replace(/^["«»'\s]+|["«»'\s]+$/g, '').trim().slice(0, 128);
  if (!out) return null;
  cache.set(src, out);
  return out;
}
