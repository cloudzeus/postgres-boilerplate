/**
 * Seed KadLicenseRequirement from public/NF BUSNESS.xlsx.
 *
 * Rules:
 *   - Κάθε γραμμή με κωδικό ΚΑΔ (μαύρη γραμματοσειρά) ΑΠΑΙΤΕΙ άδεια λειτουργίας.
 *   - Γραμμές με γκρι γραμματοσειρά (#606060) θεωρούνται εξαιρέσεις και παραλείπονται.
 *   - Κάθε παιδί στο KadCode hierarchy του «root» κωδικού κληρονομεί τον κανόνα (inherited=true).
 *
 * Usage:
 *   npx tsx prisma/seeds/kad-license.ts
 */
import 'dotenv/config';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/db';

const XLSX_PATH = path.join(process.cwd(), 'public', 'NF BUSNESS.xlsx');
const SOURCE = 'NF BUSNESS';
const GRAY = 'FF606060';

type RawEntry = { rawCode: string; description: string; isGray: boolean; sheet: string; row: number };

function normalizeCode(raw: string): string {
  const s = String(raw).replace(/\s+/g, '');
  if (/^\d+$/.test(s)) {
    // numeric like 82300000 → XX.XX.XX.XX
    const p = s.padStart(8, '0');
    return `${p.slice(0, 2)}.${p.slice(2, 4)}.${p.slice(4, 6)}.${p.slice(6, 8)}`;
  }
  return s;
}

async function readWorkbook(): Promise<RawEntry[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const out: RawEntry[] = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row, rn) => {
      const codeCell = row.getCell(1);
      const v = codeCell.value;
      if (v == null) return;
      const s = (typeof v === 'number' ? String(v) : String(v)).trim();
      if (!s || !/^[0-9]/.test(s)) return; // skip section headers like "ΟΜΑΔΑ 1 ..."
      const color = codeCell.font?.color?.argb ?? '';
      out.push({
        rawCode: s,
        description: String(row.getCell(2).value ?? '').trim(),
        isGray: color === GRAY,
        sheet: ws.name,
        row: rn,
      });
    });
  });
  return out;
}

async function expandWithChildren(rootCodes: string[]): Promise<Map<string, string>> {
  // BFS: returns Map<code, rootSourceCode> for every node that descends from one of rootCodes (excluding the roots themselves).
  const childToRoot = new Map<string, string>();
  // Maintain parentCode → rootCode while we descend.
  let layer = new Map<string, string>(); // currentCode -> root
  for (const c of rootCodes) layer.set(c, c);

  while (layer.size) {
    const parents = [...layer.keys()];
    const kids = await prisma.kadCode.findMany({
      where: { parentCode: { in: parents } },
      select: { code: true, parentCode: true },
    });
    if (!kids.length) break;
    const next = new Map<string, string>();
    for (const k of kids) {
      const root = layer.get(k.parentCode!)!;
      if (!childToRoot.has(k.code)) {
        childToRoot.set(k.code, root);
        next.set(k.code, root);
      }
    }
    layer = next;
  }
  return childToRoot;
}

async function main() {
  console.log(`→ Reading ${XLSX_PATH}`);
  const raw = await readWorkbook();
  console.log(`  Found ${raw.length} code rows (${raw.filter((r) => r.isGray).length} gray excluded)`);

  // Normalize + de-dupe; keep first description
  const rootMap = new Map<string, RawEntry>();
  for (const r of raw) {
    if (r.isGray) continue;
    const code = normalizeCode(r.rawCode);
    if (!rootMap.has(code)) rootMap.set(code, { ...r, rawCode: code });
  }
  const rootCodes = [...rootMap.keys()];
  console.log(`  Unique normalized root codes: ${rootCodes.length}`);

  // Verify which roots exist in KadCode
  const present = await prisma.kadCode.findMany({
    where: { code: { in: rootCodes } },
    select: { code: true },
  });
  const presentSet = new Set(present.map((p) => p.code));
  const missing = rootCodes.filter((c) => !presentSet.has(c));
  console.log(`  Present in KadCode: ${presentSet.size}, missing: ${missing.length}`);
  if (missing.length) {
    console.log(`  Missing (will be skipped): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
  }

  // Expand children for the present roots
  const presentRoots = [...presentSet];
  console.log(`→ Expanding descendants for ${presentRoots.length} root codes…`);
  const descendants = await expandWithChildren(presentRoots);
  console.log(`  Descendants discovered: ${descendants.size}`);

  // Wipe previous OPERATING_LICENSE rows from this source for a clean re-seed
  const deleted = await prisma.kadLicenseRequirement.deleteMany({
    where: { licenseType: 'OPERATING_LICENSE', source: SOURCE },
  });
  console.log(`→ Cleared ${deleted.count} previous OPERATING_LICENSE rows from source="${SOURCE}"`);

  // Upsert roots
  let rootsInserted = 0;
  for (const code of presentRoots) {
    await prisma.kadLicenseRequirement.upsert({
      where: { code_licenseType: { code, licenseType: 'OPERATING_LICENSE' } },
      create: {
        code,
        licenseType: 'OPERATING_LICENSE',
        inherited: false,
        source: SOURCE,
        notes: rootMap.get(code)?.description ?? null,
      },
      update: {
        inherited: false,
        sourceParentCode: null,
        source: SOURCE,
        notes: rootMap.get(code)?.description ?? null,
      },
    });
    rootsInserted++;
  }
  console.log(`  Inserted ${rootsInserted} root rows`);

  // Upsert inherited children
  let childInserted = 0;
  for (const [childCode, rootCode] of descendants) {
    await prisma.kadLicenseRequirement.upsert({
      where: { code_licenseType: { code: childCode, licenseType: 'OPERATING_LICENSE' } },
      create: {
        code: childCode,
        licenseType: 'OPERATING_LICENSE',
        inherited: true,
        sourceParentCode: rootCode,
        source: SOURCE,
      },
      update: {
        inherited: true,
        sourceParentCode: rootCode,
        source: SOURCE,
      },
    });
    childInserted++;
  }
  console.log(`  Inserted ${childInserted} inherited child rows`);

  const total = rootsInserted + childInserted;
  console.log(`\n✔ Done. Total KadLicenseRequirement rows: ${total} (roots=${rootsInserted}, inherited=${childInserted})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
