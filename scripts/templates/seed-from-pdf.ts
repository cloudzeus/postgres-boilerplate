// scripts/templates/seed-from-pdf.ts — DEV. Split a scanned PDF into per-form documents and create one
// template per manifest entry, proposing fields from the accountant's hand marks (spec §14.6).
// Usage: npm run templates:seed -- <file.pdf> <manifest.json> [--dry]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { prisma } from '../../lib/db';
import { renderPage } from '../../lib/ocr/rasterize';
import { storeSample } from '../../lib/templates/sample';
import { detectMarksOnPage } from '../../lib/templates/detect';
import { COLOR_PALETTE, templateSlug, uniqueKey } from '../../lib/templates/schema';
import { bunnyUploadPrivate } from '../../lib/bunny';

type Entry = { name: string; pages: number[]; rotate?: 90 | 180 | 270; department?: string; vatNumber?: string; supplierName?: string; extraPages?: number[][]; mode?: 'marks' | 'all' };

/** One row of `seed-log.json` — what the controller reviews before touching the designer. */
type LogEntry = {
  slug: string;
  templateId: string | null;
  pages: number[];
  fields: { key: string; label: string; valueType: string; page: number; bbox: number[]; value: string }[];
};

async function slice(src: PDFDocument, pages: number[], rotate?: Entry['rotate']): Promise<Buffer> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const p of copied) { if (rotate) p.setRotation(degrees((p.getRotation().angle + rotate) % 360)); out.addPage(p); }
  return Buffer.from(await out.save());
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const [pdfPath, manifestPath] = args.filter((a) => !a.startsWith('--'));
  if (!pdfPath || !manifestPath) { console.error('usage: seed-from-pdf <file.pdf> <manifest.json> [--dry]'); process.exit(1); }

  const src = await PDFDocument.load(fs.readFileSync(pdfPath));
  const total = src.getPageCount();
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(parsed)) { console.error('manifest must be a JSON array of entries'); process.exit(1); }
  const entries = parsed as Entry[];
  // Fail before any write: a page number out of range would otherwise blow up mid-run, after templates exist.
  for (const e of entries) {
    const bad = [...(e.pages ?? []), ...(e.extraPages ?? []).flat()].filter((p) => !Number.isInteger(p) || p < 1 || p > total);
    if (!e.name || !e.pages?.length) { console.error(`entry needs a name and at least one page: ${JSON.stringify(e)}`); process.exit(1); }
    if (bad.length) { console.error(`«${e.name}»: pages out of range 1..${total}: ${bad.join(', ')}`); process.exit(1); }
  }

  const outDir = path.join(path.dirname(manifestPath), 'split'); fs.mkdirSync(outDir, { recursive: true });
  const existing = new Set((await prisma.extractionTemplate.findMany({ select: { slug: true } })).map((t) => t.slug));
  const log: LogEntry[] = [];

  for (const e of entries) {
    const slug = uniqueKey(templateSlug(e.name), existing); existing.add(slug);
    const pdf = await slice(src, e.pages, e.rotate);
    fs.writeFileSync(path.join(outDir, `${slug}.pdf`), pdf);
    console.log(`\n== ${e.name} → ${slug} (pages ${e.pages.join(',')}${e.rotate ? `, rot ${e.rotate}` : ''})`);
    const row: LogEntry = { slug, templateId: null, pages: e.pages, fields: [] };
    log.push(row);
    if (dry) { console.log(`   dry run — wrote ${path.join(outDir, `${slug}.pdf`)}, no template created`); continue; }

    const t = await prisma.extractionTemplate.create({ data: { name: e.name, slug, department: e.department ?? null, vatNumber: e.vatNumber ?? null, supplierName: e.supplierName ?? null } });
    row.templateId = t.id;
    const sample = await storeSample(t.id, pdf);
    const taken = new Set<string>(); let colorIdx = 0; let order = 0;
    for (let page = 0; page < sample.pageCount; page++) {
      // Ask only for as many marks as we still have colours for — a field without its own colour is unusable.
      const remaining = COLOR_PALETTE.length - colorIdx;
      if (remaining <= 0) { console.log(`   (colour cap ${COLOR_PALETTE.length} reached — pages ${page + 1}+ not scanned)`); break; }
      const pageBuf = await renderPage(pdf, 'application/pdf', page, 2);
      const r = await detectMarksOnPage(pageBuf, { taken, mode: e.mode ?? 'marks', max: remaining, ref: { refType: 'ExtractionTemplate', refId: t.id } });
      if (r.marks === null) { console.warn(`   ! page ${page + 1}: ${r.model} returned no usable JSON — treated as 0 marks`); continue; }
      for (const m of r.marks) {
        taken.add(m.key);
        const color = COLOR_PALETTE[colorIdx++];
        await prisma.templateField.create({ data: { templateId: t.id, key: m.key, label: m.label, kind: 'SINGLE', valueType: m.valueType, color, region: { page, bbox: m.bbox }, order: order++ } });
        row.fields.push({ key: m.key, label: m.label, valueType: m.valueType, page, bbox: m.bbox, value: m.value });
        console.log(`   + ${m.key.padEnd(28)} ${m.valueType.padEnd(8)} p${page + 1} ${JSON.stringify(m.bbox)}  «${m.value}»`);
      }
      console.log(`   page ${page + 1}: ${r.marks.length} marks (${r.model}, ${r.tokensUsed ?? 0} tokens)`);
    }
    for (const [i, pages] of (e.extraPages ?? []).entries()) {
      const extra = await slice(src, pages, e.rotate);
      const key = `templates/${t.id}/samples/extra-${i + 1}.pdf`;
      await bunnyUploadPrivate({ key, body: extra, contentType: 'application/pdf' });
      console.log(`   extra sample ${i + 1} → ${key}`);
    }
  }

  const logPath = path.join(path.dirname(manifestPath), 'seed-log.json');
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log(`\n${dry ? 'dry run' : 'seeded'} — ${log.length} ${log.length === 1 ? 'entry' : 'entries'}`);
  console.table(log.map((r, i) => ({
    '#': i + 1,
    name: entries[i].name,
    slug: r.slug,
    pages: entries[i].pages.join(','),
    template: r.templateId ?? '—',
    fields: r.fields.length,
    pdf: path.join(outDir, `${r.slug}.pdf`),
  })));
  console.log(`log → ${logPath}`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)); });
