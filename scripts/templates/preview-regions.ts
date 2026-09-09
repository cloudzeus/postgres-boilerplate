// scripts/templates/preview-regions.ts — DEV. Render a template's sample page with its field regions drawn on top.
// Usage: npx tsx --import ./scripts/templates/register.mjs scripts/templates/preview-regions.ts <templateId|slug> [page] [out.png]
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';
import { prisma } from '../../lib/db';
import { bunnyDownload } from '../../lib/bunny';
import { renderPage } from '../../lib/ocr/rasterize';
import { toFieldDef } from '../../lib/templates/serialize';

async function main() {
  const [idOrSlug, pageArg = '0', out = 'preview.png'] = process.argv.slice(2);
  if (!idOrSlug) { console.error('usage: preview-regions <templateId|slug> [page] [out.png]'); process.exit(1); }
  const t = await prisma.extractionTemplate.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, include: { fields: true } });
  if (!t?.sampleStorageKey) throw new Error('template or sample not found');
  const page = Number(pageArg);
  const buf = await bunnyDownload(t.sampleStorageKey);
  const png = await renderPage(buf, t.sampleMimeType ?? 'application/pdf', page, 2);
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 0; const H = meta.height ?? 0;
  const rects = t.fields.map(toFieldDef).filter((f) => f.region && f.region.page === page).map((f) => {
    const [x, y, w, h] = f.region!.bbox;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<rect x="${x * W}" y="${y * H}" width="${w * W}" height="${h * H}" fill="${f.color}" fill-opacity="0.15" stroke="${f.color}" stroke-width="4"/>` +
      `<text x="${x * W + 4}" y="${Math.max(18, y * H - 6)}" font-family="Helvetica" font-size="22" font-weight="bold" fill="${f.color}">${esc(f.label)}</text>`;
  });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects.join('')}</svg>`);
  await sharp(png).composite([{ input: svg }]).png().toFile(out);
  console.log(`${t.slug} page ${page + 1}: ${rects.length} regions → ${out} (${W}×${H})`);
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect().finally(() => process.exit(1)); });
