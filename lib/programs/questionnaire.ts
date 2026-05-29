// lib/programs/questionnaire.ts
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { bunnyDownload } from '@/lib/bunny';
import { QUESTIONNAIRE_SYSTEM_PROMPT } from './questionnaire-prompt';
import { asNum, asStr } from './coerce';
import type { QuestionnaireDraft, ScoringModel, AnswerType, CompanyField } from './questionnaire-types';

const MODEL = 'deepseek-reasoner';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TEXT_CHARS = 360_000;

const ANSWER_TYPES: AnswerType[] = ['BOOLEAN', 'SINGLE_CHOICE', 'NUMERIC', 'SCALE'];
const COMPANY_FIELDS: CompanyField[] = ['legalForm', 'operationalYears', 'employeeCount', 'region', 'kad'];

async function parseJsonLoose(s: string): Promise<any> {
  const cleaned = (s || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const { jsonrepair } = await import('jsonrepair');
  return JSON.parse(jsonrepair(candidate));
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text ?? '')];
  return pages.map((t, i) => `--- ΣΕΛΙΔΑ ${i + 1} ---\n${t}`).join('\n\n').replace(/[ \t]+/g, ' ').trim();
}

function coerceDraft(raw: any): QuestionnaireDraft {
  const scoringModel: ScoringModel = raw?.scoringModel === 'POINTS_SUM' ? 'POINTS_SUM' : 'WEIGHTED';
  const questions = Array.isArray(raw?.questions) ? raw.questions : [];
  return {
    scoringModel,
    threshold: asNum(raw?.threshold),
    maxScore: asNum(raw?.maxScore),
    sourceNote: asStr(raw?.sourceNote),
    questions: questions
      .filter((q: any) => asStr(q?.text))
      .map((q: any) => ({
        code: asStr(q?.code),
        text: asStr(q?.text)!,
        criterionRef: asStr(q?.criterionRef),
        helpText: asStr(q?.helpText),
        answerType: ANSWER_TYPES.includes(q?.answerType) ? q.answerType : 'SINGLE_CHOICE',
        weight: asNum(q?.weight),
        maxPoints: asNum(q?.maxPoints),
        companyField: COMPANY_FIELDS.includes(q?.companyField) ? q.companyField : null,
        options: Array.isArray(q?.options)
          ? q.options.filter((o: any) => asStr(o?.label)).map((o: any) => ({ label: asStr(o.label)!, points: asNum(o?.points) ?? 0 }))
          : [],
      })),
  };
}

/** Generate a questionnaire draft for a program via a focused DeepSeek call. */
export async function generateQuestionnaire(programId: string): Promise<{ draft: QuestionnaireDraft; model: string }> {
  const apiKey = (await getSetting<string>('ai.deepseekApiKey')) ?? process.env.DEEPSEEK_API_KEY ?? '';
  const apiUrl = (await getSetting<string>('ai.deepseekUrl')) ?? 'https://api.deepseek.com/v1/chat/completions';
  if (!apiKey) throw new Error('DeepSeek API key not configured.');

  const program = await prisma.program.findUnique({ where: { id: programId }, include: { files: true, criteria: { orderBy: { order: 'asc' } } } });
  if (!program) throw new Error('Program not found');

  // Build full text from attached files (fallback to storageKey).
  const fileRows = program.files.length ? program.files : (program.storageKey ? [{ storageKey: program.storageKey, mimeType: program.mimeType ?? 'application/pdf', fileName: program.sourceFileName ?? 'main.pdf' } as any] : []);
  let text = '';
  for (const f of fileRows) {
    try { text += `\n\n=== ${f.fileName} ===\n\n` + await extractPdfText(await bunnyDownload(f.storageKey)); } catch { /* skip */ }
  }
  text = text.slice(0, MAX_TEXT_CHARS);
  if (text.length < 200) {
    // Fallback: use already-extracted criteria as the source material.
    text = 'ΚΡΙΤΗΡΙΑ ΠΡΟΓΡΑΜΜΑΤΟΣ:\n' + program.criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: MODEL, temperature: 0.1, max_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: QUESTIONNAIRE_SYSTEM_PROMPT },
          { role: 'user', content: `Φτιάξε το ερωτηματολόγιο αυτοαξιολόγησης. Κείμενο:\n\n${text}` },
        ],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.usage ?? {};
  void logAiUsage({ scope: 'OCR_TEXT', provider: providerFromUrl(apiUrl), model: MODEL, operation: 'program.questionnaire', inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 });

  const draft = coerceDraft(await parseJsonLoose(data?.choices?.[0]?.message?.content));
  return { draft, model: MODEL };
}

/** Replace the program's questionnaire definition (questions + options) from a draft. */
export async function persistQuestionnaire(programId: string, draft: QuestionnaireDraft, model: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.programQuestionnaire.findUnique({ where: { programId } });
    if (existing) await tx.programQuestion.deleteMany({ where: { questionnaireId: existing.id } });
    const q = await tx.programQuestionnaire.upsert({
      where: { programId },
      create: {
        programId, scoringModel: draft.scoringModel, threshold: draft.threshold ?? undefined,
        maxScore: draft.maxScore ?? undefined, sourceNote: draft.sourceNote ?? undefined,
        status: 'READY', generatedModel: model ?? undefined, generatedAt: new Date(),
      },
      update: {
        scoringModel: draft.scoringModel, threshold: draft.threshold ?? null, maxScore: draft.maxScore ?? null,
        sourceNote: draft.sourceNote ?? null, status: 'READY', generatedModel: model ?? undefined, generatedAt: new Date(),
      },
    });
    for (let i = 0; i < draft.questions.length; i++) {
      const d = draft.questions[i];
      await tx.programQuestion.create({
        data: {
          questionnaireId: q.id, code: d.code ?? undefined, text: d.text, criterionRef: d.criterionRef ?? undefined,
          helpText: d.helpText ?? undefined, answerType: d.answerType, weight: d.weight ?? undefined,
          maxPoints: d.maxPoints ?? undefined, companyField: d.companyField ?? undefined, order: i,
          options: { create: d.options.map((o, j) => ({ label: o.label, points: o.points, order: j })) },
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });
}
