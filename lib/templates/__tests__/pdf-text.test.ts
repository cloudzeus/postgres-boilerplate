import { describe, it, expect } from 'vitest';
import { extractPdfTextItems } from '../pdf-text';

// ---------------------------------------------------------------------------
// Minimal hand-written PDF fixture. No embedded fonts (standard Helvetica), one
// page, one text-showing operator. Built byte-exactly so the xref offsets are
// correct — pdfjs tolerates a broken xref by rebuilding it, but a correct table
// keeps the fixture an honest PDF.
// ---------------------------------------------------------------------------
function buildPdf(opts: { rotate?: 0 | 90 | 180 | 270; text?: string }): Buffer {
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

  // Geometry reference (computed from pdfjs' own viewport transform for viewBox
  // [0 0 200 100], glyph box (10,80)+(44.016 x 12) — see the per-rotation notes):
  //   r=0   vpT [1,0,0,-1,0,100]    dev x 10..54.0   y 8..20    → x .050 y .080 w .220 h .120
  //   r=90  vpT [0,1,1,0,0,0]       dev x 80..92     y 10..54.0 → x .800 y .050 w .120 h .220
  //   r=180 vpT [-1,0,0,1,200,0]    dev x 146..190   y 80..92   → x .730 y .800 w .220 h .120
  //   r=270 vpT [0,-1,-1,0,100,200] dev x 8..20      y 146..190 → x .080 y .730 w .120 h .220

  it('gives a /Rotate 90 item a device box on the right edge, near the top, with non-zero extents', async () => {
    const items = await extractPdfTextItems(buildPdf({ rotate: 90 }), 0);
    const hit = items.find((i) => i.str === 'INV-451');
    expect(hit, `items: ${JSON.stringify(items)}`).toBeDefined();
    // /Rotate 90 turns the 200x100 page into a 100x200 device frame (which is what
    // pdfium renders, and what the bboxes are drawn against). The viewport transform
    // is [0,1,1,0,0,0], i.e. device = (userY, userX): the baseline (10, 80) lands at
    // device (80, 10) and the glyph run extends DOWNWARD (its width becomes device
    // height). Dividing it.width/it.height by vp.width/vp.height — as the code did
    // before — measured the extents in the unrotated frame, so the box was 0.22 wide
    // on a page only 100px across and textInBox never matched.
    expect(hit!.w).toBeGreaterThan(0);
    expect(hit!.h).toBeGreaterThan(0);
    expect(hit!.x).toBeGreaterThanOrEqual(0.75);
    expect(hit!.x + hit!.w).toBeLessThanOrEqual(0.95);
    expect(hit!.y).toBeGreaterThanOrEqual(0.03);
    expect(hit!.y + hit!.h).toBeLessThanOrEqual(0.30);
    const cx = hit!.x + hit!.w / 2;
    const cy = hit!.y + hit!.h / 2;
    expect(cx).toBeGreaterThan(0); expect(cx).toBeLessThan(1);
    expect(cy).toBeGreaterThan(0); expect(cy).toBeLessThan(1);
  });

  it('puts a /Rotate 180 item centre in the bottom-right quadrant, on-page', async () => {
    const items = await extractPdfTextItems(buildPdf({ rotate: 180 }), 0);
    const hit = items.find((i) => i.str === 'INV-451');
    expect(hit, `items: ${JSON.stringify(items)}`).toBeDefined();
    expect(hit!.w).toBeGreaterThan(0);
    expect(hit!.h).toBeGreaterThan(0);
    // 180 keeps the 200x100 frame but mirrors both axes: the top-left run becomes a
    // bottom-right one. Centre computes to (0.84, 0.86).
    const cx = hit!.x + hit!.w / 2;
    const cy = hit!.y + hit!.h / 2;
    expect(cx).toBeGreaterThan(0.5); expect(cx).toBeLessThan(1);
    expect(cy).toBeGreaterThan(0.5); expect(cy).toBeLessThan(1);
  });

  it('puts a /Rotate 270 item centre on the left edge near the bottom, on-page', async () => {
    const items = await extractPdfTextItems(buildPdf({ rotate: 270 }), 0);
    const hit = items.find((i) => i.str === 'INV-451');
    expect(hit, `items: ${JSON.stringify(items)}`).toBeDefined();
    expect(hit!.w).toBeGreaterThan(0);
    expect(hit!.h).toBeGreaterThan(0);
    // 270 gives a 100x200 frame with transform [0,-1,-1,0,100,200]: device
    // = (100 - userY, 200 - userX). Centre computes to (0.14, 0.84).
    const cx = hit!.x + hit!.w / 2;
    const cy = hit!.y + hit!.h / 2;
    expect(cx).toBeGreaterThan(0); expect(cx).toBeLessThan(0.25);
    expect(cy).toBeGreaterThan(0.7); expect(cy).toBeLessThan(1);
  });

  it('returns [] for an out-of-range page', async () => {
    expect(await extractPdfTextItems(buildPdf({}), 7)).toEqual([]);
  });
});
