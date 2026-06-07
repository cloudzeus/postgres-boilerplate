import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { bunnyDownload } from '@/lib/bunny';
import type { Criterion, CritVariable, BandMode, VarSource, YearMode } from './score';

const MODEL = 'deepseek-reasoner';
const MAX_TEXT_CHARS = 120_000;
const REQUEST_TIMEOUT_MS = 180_000;

/** Company data fields a criterion variable may reference (resolved manually for now). */
export const COMPANY_FIELDS = [
  { key: 'company_employees', label: 'Αριθμός εργαζομένων / ΕΜΕ' },
  { key: 'company_years', label: 'Έτη λειτουργίας' },
  { key: 'company_region', label: 'Περιφέρεια' },
  { key: 'company_legal_form', label: 'Νομική μορφή' },
];

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  return pages.map((t, i) => `--- ΣΕΛΙΔΑ ${i + 1} ---\n${t}`).join('\n\n').replace(/[ \t]+/g, ' ').trim();
}

async function parseJsonLoose(s: string): Promise<any> {
  const cleaned = String(s ?? '').replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const { jsonrepair } = await import('jsonrepair');
  return JSON.parse(jsonrepair(candidate));
}

const SOURCES: VarSource[] = ['FINANCIAL', 'MANUAL', 'PARAM', 'DERIVED'];
const YEAR_MODES: YearMode[] = ['REFERENCE', 'PRIOR_1', 'PRIOR_2', 'PRIOR_3'];
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function coerceCriteria(raw: any, allowedKeys: Set<string>): Criterion[] {
  const arr = Array.isArray(raw?.criteria) ? raw.criteria : [];
  return arr
    .filter((c: any) => c?.code || c?.label)
    .map((c: any): Criterion => {
      const variables: CritVariable[] = (Array.isArray(c?.variables) ? c.variables : [])
        .filter((v: any) => v?.key)
        .map((v: any): CritVariable => {
          const source: VarSource = SOURCES.includes(v?.source) ? v.source : 'MANUAL';
          let fieldKey: string | null = v?.fieldKey ?? null;
          // Drop hallucinated financial keys that don't exist in the mapped templates.
          if (source === 'FINANCIAL' && (!fieldKey || !allowedKeys.has(fieldKey))) fieldKey = fieldKey && allowedKeys.has(fieldKey) ? fieldKey : null;
          return {
            key: String(v.key),
            label: v?.label ? String(v.label) : undefined,
            source,
            fieldKey: source === 'FINANCIAL' ? fieldKey : null,
            yearMode: YEAR_MODES.includes(v?.yearMode) ? v.yearMode : 'REFERENCE',
            constant: source === 'PARAM' ? num(v?.constant) : null,
            formula: source === 'DERIVED' ? (v?.formula ? String(v.formula) : null) : null,
          };
        });
      const bandMode: BandMode = c?.bandMode === 'PASSTHROUGH' ? 'PASSTHROUGH' : 'LOOKUP';
      const bands = (Array.isArray(c?.bands) ? c.bands : [])
        .map((b: any) => ({ min: b?.min == null ? null : num(b.min), max: b?.max == null ? null : num(b.max), score: num(b?.score) ?? 0 }));
      return {
        code: String(c?.code ?? ''),
        label: String(c?.label ?? c?.code ?? ''),
        weight: num(c?.weight) ?? 0,
        variables,
        indexKey: c?.indexKey ? String(c.indexKey) : null,
        indexExpression: c?.indexExpression ? String(c.indexExpression) : null,
        bandMode,
        bands,
      };
    });
}

function buildSystemPrompt(fields: { key: string; label: string; valueType: string }[]): string {
  const fieldList = fields.map((f) => `  - ${f.key} — ${f.label} (${f.valueType})`).join('\n');
  const companyList = COMPANY_FIELDS.map((c) => `  - ${c.label}`).join('\n');
  return [
    'Είσαι ειδικός σε ΕΣΠΑ/ευρωπαϊκά προγράμματα. Στο κείμενο του οδηγού υπάρχει ΣΥΣΤΗΜΑ ΒΑΘΜΟΛΟΓΗΣΗΣ/ΑΞΙΟΛΟΓΗΣΗΣ',
    '(βαθμολογούμενα κριτήρια με βαρύτητες, δείκτες/τύπους, κλίμακες βαθμολόγησης, ελάχιστη βαθμολογία).',
    'Βρες το και μετάτρεψέ το σε ΥΠΟΛΟΓΙΣΤΙΚΑ ΚΡΙΤΗΡΙΑ, αντιστοιχίζοντας τις μεταβλητές ΜΟΝΟ στα παρακάτω διαθέσιμα πεδία.',
    '',
    'ΔΙΑΘΕΣΙΜΑ ΟΙΚΟΝΟΜΙΚΑ ΠΕΔΙΑ (δικαιολογητικά Ε3/Ε1) — χρησιμοποίησέ τα ως source "FINANCIAL" με αυτό ακριβώς το fieldKey:',
    fieldList || '  (κανένα — όρισε όλες τις οικονομικές μεταβλητές ως MANUAL)',
    '',
    'ΣΤΟΙΧΕΙΑ ΠΕΛΑΤΗ (όρισέ τα ως source "MANUAL"):',
    companyList,
    '',
    'ΚΑΝΟΝΕΣ ΕΞΟΔΟΥ — επίστρεψε ΕΝΑ raw JSON object:',
    '{ "threshold": <ελάχιστη συνολική βαθμολογία ή null>,',
    '  "criteria": [ {',
    '    "code": "Β1", "label": "...", "weight": <στάθμιση ως αριθμός, π.χ. 20>,',
    '    "variables": [',
    '      { "key": "ebit", "label": "EBIT", "source": "FINANCIAL", "fieldKey": "E3.526", "yearMode": "REFERENCE" },',
    '      { "key": "interest", "source": "FINANCIAL", "fieldKey": "E3.528", "yearMode": "REFERENCE" },',
    '      { "key": "icr", "source": "DERIVED", "formula": "ebit / interest" }',
    '    ],',
    '    "indexKey": "icr",            // ή "indexExpression": "ebit / interest"',
    '    "bandMode": "LOOKUP",         // ή "PASSTHROUGH" αν ο δείκτης ΕΙΝΑΙ ο βαθμός (0-100)',
    '    "bands": [ {"min": null, "max": 1, "score": 0}, {"min": 1, "max": 5, "score": 50}, {"min": 5, "max": null, "score": 100} ]',
    '  } ] }',
    '',
    'ΟΔΗΓΙΕΣ:',
    '- source: "FINANCIAL" (από Ε3, με υπαρκτό fieldKey από τη λίστα) | "DERIVED" (formula με +,-,*,/,παρενθέσεις,MAX,MIN,SUM,AVG) | "PARAM" (σταθερά, π.χ. προϋπολογισμός — βάλε constant:null αν εισάγεται) | "MANUAL" (κρίση αξιολογητή, ΝΑΙ/ΟΧΙ, στοιχεία πελάτη).',
    '- Για πολυετείς δείκτες (π.χ. MAX κύκλου τριετίας) χρησιμοποίησε το ΙΔΙΟ fieldKey με διαφορετικά yearMode (REFERENCE, PRIOR_1, PRIOR_2).',
    '- Οι ζώνες (bands) πρέπει να αντιστοιχούν στην κλίμακα βαθμολόγησης του οδηγού (δείκτης → βαθμοί 0-100). Αν ο οδηγός δεν δίνει ακριβή όρια, βάλε λογικές ζώνες.',
    '- ΜΗΝ εφεύρεις fieldKey που δεν είναι στη λίστα. Αν λείπει, κάνε τη μεταβλητή MANUAL.',
    '- Επίστρεψε ΜΟΝΟ το JSON, χωρίς markdown.',
  ].join('\n');
}

export async function generateComputedCriteria(programId: string): Promise<{ criteria: Criterion[]; threshold: number | null; model: string }> {
  const apiKey = (await getSetting<string>('ai.deepseekApiKey')) ?? process.env.DEEPSEEK_API_KEY ?? '';
  const apiUrl = (await getSetting<string>('ai.deepseekUrl')) ?? 'https://api.deepseek.com/v1/chat/completions';
  if (!apiKey) throw new Error('DeepSeek API key not configured.');

  const program = await prisma.program.findUnique({ where: { id: programId }, include: { files: true, criteria: { orderBy: { order: 'asc' } } } });
  if (!program) throw new Error('Program not found');

  const fileRows = program.files.length ? program.files : (program.storageKey ? [{ storageKey: program.storageKey, fileName: program.sourceFileName ?? 'main.pdf' } as { storageKey: string; fileName: string }] : []);
  let text = '';
  for (const f of fileRows) {
    if (!f.storageKey) continue;
    try { text += `\n\n=== ${f.fileName} ===\n\n` + await extractPdfText(await bunnyDownload(f.storageKey)); } catch { /* skip */ }
  }
  text = text.slice(0, MAX_TEXT_CHARS);
  if (text.length < 200 && program.criteria.length) {
    text = 'ΚΡΙΤΗΡΙΑ ΠΡΟΓΡΑΜΜΑΤΟΣ:\n' + program.criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  }
  if (text.length < 50) throw new Error('Δεν βρέθηκε κείμενο οδηγού για ανάλυση.');

  const templates = await prisma.taxFormTemplate.findMany({ include: { fields: { orderBy: { order: 'asc' } } } });
  const fields = templates.flatMap((t) => t.fields.map((f) => ({ key: `${t.code}.${f.fieldKey}`, label: f.label, valueType: f.valueType })));
  const allowedKeys = new Set(fields.map((f) => f.key));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL, temperature: 0.1, max_tokens: 8192, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(fields) },
          { role: 'user', content: `Βρες το σύστημα βαθμολόγησης και δώσε τα υπολογιστικά κριτήρια. Κείμενο οδηγού:\n\n${text}` },
        ],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({ scope: 'OCR_TEXT', provider: providerFromUrl(apiUrl), model: MODEL, operation: 'program.computed_criteria', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 });

  const parsed = await parseJsonLoose(data?.choices?.[0]?.message?.content);
  const criteria = coerceCriteria(parsed, allowedKeys);
  return { criteria, threshold: num(parsed?.threshold), model: MODEL };
}
