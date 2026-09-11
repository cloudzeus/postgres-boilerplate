// app/api/admin/diagnostics/pdf-text/route.ts
//
// Free, zero-cost self-check of the PDF **text layer** inside the real Next.js
// runtime. It builds a tiny in-memory PDF whose text layer says "INVOICE 12345"
// and runs both text readers over it:
//
//   • extractDigitalPdfText  (lib/ocr/extract.ts)   — plain text for the cheap OCR path
//   • extractPdfTextItems    (lib/templates/pdf-text.ts) — positioned items for templates
//
// Why this route is permanent: these two functions only ever break in the BUNDLED
// runtime (Turbopack rewrote the pdfjs worker `require.resolve` into a module id,
// see lib/ocr/pdfjs.ts). A unit test runs under plain node and cannot see that, and
// the production symptom is silent — the OCR pipeline just falls back to the PAID
// vision path for documents whose text was free. Hitting this route after a deploy
// answers "is the customer being billed for vision on digital PDFs?" in one request
// and costs nothing: no LLM, no vision, no database, no network.
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { resolvePdfWorkerSrc } from '@/lib/ocr/pdfjs';
import { extractDigitalPdfText } from '@/lib/ocr/extract';
import { extractPdfTextItems } from '@/lib/templates/pdf-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal single-page PDF with a real text layer containing "INVOICE 12345". */
function buildTextPdf(): Buffer {
  const stream = Buffer.from('BT /F1 24 Tf 72 700 Td (INVOICE 12345) Tj ET', 'latin1');
  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', 'latin1'),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'),
      stream,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'),
  ];

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let len = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    len += b.length;
  });

  const startxref = len;
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  parts.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(parts);
}

const EXPECTED = 'INVOICE 12345';

export async function GET() {
  await requirePermission('system.settings');

  const pdf = buildTextPdf();
  const workerSrc = resolvePdfWorkerSrc();

  let digital: { ok: boolean; text?: string; error?: string };
  try {
    const text = await extractDigitalPdfText(pdf);
    digital = { ok: text.includes(EXPECTED), text };
  } catch (err: any) {
    digital = { ok: false, error: err?.message ?? String(err) };
  }

  let positioned: { ok: boolean; count?: number; first?: unknown; error?: string };
  try {
    const items = await extractPdfTextItems(pdf, 0);
    positioned = { ok: items.some((i) => i.str.includes(EXPECTED)), count: items.length, first: items[0] ?? null };
  } catch (err: any) {
    positioned = { ok: false, error: err?.message ?? String(err) };
  }

  const ok = digital.ok && positioned.ok;
  return NextResponse.json({
    ok,
    verdict: ok
      ? 'Το text layer των PDF διαβάζεται κανονικά — τα ψηφιακά PDF ΔΕΝ πληρώνουν vision.'
      : 'ΠΡΟΣΟΧΗ: το text layer ΔΕΝ διαβάζεται — κάθε ψηφιακό PDF πέφτει στο ΕΠΙ ΠΛΗΡΩΜΗ vision.',
    runtime: { cwd: process.cwd(), nodeEnv: process.env.NODE_ENV },
    pdfjsWorkerSrc: workerSrc ?? null,
    extractDigitalPdfText: digital,
    extractPdfTextItems: positioned,
  });
}
