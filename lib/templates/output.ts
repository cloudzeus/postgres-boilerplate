// lib/templates/output.ts — ISOMORPHIC. The one JSON shape every extraction produces (spec §14.1-5, §17.1).
import { DOCUMENT_VERSION, type DocumentEnvelope, type DocumentJson } from '@/lib/ocr/canonical';
import type { FieldValue } from './schema';

export type OutputJson = { template: string; version: number; extractedAt: string; values: Record<string, FieldValue['value']> };

export function toOutputJson(template: { slug: string; version: number }, values: Record<string, FieldValue>, at: Date = new Date()): OutputJson {
  const out: OutputJson['values'] = {};
  for (const [key, v] of Object.entries(values)) out[key] = v.value;
  return { template: template.slug, version: template.version, extractedAt: at.toISOString(), values: out };
}

/**
 * Ο φάκελος εξόδου μιας εκτέλεσης (spec §17.1), όπως αποθηκεύεται στο `TemplateRun.output` και όπως
 * τον κατεβάζει ο χρήστης. ΕΝΑ κανονικό έγγραφο, όχι δύο μισά: ό,τι διάβασε το πρότυπο έχει ήδη
 * προβληθεί πάνω στο έγγραφο (διαδρομή ή `custom.<πεδίο>`), άρα δεν υπάρχει δεύτερη λίστα τιμών
 * που θα μπορούσε να διαφωνεί με την πρώτη.
 *
 * Το `version` είναι η έκδοση του ΣΧΗΜΑΤΟΣ (3), όχι του προτύπου: η έκδοση του προτύπου ζει στη
 * στήλη `TemplateRun.templateVersion`, όπου και ανήκει.
 */
export function toRunOutput(input: {
  slug: string | null;
  file: string;
  documentId: string;
  createdAt: Date;
  document: DocumentJson;
}): DocumentEnvelope {
  return {
    template: input.slug,
    version: DOCUMENT_VERSION,
    extractedAt: input.createdAt.toISOString(),
    file: input.file,
    documentId: input.documentId,
    document: input.document,
  };
}

/** Ό,τι έχει σχήμα φακέλου v3 — ένα `TemplateRun.output` γραμμένο από προηγούμενη εκτέλεση. */
export function asEnvelope(raw: unknown): DocumentEnvelope | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return o.document != null && typeof o.document === 'object' ? (o as unknown as DocumentEnvelope) : null;
}
