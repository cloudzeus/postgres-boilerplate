import { describe, it, expect } from 'vitest';
import { extractPdfTextItems } from '../pdf-text';

// ---------------------------------------------------------------------------
// Minimal hand-written PDF fixture. No embedded fonts (standard Helvetica), one
// page, one text-showing operator. Built byte-exactly so the xref offsets are
// correct — pdfjs tolerates a broken xref by rebuilding it, but a correct table
// keeps the fixture an honest PDF.
// ---------------------------------------------------------------------------
function buildPdf(opts: { rotate?: 0 | 90 | 270; text?: string }): Buffer {
  const text = opts.text ?? 'INV-451';
  const rotate = opts.rotate ?? 0;
  // MediaBox 200x100 (landscape). Baseline at (10, 80) → near the TOP-LEFT of the
  // unrotated page, since PDF user space has y growing upward.
  const content = `BT /F1 12 Tf 10 80 Td (${text}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100]${rotate ? ` /Rotate ${rotate}` : ''} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const startxref = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}

describe('extractPdfTextItems', () => {
  it('places text from an unrotated page in the top-left quadrant', async () => {
    const items = await extractPdfTextItems(buildPdf({}), 0);
    const hit = items.find((i) => i.str === 'INV-451');
    expect(hit, `items: ${JSON.stringify(items)}`).toBeDefined();
    // Device frame is 200x100, origin top-left. Baseline (10, 80) → device (10, 20),
    // so x ≈ 0.05 and the glyph box sits just under y ≈ 0.2 minus its own height.
    expect(hit!.x).toBeLessThan(0.5);
    expect(hit!.y).toBeLessThan(0.5);
    expect(hit!.x).toBeCloseTo(0.05, 2);
    expect(hit!.w).toBeGreaterThan(0);
    expect(hit!.h).toBeGreaterThan(0);
  });

  it('maps text through the viewport transform on a /Rotate 90 page', async () => {
    const items = await extractPdfTextItems(buildPdf({ rotate: 90 }), 0);
    const hit = items.find((i) => i.str === 'INV-451');
    expect(hit, `items: ${JSON.stringify(items)}`).toBeDefined();
    // /Rotate 90 turns the 200x100 page into a 100x200 device frame (which is what
    // pdfium renders, and what the bboxes are drawn against). pdfjs' viewport
    // transform for rotation 90 on viewBox [0 0 200 100] is [0,1,1,0,0,0], i.e.
    // device = (userY, userX). The baseline (10, 80) therefore lands at device
    // (80, 10) → normalized x = 80/100 = 0.8 (RIGHT edge), y = 10/200 = 0.05 (TOP).
    // The naive tx/vp.width + flip used before produced x = 0.1, y ≈ 0.54 — the
    // wrong half of the page in both axes.
    expect(hit!.x).toBeGreaterThan(0.5);
    expect(hit!.x).toBeCloseTo(0.8, 2);
    // y is the baseline minus the glyph height, so it hugs the top edge (can graze
    // slightly negative because the item height is measured in the unrotated frame).
    expect(hit!.y).toBeLessThan(0.2);
  });

  it('returns [] for an out-of-range page', async () => {
    expect(await extractPdfTextItems(buildPdf({}), 7)).toEqual([]);
  });
});
