// lib/programs/assessment-report.ts
// Builds a Word (.docx) eligibility-assessment report for a customer, including a
// deterministic Greek narrative explaining why the application was approved or not.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';

type Num = number | string | null | undefined;
const n = (v: Num): number | null => (v == null || v === '' ? null : Number(v));

interface EligCriterion { key: string; label: string; required: string | null; actual: string | null; pass: boolean; note?: string }
interface EligResult { criteria: EligCriterion[]; eligible: boolean }

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
  questionnaire: { threshold: Num; maxScore: Num; sourceNote: string | null } | null;
}

const GREEN = '1E7A34';
const RED = 'B42318';
const AMBER = 'B25E09';
const GREY = '667085';

function fmtDate(d: Date): string {
  // deterministic dd/mm/yyyy without locale dependence
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function verdictMeta(v: AssessmentForReport['overallVerdict']) {
  switch (v) {
    case 'ELIGIBLE': return { label: 'ΕΠΙΛΕΞΙΜΗ', color: GREEN };
    case 'NOT_ELIGIBLE': return { label: 'ΜΗ ΕΠΙΛΕΞΙΜΗ', color: RED };
    default: return { label: 'ΑΠΑΙΤΕΙ ΕΛΕΓΧΟ', color: AMBER };
  }
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
    for (const c of failed) {
      out.push(`• ${c.label}: ${c.actual ?? '—'}${c.required ? ` (απαιτείται: ${c.required})` : ''}.`);
    }
    out.push('Για τους παραπάνω λόγους η αίτηση δεν μπορεί να προχωρήσει με τα τρέχοντα στοιχεία.');
    return out;
  }

  if (a.overallVerdict === 'ELIGIBLE') {
    out.push('Η επιχείρηση ΠΛΗΡΟΙ το σύνολο των βασικών κριτηρίων επιλεξιμότητας του προγράμματος.');
    if (hasQ) {
      out.push(
        `Επιπλέον, στην αυτοαξιολόγηση συγκέντρωσε βαθμολογία ${score!.toFixed(1)}${max ? `/${max}` : ''} μόρια, ` +
        `η οποία καλύπτει το απαιτούμενο ελάχιστο όριο των ${threshold} μορίων.`,
      );
    }
    out.push('Συνεπώς, η αίτηση κρίνεται επιλέξιμη και δύναται να υποβληθεί.');
    return out;
  }

  // NEEDS_REVIEW
  out.push('Η επιχείρηση πληροί τα βασικά κριτήρια επιλεξιμότητας του προγράμματος.');
  if (hasQ) {
    out.push(
      `Ωστόσο, η βαθμολογία αυτοαξιολόγησης ${score!.toFixed(1)}${max ? `/${max}` : ''} μόρια ` +
      `ΥΠΟΛΕΙΠΕΤΑΙ του απαιτούμενου ελάχιστου ορίου των ${threshold} μορίων.`,
    );
    out.push('Απαιτείται περαιτέρω τεκμηρίωση ή βελτίωση των σχετικών κριτηρίων πριν την υποβολή της αίτησης.');
  } else {
    out.push('Απαιτείται περαιτέρω έλεγχος πριν την οριστικοποίηση της αίτησης.');
  }
  return out;
}

function cell(text: string, opts: { bold?: boolean; color?: string; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: 18 })] })],
  });
}

export async function buildAssessmentDocx(a: AssessmentForReport): Promise<Buffer> {
  const elig = (a.eligibilityResult ?? { criteria: [], eligible: false }) as EligResult;
  const vm = verdictMeta(a.overallVerdict);
  const score = n(a.questionnaireScore);
  const max = n(a.questionnaireMax) ?? n(a.questionnaire?.maxScore);
  const threshold = n(a.questionnaire?.threshold);

  const children: Paragraph[] | (Paragraph | Table)[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: 'Έκθεση Αξιολόγησης Επιλεξιμότητας', bold: true })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Πρόγραμμα: ${a.program?.title ?? '—'}`, size: 22 })],
  }));
  if (a.program?.referenceCode) {
    children.push(new Paragraph({ children: [new TextRun({ text: `Κωδικός: ${a.program.referenceCode}`, size: 18, color: GREY })] }));
  }
  children.push(new Paragraph({ children: [new TextRun({ text: `Ημερομηνία: ${fmtDate(a.createdAt)}`, size: 18, color: GREY })], spacing: { after: 200 } }));

  // Στοιχεία επιχείρησης
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Στοιχεία επιχείρησης', bold: true })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Επωνυμία: ${a.company?.name ?? '—'}`, size: 20 })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `ΑΦΜ: ${a.company?.afm ?? '—'}`, size: 20 })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Νομική μορφή: ${a.company?.legalForm ?? '—'}`, size: 20 })], spacing: { after: 200 } }));

  // Αποτέλεσμα
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Αποτέλεσμα', bold: true })] }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Συνολική κρίση: ', bold: true, size: 22 }),
      new TextRun({ text: vm.label, bold: true, color: vm.color, size: 22 }),
    ],
  }));
  if (score != null) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: `Βαθμολογία αυτοαξιολόγησης: ${score.toFixed(1)}${max ? `/${max}` : ''}` +
          `${threshold != null ? ` (ελάχιστο: ${threshold}) — ${a.questionnairePassed ? 'ΕΠΙΤΥΧΙΑ' : 'ΑΠΟΤΥΧΙΑ'}` : ''}`,
        size: 20, color: a.questionnairePassed ? GREEN : RED,
      })],
      spacing: { after: 200 },
    }));
  }

  // Αιτιολόγηση
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Αιτιολόγηση', bold: true })] }));
  for (const line of buildAssessmentNarrative(a)) {
    children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 80 } }));
  }

  // Πίνακας βασικών κριτηρίων
  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, children: [
      cell('Κριτήριο', { bold: true, width: 28 }),
      cell('Στοιχείο επιχείρησης', { bold: true, width: 30 }),
      cell('Απαίτηση', { bold: true, width: 30 }),
      cell('Αποτ.', { bold: true, width: 12 }),
    ] }),
    ...(elig.criteria ?? []).map((c) => new TableRow({ children: [
      cell(c.label, { width: 28 }),
      cell(c.actual ?? '—', { width: 30 }),
      cell(c.required ?? c.note ?? '—', { width: 30 }),
      cell(c.pass ? 'ΝΑΙ' : 'ΟΧΙ', { bold: true, color: c.pass ? GREEN : RED, width: 12 }),
    ] })),
  ];
  const allChildren: (Paragraph | Table)[] = [...children];
  allChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Βασικά κριτήρια', bold: true })], spacing: { before: 200 } }));
  allChildren.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E4E7EC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E4E7EC' },
    },
    rows,
  }));

  allChildren.push(new Paragraph({
    spacing: { before: 300 },
    children: [new TextRun({ text: `Η παρούσα έκθεση παρήχθη αυτόματα από το σύστημα${a.questionnaire?.sourceNote ? ` βάσει ${a.questionnaire.sourceNote}` : ''}.`, italics: true, size: 16, color: GREY })],
  }));

  const doc = new Document({ sections: [{ children: allChildren }] });
  return Packer.toBuffer(doc);
}
