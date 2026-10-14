// lib/ocr/split-vision.ts — SERVER. Όρια παραστατικών σε ΣΑΡΩΜΕΝΟ PDF, με ΜΙΑ κλήση στο μοντέλο.
//
// Ένα σαρωμένο PDF δεν έχει text layer, οπότε το `suggestSplits` δεν βλέπει τίποτα και προτείνει
// «ένα παραστατικό ανά σελίδα»: ένα τιμολόγιο τριών σελίδων γινόταν τρία. Εδώ στέλνουμε ΟΛΟ το PDF
// μία φορά (εγγενώς, χωρίς rasterize — OpenRouter ή Google) και ζητάμε για κάθε σελίδα ό,τι
// χρειάζεται ο διαχωρισμός: εκδότη, ΑΦΜ, αριθμό, «σελ. k από N», αν είναι κενή, και αν ξεκινά νέο
// παραστατικό. Μετρημένο στη στοίβα του σαρωτή γραφείου (31 σελίδες): 26 παραστατικά, ~12k tokens,
// 25–45 δευτερόλεπτα.
//
// Η ανάλυση είναι ΠΡΟΤΑΣΗ, όπως και το text layer: ο χρήστης βλέπει τις σελίδες και αλλάζει τα
// κοψίματα. Αποτυχία του μοντέλου ⇒ `null`, και ο καλών μένει στην παλιά συμπεριφορά.
import 'server-only';
import { callPdfNative, parseJsonLoose, resolveCfg } from './extract';
import { supportsPdfNative } from '@/lib/ai/vision-provider';
import { isValidAfm } from './validate';
import type { PageSignal } from './split';

/** Ό,τι δείχνει η προεπισκόπηση κάτω από κάθε σελίδα. */
export interface PageInfo {
  kind: string | null;
  issuerName: string | null;
  docNumber: string | null;
  date: string | null;
  total: number | null;
  pageOf: { page: number; of: number } | null;
}

export interface VisionSplit {
  signals: PageSignal[];
  info: PageInfo[];
  model: string;
}

const SYSTEM = `Είσαι αναλυτής σαρωμένων λογιστικών εγγράφων. Το PDF είναι ΣΤΟΙΒΑ από πολλά παραστατικά (τιμολόγια, αποδείξεις, δελτία, πιστωτικά, λογαριασμοί ρεύματος/νερού/τηλεφώνου) σαρωμένα μαζί, το ένα μετά το άλλο.
Για ΚΑΘΕ σελίδα του PDF, με τη σειρά, επέστρεψε ΜΟΝΟ JSON με αυτό το σχήμα:
{"pages":[{"page":1,"startsNew":true,"kind":"invoice","issuerName":"...","issuerAfm":"123456789","docNumber":"...","date":"YYYY-MM-DD","pageOf":"1/2","total":123.45}]}
Κανόνες:
- Μία εγγραφή για ΚΑΘΕ σελίδα, χωρίς να παραλείψεις καμία· "page" = αύξων αριθμός σελίδας στο PDF (1, 2, 3…).
- startsNew=true όταν η σελίδα είναι η ΠΡΩΤΗ σελίδα ενός παραστατικού (νέα κεφαλίδα εκδότη, νέος αριθμός). false όταν συνεχίζει το προηγούμενο (συνέχεια γραμμών, «σελ. 2/3», πίσω όψη, όροι, συνημμένο του ίδιου παραστατικού).
- kind: invoice | receipt | delivery_note | credit_note | statement | blank | other. "blank" για κενή ή σχεδόν κενή σελίδα.
- issuerAfm: ο ΑΦΜ του ΕΚΔΟΤΗ (όχι του πελάτη/παραλήπτη), 9 ψηφία χωρίς πρόθεμα χώρας· null αν δεν φαίνεται.
- docNumber: ο αριθμός του παραστατικού όπως τυπώνεται· null αν δεν φαίνεται.
- pageOf: «k/N» ΜΟΝΟ αν τυπώνεται ένδειξη σελίδας (π.χ. «Σελίδα 2 από 3»)· αλλιώς null.
- total: το πληρωτέο σύνολο αν φαίνεται σε αυτή τη σελίδα· αλλιώς null.
- Μην επινοείς τιμές. Κανένα κείμενο εκτός JSON.`;

const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
};

function parsePageOf(v: unknown): { page: number; of: number } | null {
  const m = /^\s*(\d{1,3})\s*(?:\/|από|of)\s*(\d{1,3})\s*$/i.exec(String(v ?? ''));
  if (!m) return null;
  const page = Number(m[1]); const of = Number(m[2]);
  return page >= 1 && of >= 1 && page <= of ? { page, of } : null;
}

/** Η απάντηση του μοντέλου → σήματα, ΕΥΘΥΓΡΑΜΜΙΣΜΕΝΑ με τις σελίδες (κενά όπου λείπει σελίδα). */
export function parseVisionPages(raw: unknown, pageCount: number): { signals: PageSignal[]; info: PageInfo[] } {
  const obj = raw as { pages?: unknown } | unknown[];
  const rows = (Array.isArray(obj) ? obj : Array.isArray((obj as { pages?: unknown })?.pages) ? (obj as { pages: unknown[] }).pages : []) as Record<string, unknown>[];
  const signals: PageSignal[] = Array.from({ length: pageCount }, () => ({}));
  const info: PageInfo[] = Array.from({ length: pageCount }, () => ({ kind: null, issuerName: null, docNumber: null, date: null, total: null, pageOf: null }));
  rows.forEach((r, i) => {
    // Το «page» του μοντέλου έχει προτεραιότητα· χωρίς αυτό, η σειρά της λίστας.
    const n = Number(r?.page);
    const idx = Number.isInteger(n) && n >= 1 && n <= pageCount ? n - 1 : i;
    if (idx < 0 || idx >= pageCount) return;
    const kind = str(r.kind)?.toLowerCase() ?? null;
    const afmRaw = str(r.issuerAfm)?.replace(/\D/g, '') ?? null;
    const issuerAfm = afmRaw && afmRaw.length === 9 && isValidAfm(afmRaw) ? afmRaw : null;
    const pageOf = parsePageOf(r.pageOf);
    const total = Number(r.total);
    signals[idx] = {
      startsNew: typeof r.startsNew === 'boolean' ? r.startsNew : null,
      issuerAfm,
      docNumber: str(r.docNumber),
      pageOf,
      blank: kind === 'blank',
    };
    info[idx] = {
      kind, issuerName: str(r.issuerName), docNumber: str(r.docNumber), date: str(r.date),
      total: Number.isFinite(total) && r.total != null ? total : null, pageOf,
    };
  });
  return { signals, info };
}

/**
 * Ανάλυση των σελίδων ενός PDF για τον διαχωρισμό. `null` όταν δεν υπάρχει πάροχος που διαβάζει
 * PDF εγγενώς ή όταν η κλήση αποτύχει — ποτέ δεν ρίχνει τη ροή του διαχωρισμού.
 */
export async function analyzePagesForSplit(pdf: Buffer, pageCount: number): Promise<VisionSplit | { error: string } | null> {
  try {
    const cfg = await resolveCfg();
    const native = [cfg.visionUrl, ...(cfg.visionAlternates ?? []).map((e) => e.url)].some((u) => supportsPdfNative(u));
    if (!native || !cfg.visionKey) return null;
    const out = await callPdfNative(cfg, SYSTEM, pdf);
    const parsed = parseVisionPages(parseJsonLoose(out.content), pageCount);
    // Απάντηση χωρίς ΚΑΜΙΑ χρήσιμη σελίδα = αποτυχία, όχι «όλα ένα παραστατικό».
    const useful = parsed.signals.some((s) => s.startsNew != null || s.docNumber || s.issuerAfm);
    if (!useful) return { error: 'Η ανάλυση δεν επέστρεψε στοιχεία σελίδων.' };
    return { ...parsed, model: out.model };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 300) };
  }
}
