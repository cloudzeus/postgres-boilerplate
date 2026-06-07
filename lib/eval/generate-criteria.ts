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

function coerceCriteria(raw: any): Criterion[] {
  const arr = Array.isArray(raw?.criteria) ? raw.criteria : [];
  return arr
    .filter((c: any) => c?.code || c?.label)
    .map((c: any): Criterion => {
      const variables: CritVariable[] = (Array.isArray(c?.variables) ? c.variables : [])
        .filter((v: any) => v?.key)
        .map((v: any): CritVariable => {
          // Field mapping (αντιστοίχιση) happens LATER, manually. The AI only
          // captures the questionnaire structure, so non-DERIVED inputs default to MANUAL.
          let source: VarSource = SOURCES.includes(v?.source) ? v.source : 'MANUAL';
          if (source === 'FINANCIAL') source = 'MANUAL'; // unmapped until the user links it to an E3 field
          return {
            key: String(v.key),
            label: v?.label ? String(v.label) : undefined,
            source,
            fieldKey: null,
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

function buildSystemPrompt(): string {
  return [
    'Είσαι ειδικός σε ΕΣΠΑ/ευρωπαϊκά προγράμματα. Στο κείμενο του οδηγού υπάρχει το ΕΡΩΤΗΜΑΤΟΛΟΓΙΟ/ΣΥΣΤΗΜΑ ΑΞΙΟΛΟΓΗΣΗΣ,',
    'συνήθως στο ΠΑΡΑΡΤΗΜΑ ΙΙΙ (ή σε ενότητα «Βαθμολογούμενα Κριτήρια»): κριτήρια με βαρύτητες (στάθμιση),',
    'δείκτες/τύπους υπολογισμού, κλίμακες βαθμολόγησης (πόσοι βαθμοί ανά τιμή δείκτη) και ελάχιστη συνολική βαθμολογία.',
    'Εντόπισέ το και εξήγαγέ το ΠΙΣΤΑ όπως περιγράφεται. ΜΗΝ αντιστοιχίσεις σε πεδία/δικαιολογητικά — η αντιστοίχιση γίνεται ΑΡΓΟΤΕΡΑ χειροκίνητα.',
    '',
    'Επίστρεψε ΕΝΑ raw JSON object (χωρίς markdown):',
    '{ "annexRef": "<π.χ. Παράρτημα ΙΙΙ, αν εντοπίστηκε>",',
    '  "threshold": <ελάχιστη συνολική βαθμολογία ή null>,',
    '  "criteria": [ {',
    '    "code": "Β1", "label": "Κάλυψη Τόκων", "weight": <στάθμιση ως αριθμός, π.χ. 20>,',
    '    "variables": [',
    '      { "key": "ebit", "label": "EBIT", "source": "MANUAL" },',
    '      { "key": "interest", "label": "Χρεωστικοί Τόκοι", "source": "MANUAL" },',
    '      { "key": "icr", "source": "DERIVED", "formula": "ebit / interest" }',
    '    ],',
    '    "indexKey": "icr",            // ή "indexExpression": "ebit / interest"',
    '    "bandMode": "LOOKUP",         // ή "PASSTHROUGH" αν ο δείκτης ΕΙΝΑΙ ο βαθμός (0-100)',
    '    "bands": [ {"min": null, "max": 1, "score": 0}, {"min": 1, "max": 5, "score": 50}, {"min": 5, "max": null, "score": 100} ]',
    '  } ] }',
    '',
    'ΟΔΗΓΙΕΣ:',
    '- Κάθε μετρήσιμη εισροή (π.χ. EBIT, Τόκοι, Κύκλος Εργασιών) → μεταβλητή με source "MANUAL" + περιγραφικό label. ΑΦΗΣΕ την αντιστοίχιση σε πεδίο για αργότερα (μην βάλεις fieldKey).',
    '- Οι σχέσεις/λόγοι (π.χ. EBIT/Τόκοι, MAX τριετίας) → source "DERIVED" με "formula" (επιτρέπονται +,-,*,/,παρενθέσεις,MAX,MIN,SUM,AVG).',
    '- "indexKey" ή "indexExpression": ποια τιμή περνά στις ζώνες βαθμολόγησης.',
    '- "bands": η κλίμακα βαθμολόγησης του οδηγού (τιμή δείκτη → βαθμοί 0-100). Αν δεν δίνονται ακριβή όρια, βάλε λογικές ζώνες με βάση το κείμενο.',
    '- Αν ένα κριτήριο είναι κρίση αξιολογητή ή ΝΑΙ/ΟΧΙ, χρησιμοποίησε bandMode "PASSTHROUGH" ή κατάλληλες ζώνες.',
    '- Κράτα τα codes/labels/βαρύτητες ΑΚΡΙΒΩΣ όπως στον οδηγό. Επίστρεψε ΜΟΝΟ το JSON.',
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
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: `Βρες το ερωτηματολόγιο αξιολόγησης (Παράρτημα ΙΙΙ / βαθμολογούμενα κριτήρια) και δώσε τα κριτήρια. Κείμενο οδηγού:\n\n${text}` },
        ],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({ scope: 'OCR_TEXT', provider: providerFromUrl(apiUrl), model: MODEL, operation: 'program.computed_criteria', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 });

  const parsed = await parseJsonLoose(data?.choices?.[0]?.message?.content);
  const criteria = coerceCriteria(parsed);
  return { criteria, threshold: num(parsed?.threshold), model: MODEL };
}
