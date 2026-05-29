// lib/programs/assessment-report.ts
// Builds a polished, DG-branded Word (.docx) eligibility-assessment report for a customer:
// banner header, styled tables, score breakdown, a deterministic Greek narrative and a
// legend explaining the results.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, VerticalAlign,
} from 'docx';

type Num = number | string | null | undefined;
const n = (v: Num): number | null => (v == null || v === '' ? null : Number(v));

interface EligCriterion { key: string; label: string; required: string | null; actual: string | null; pass: boolean; note?: string }
interface EligResult { criteria: EligCriterion[]; eligible: boolean }
interface ReportQuestion { id: string; code: string | null; text: string; answerType: string; maxPoints: Num; weight: Num; options: { id: string; label: string; points: Num }[] }
interface ReportAnswer { questionId: string; valueBool: boolean | null; valueNumber: Num; selectedOptionId: string | null; pointsAwarded: Num }

export interface AssessmentForReport {
  overallVerdict: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'NEEDS_REVIEW';
  eligible: boolean | null;
  eligibilityResult: unknown;
  questionnaireScore: Num;
  questionnaireMax: Num;
  questionnairePassed: boolean | null;
  createdAt: Date;
  company: { name: string; afm: string | null; legalForm: string | null; regionCode: string | null } | null;
  program: { title: string; referenceCode: string | null } | null;
  questionnaire: { threshold: Num; maxScore: Num; sourceNote: string | null; questions?: ReportQuestion[] } | null;
  answers?: ReportAnswer[];
}

// ── DG palette ──────────────────────────────────────────────
const FONT = 'Segoe UI';
const SISYPHUS = '0078D4';
const SISYPHUS_TINT = 'EAF3FB';
const DG_RED = 'E31E2A';
const INK = '101828';
const SUBTLE = '667085';
const LINE = 'D0D5DD';
const ZEBRA = 'F9FAFB';
const GREEN = '067647';
const RED = 'B42318';
const AMBER = 'B54708';

function fmtDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function verdictMeta(v: AssessmentForReport['overallVerdict']) {
  switch (v) {
    case 'ELIGIBLE': return { label: 'ΕΠΙΛΕΞΙΜΗ', color: GREEN, tint: 'ECFDF3' };
    case 'NOT_ELIGIBLE': return { label: 'ΜΗ ΕΠΙΛΕΞΙΜΗ', color: RED, tint: 'FEF3F2' };
    default: return { label: 'ΑΠΑΙΤΕΙ ΕΛΕΓΧΟ', color: AMBER, tint: 'FFFAEB' };
  }
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};
const GRID_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E4E7EC' },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E4E7EC' },
};

function run(text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) {
  return new TextRun({ text, bold: o.bold, color: o.color ?? INK, size: o.size ?? 20, italics: o.italics, font: FONT });
}
function para(children: TextRun[], o: { spacingAfter?: number; spacingBefore?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new Paragraph({ children, spacing: { after: o.spacingAfter ?? 60, before: o.spacingBefore ?? 0 }, alignment: o.align });
}
function sectionHeading(text: string) {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: SISYPHUS_TINT } },
    children: [run(text, { bold: true, color: SISYPHUS, size: 24 })],
  });
}
function kv(label: string, value: string) {
  return new Paragraph({ spacing: { after: 40 }, children: [run(`${label}: `, { bold: true, color: SUBTLE, size: 19 }), run(value || '—', { size: 19 })] });
}

interface Cell { text: string; bold?: boolean; color?: string }
function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: SISYPHUS_TINT },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [run(text, { bold: true, color: SISYPHUS, size: 18 })] })],
  });
}
function bodyCell(c: Cell, widthPct: number, fill?: string): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [run(c.text, { bold: c.bold, color: c.color, size: 18 })] })],
  });
}
function styledTable(headers: { text: string; w: number }[], rows: Cell[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: GRID_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => headerCell(h.text, h.w)) }),
      ...rows.map((r, ri) => new TableRow({
        children: r.map((c, ci) => bodyCell(c, headers[ci].w, ri % 2 === 1 ? ZEBRA : undefined)),
      })),
    ],
  });
}

/** Deterministic Greek reasoning text — returns one or more paragraphs of plain text. */
export function buildAssessmentNarrative(a: AssessmentForReport): string[] {
  const elig = (a.eligibilityResult ?? { criteria: [], eligible: false }) as EligResult;
  const failed = (elig.criteria ?? []).filter((c) => !c.pass);
  const score = n(a.questionnaireScore);
  const max = n(a.questionnaireMax) ?? n(a.questionnaire?.maxScore);
  const threshold = n(a.questionnaire?.threshold);
  const hasQ = score != null && threshold != null;
  const out: string[] = [];

  if (a.overallVerdict === 'NOT_ELIGIBLE') {
    out.push(
      'Με βάση τον έλεγχο των βασικών κριτηρίων επιλεξιμότητας, η επιχείρηση ΔΕΝ πληροί ' +
      'τις προϋποθέσεις συμμετοχής στο πρόγραμμα. Συγκεκριμένα, δεν καλύπτονται τα ακόλουθα κριτήρια:',
    );
    for (const c of failed) out.push(`• ${c.label}: ${c.actual ?? '—'}${c.required ? ` (απαιτείται: ${c.required})` : ''}.`);
    out.push('Για τους παραπάνω λόγους η αίτηση δεν μπορεί να προχωρήσει με τα τρέχοντα στοιχεία.');
    return out;
  }
  if (a.overallVerdict === 'ELIGIBLE') {
    out.push('Η επιχείρηση ΠΛΗΡΟΙ το σύνολο των βασικών κριτηρίων επιλεξιμότητας του προγράμματος.');
    if (hasQ) out.push(`Επιπλέον, στην αυτοαξιολόγηση συγκέντρωσε βαθμολογία ${score!.toFixed(1)}${max ? `/${max}` : ''} μόρια, η οποία καλύπτει το απαιτούμενο ελάχιστο όριο των ${threshold} μορίων.`);
    out.push('Συνεπώς, η αίτηση κρίνεται επιλέξιμη και δύναται να υποβληθεί.');
    return out;
  }
  out.push('Η επιχείρηση πληροί τα βασικά κριτήρια επιλεξιμότητας του προγράμματος.');
  if (hasQ) {
    out.push(`Ωστόσο, η βαθμολογία αυτοαξιολόγησης ${score!.toFixed(1)}${max ? `/${max}` : ''} μόρια ΥΠΟΛΕΙΠΕΤΑΙ του απαιτούμενου ελάχιστου ορίου των ${threshold} μορίων.`);
    out.push('Απαιτείται περαιτέρω τεκμηρίωση ή βελτίωση των σχετικών κριτηρίων πριν την υποβολή της αίτησης.');
  } else {
    out.push('Απαιτείται περαιτέρω έλεγχος πριν την οριστικοποίηση της αίτησης.');
  }
  return out;
}

function answerText(q: ReportQuestion, ans: ReportAnswer | undefined): string {
  if (!ans) return '—';
  if (q.answerType === 'BOOLEAN') return ans.valueBool ? 'Ναι' : 'Όχι';
  if (q.answerType === 'NUMERIC') return ans.valueNumber != null ? String(n(ans.valueNumber)) : '—';
  const opt = q.options.find((o) => o.id === ans.selectedOptionId);
  return opt ? opt.label : '—';
}

export async function buildAssessmentDocx(a: AssessmentForReport): Promise<Buffer> {
  const elig = (a.eligibilityResult ?? { criteria: [], eligible: false }) as EligResult;
  const vm = verdictMeta(a.overallVerdict);
  const score = n(a.questionnaireScore);
  const max = n(a.questionnaireMax) ?? n(a.questionnaire?.maxScore);
  const threshold = n(a.questionnaire?.threshold);
  const body: (Paragraph | Table)[] = [];

  // ── Banner ──
  body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: SISYPHUS },
      margins: { top: 200, bottom: 200, left: 200, right: 200 },
      children: [
        new Paragraph({ children: [run('Έκθεση Αξιολόγησης Επιλεξιμότητας', { bold: true, color: 'FFFFFF', size: 36 })] }),
        new Paragraph({ spacing: { before: 40 }, children: [run(a.program?.title ?? '—', { color: 'FFFFFF', size: 22 })] }),
      ],
    })] })],
  }));
  body.push(para([
    run(`Ημερομηνία: ${fmtDate(a.createdAt)}`, { color: SUBTLE, size: 18 }),
    ...(a.program?.referenceCode ? [run(`   ·   Κωδικός: ${a.program.referenceCode}`, { color: SUBTLE, size: 18 })] : []),
  ], { spacingBefore: 80, spacingAfter: 120 }));

  // ── Result card ──
  body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { ...NO_BORDERS },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: vm.tint },
      margins: { top: 160, bottom: 160, left: 200, right: 200 },
      children: [
        new Paragraph({ children: [run('Συνολική κρίση:  ', { bold: true, size: 24 }), run(vm.label, { bold: true, color: vm.color, size: 24 })] }),
        ...(score != null ? [new Paragraph({ spacing: { before: 60 }, children: [
          run('Βαθμολογία αυτοαξιολόγησης:  ', { bold: true, size: 20 }),
          run(`${score.toFixed(1)}${max ? `/${max}` : ''}`, { bold: true, size: 20, color: a.questionnairePassed ? GREEN : RED }),
          ...(threshold != null ? [run(`   (ελάχιστο: ${threshold} — ${a.questionnairePassed ? 'ΕΠΙΤΥΧΙΑ' : 'ΑΠΟΤΥΧΙΑ'})`, { size: 19, color: SUBTLE })] : []),
        ] })] : []),
      ],
    })] })],
  }));

  // ── Στοιχεία επιχείρησης ──
  body.push(sectionHeading('Στοιχεία επιχείρησης'));
  body.push(kv('Επωνυμία', a.company?.name ?? '—'));
  body.push(kv('ΑΦΜ', a.company?.afm ?? '—'));
  body.push(kv('Νομική μορφή', a.company?.legalForm ?? '—'));

  // ── Αιτιολόγηση ──
  body.push(sectionHeading('Αιτιολόγηση'));
  for (const line of buildAssessmentNarrative(a)) body.push(para([run(line)]));

  // ── Βασικά κριτήρια ──
  body.push(sectionHeading('Βασικά κριτήρια'));
  body.push(styledTable(
    [{ text: 'Κριτήριο', w: 26 }, { text: 'Στοιχείο επιχείρησης', w: 30 }, { text: 'Απαίτηση', w: 30 }, { text: 'Αποτέλεσμα', w: 14 }],
    (elig.criteria ?? []).map((c) => [
      { text: c.label, bold: true },
      { text: c.actual ?? '—' },
      { text: c.required ?? c.note ?? '—' },
      { text: c.pass ? 'ΝΑΙ' : 'ΟΧΙ', bold: true, color: c.pass ? GREEN : RED },
    ]),
  ));

  // ── Ανάλυση ερωτηματολογίου ──
  const questions = a.questionnaire?.questions ?? [];
  if (questions.length) {
    const byQ = new Map((a.answers ?? []).map((x) => [x.questionId, x]));
    body.push(sectionHeading('Ανάλυση αυτοαξιολόγησης'));
    body.push(styledTable(
      [{ text: 'Ερώτηση', w: 56 }, { text: 'Απάντηση', w: 28 }, { text: 'Μόρια', w: 16 }],
      questions.map((q) => {
        const ans = byQ.get(q.id);
        const pts = ans && ans.pointsAwarded != null ? n(ans.pointsAwarded) : 0;
        const qmax = n(q.maxPoints);
        return [
          { text: q.text },
          { text: answerText(q, ans) },
          { text: `${pts ?? 0}${qmax ? `/${qmax}` : ''}`, bold: true },
        ];
      }),
    ));
    if (score != null) {
      body.push(para([
        run('Σύνολο: ', { bold: true }),
        run(`${score.toFixed(1)}${max ? `/${max}` : ''} μόρια`, { bold: true, color: a.questionnairePassed ? GREEN : RED }),
        ...(threshold != null ? [run(`  (ελάχιστο όριο: ${threshold})`, { color: SUBTLE, size: 19 })] : []),
      ], { spacingBefore: 80 }));
    }
  }

  // ── Επεξήγηση αποτελεσμάτων (legend) ──
  body.push(sectionHeading('Επεξήγηση αποτελεσμάτων'));
  body.push(para([run('Πώς προκύπτει η συνολική κρίση:', { bold: true, size: 19 })], { spacingAfter: 40 }));
  body.push(para([run('• ', { color: GREEN, bold: true }), run('ΕΠΙΛΕΞΙΜΗ', { bold: true, color: GREEN, size: 19 }), run(' — η επιχείρηση πληροί όλα τα βασικά κριτήρια και (εφόσον υπάρχει ερωτηματολόγιο) καλύπτει το ελάχιστο όριο βαθμολογίας.', { size: 19 })]));
  body.push(para([run('• ', { color: AMBER, bold: true }), run('ΑΠΑΙΤΕΙ ΕΛΕΓΧΟ', { bold: true, color: AMBER, size: 19 }), run(' — πληροί τα βασικά κριτήρια, αλλά η βαθμολογία υπολείπεται του ελάχιστου ορίου· χρειάζεται βελτίωση/τεκμηρίωση.', { size: 19 })]));
  body.push(para([run('• ', { color: RED, bold: true }), run('ΜΗ ΕΠΙΛΕΞΙΜΗ', { bold: true, color: RED, size: 19 }), run(' — δεν πληρούται ένα ή περισσότερα βασικά κριτήρια (π.χ. ΚΑΔ, νομική μορφή, περιφέρεια).', { size: 19 })]));
  body.push(para([run('Στα βασικά κριτήρια, ', { size: 19 }), run('ΝΑΙ', { bold: true, color: GREEN, size: 19 }), run(' σημαίνει ότι το στοιχείο της επιχείρησης καλύπτει την απαίτηση και ', { size: 19 }), run('ΟΧΙ', { bold: true, color: RED, size: 19 }), run(' ότι δεν την καλύπτει.', { size: 19 })]));
  if (threshold != null) {
    body.push(para([run('Η βαθμολογία αυτοαξιολόγησης υπολογίζεται από τις απαντήσεις στο ερωτηματολόγιο· για επιτυχία απαιτούνται τουλάχιστον ', { size: 19 }), run(`${threshold}`, { bold: true, size: 19 }), run(` μόρια${max ? ` (στα ${max})` : ''}.`, { size: 19 })]));
  }

  // ── Footer ──
  body.push(new Paragraph({
    spacing: { before: 360 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE } },
    children: [run(`Η παρούσα έκθεση παρήχθη αυτόματα${a.questionnaire?.sourceNote ? ` βάσει ${a.questionnaire.sourceNote}` : ''} και αποτελεί ενημερωτικό εργαλείο προαξιολόγησης.`, { italics: true, size: 16, color: SUBTLE })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: body }],
  });
  return Packer.toBuffer(doc);
}
